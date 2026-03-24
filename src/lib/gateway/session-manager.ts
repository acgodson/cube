/**
 * Agent Session Manager
 *
 * Manages connected agent sessions and their state transitions.
 * This is the core stateful component of the gateway.
 */

import { db, agentSessions, agents, taskOffers } from "@/lib/db";
import { eq, and, lt } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import type {
  AgentSessionState,
  WorkState,
  ConnectionState,
  GatewayConfig,
  DEFAULT_GATEWAY_CONFIG,
} from "./types";

// In-memory session cache for fast lookups
const activeSessions = new Map<string, AgentSessionState>();

// Reverse lookup: agentId -> sessionId
const agentToSession = new Map<string, string>();

/**
 * Create a new session when agent connects
 */
export async function createSession(agentId: string): Promise<AgentSessionState> {
  // Check if agent exists
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Close any existing session for this agent
  const existingSessionId = agentToSession.get(agentId);
  if (existingSessionId) {
    await closeSession(existingSessionId, "new_connection");
  }

  const sessionId = generateId("sess");
  const now = new Date();

  // Persist to database
  await db.insert(agentSessions).values({
    id: sessionId,
    agentId,
    connectionState: "connected",
    workState: "idle",
    lastPingAt: now,
    connectedAt: now,
  });

  const session: AgentSessionState = {
    sessionId,
    agentId,
    agentName: agent.name,
    connectionState: "connected",
    workState: "idle",
    currentTaskId: null,
    currentOfferId: null,
    connectedAt: now,
    lastPingAt: now,
  };

  // Cache in memory
  activeSessions.set(sessionId, session);
  agentToSession.set(agentId, sessionId);

  return session;
}

/**
 * Close a session
 */
export async function closeSession(
  sessionId: string,
  reason?: string
): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  // Update database
  await db
    .update(agentSessions)
    .set({
      connectionState: "disconnected",
      disconnectedAt: new Date(),
      metadata: { disconnectReason: reason },
    })
    .where(eq(agentSessions.id, sessionId));

  // Expire any pending offers
  await db
    .update(taskOffers)
    .set({ status: "expired", respondedAt: new Date() })
    .where(
      and(
        eq(taskOffers.sessionId, sessionId),
        eq(taskOffers.status, "pending")
      )
    );

  // Remove from cache
  activeSessions.delete(sessionId);
  agentToSession.delete(session.agentId);
}

/**
 * Update session work state
 */
export async function updateWorkState(
  sessionId: string,
  workState: WorkState,
  taskId?: string
): Promise<AgentSessionState | null> {
  const session = activeSessions.get(sessionId);
  if (!session) return null;

  session.workState = workState;
  session.currentTaskId = taskId || null;

  // Persist to database
  await db
    .update(agentSessions)
    .set({
      workState,
      currentTaskId: taskId || null,
    })
    .where(eq(agentSessions.id, sessionId));

  return session;
}

/**
 * Record ping from agent
 */
export async function recordPing(sessionId: string): Promise<void> {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  session.lastPingAt = new Date();

  await db
    .update(agentSessions)
    .set({ lastPingAt: session.lastPingAt })
    .where(eq(agentSessions.id, sessionId));
}

/**
 * Get session by ID
 */
export function getSession(sessionId: string): AgentSessionState | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Get session by agent ID
 */
export function getSessionByAgent(agentId: string): AgentSessionState | undefined {
  const sessionId = agentToSession.get(agentId);
  if (!sessionId) return undefined;
  return activeSessions.get(sessionId);
}

/**
 * Get all active sessions in idle state
 */
export function getIdleSessions(): AgentSessionState[] {
  return Array.from(activeSessions.values()).filter(
    (s) => s.connectionState === "connected" && s.workState === "idle"
  );
}

/**
 * Track current offer for session
 */
export function setCurrentOffer(sessionId: string, offerId: string | null): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.currentOfferId = offerId;
  }
}

/**
 * Check if session can receive task offers
 */
export function canReceiveOffer(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  return (
    session.connectionState === "connected" &&
    session.workState === "idle" &&
    session.currentOfferId === null
  );
}

/**
 * Clean up stale sessions (no ping within timeout)
 */
export async function cleanupStaleSessions(timeoutMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);
  let cleaned = 0;

  for (const [sessionId, session] of activeSessions) {
    if (session.lastPingAt < cutoff) {
      await closeSession(sessionId, "ping_timeout");
      cleaned++;
    }
  }

  return cleaned;
}

/**
 * Restore sessions from database on startup
 */
export async function restoreSessions(): Promise<number> {
  const recentSessions = await db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.connectionState, "connected"));

  let restored = 0;
  for (const dbSession of recentSessions) {
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, dbSession.agentId));

    if (!agent) continue;

    const session: AgentSessionState = {
      sessionId: dbSession.id,
      agentId: dbSession.agentId,
      agentName: agent.name,
      connectionState: dbSession.connectionState as ConnectionState,
      workState: dbSession.workState as WorkState,
      currentTaskId: dbSession.currentTaskId,
      currentOfferId: null,
      connectedAt: dbSession.connectedAt,
      lastPingAt: dbSession.lastPingAt,
    };

    activeSessions.set(dbSession.id, session);
    agentToSession.set(dbSession.agentId, dbSession.id);
    restored++;
  }

  return restored;
}

/**
 * Get session stats
 */
export function getSessionStats(): {
  total: number;
  idle: number;
  working: number;
  bidding: number;
} {
  const sessions = Array.from(activeSessions.values());
  return {
    total: sessions.length,
    idle: sessions.filter((s) => s.workState === "idle").length,
    working: sessions.filter((s) => s.workState === "working").length,
    bidding: sessions.filter((s) => s.workState === "bidding").length,
  };
}
