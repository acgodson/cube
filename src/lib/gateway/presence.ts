/**
 * Agent Presence Tracking
 *
 * Since OpenClaw agents run locally and don't have a central presence service,
 * we track presence through:
 *
 * 1. Webhook delivery success/failure
 * 2. SSE gateway connection status
 * 3. Agent heartbeat endpoint (agent can call to report online)
 *
 * Presence states:
 * - online: Recent successful webhook OR active SSE connection
 * - offline: Repeated webhook failures AND no SSE connection
 * - unknown: New agent, never contacted
 */

import { db, agents } from "@/lib/db";
import { eq, lt, and, sql } from "drizzle-orm";

// How many failures before marking offline
const FAILURE_THRESHOLD = 3;

// How long without activity before marking unknown
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Record successful webhook delivery
 */
export async function recordWebhookSuccess(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({
      presenceStatus: "online",
      lastSeenAt: new Date(),
      webhookFailureCount: "0",
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Record failed webhook delivery
 */
export async function recordWebhookFailure(agentId: string): Promise<void> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) return;

  const newFailureCount = (Number(agent.webhookFailureCount) || 0) + 1;
  const newStatus = newFailureCount >= FAILURE_THRESHOLD ? "offline" : agent.presenceStatus;

  await db
    .update(agents)
    .set({
      presenceStatus: newStatus,
      lastWebhookFailure: new Date(),
      webhookFailureCount: String(newFailureCount),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Record agent heartbeat (called by agent to report online)
 */
export async function recordHeartbeat(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({
      presenceStatus: "online",
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Mark agent as online (from SSE connection)
 */
export async function markOnline(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({
      presenceStatus: "online",
      lastSeenAt: new Date(),
      webhookFailureCount: "0",
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Mark agent as offline (from SSE disconnect)
 */
export async function markOffline(agentId: string): Promise<void> {
  await db
    .update(agents)
    .set({
      presenceStatus: "offline",
      updatedAt: new Date(),
    })
    .where(eq(agents.id, agentId));
}

/**
 * Get agent presence status
 */
export async function getPresenceStatus(
  agentId: string
): Promise<"online" | "offline" | "unknown"> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) return "unknown";

  // Check if stale
  if (agent.lastSeenAt) {
    const timeSinceLastSeen = Date.now() - agent.lastSeenAt.getTime();
    if (timeSinceLastSeen > STALE_THRESHOLD_MS && agent.presenceStatus === "online") {
      // Stale - mark as unknown
      await db
        .update(agents)
        .set({ presenceStatus: "unknown" })
        .where(eq(agents.id, agentId));
      return "unknown";
    }
  }

  return (agent.presenceStatus as "online" | "offline" | "unknown") || "unknown";
}

/**
 * Get all online agents
 */
export async function getOnlineAgents(): Promise<string[]> {
  const onlineAgents = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.presenceStatus, "online"));

  return onlineAgents.map((a) => a.id);
}

/**
 * Check if agent is likely reachable
 */
export async function isAgentReachable(agentId: string): Promise<boolean> {
  const status = await getPresenceStatus(agentId);
  return status === "online" || status === "unknown";
}

/**
 * Clean up stale presence data
 * Run periodically to mark stale agents as unknown
 */
export async function cleanupStalePresence(): Promise<number> {
  const staleThreshold = new Date(Date.now() - STALE_THRESHOLD_MS);

  const result = await db
    .update(agents)
    .set({ presenceStatus: "unknown" })
    .where(
      and(
        eq(agents.presenceStatus, "online"),
        lt(agents.lastSeenAt, staleThreshold)
      )
    );

  return 0; // Drizzle doesn't return count easily
}
