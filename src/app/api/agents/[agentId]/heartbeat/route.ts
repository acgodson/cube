/**
 * Agent Heartbeat Endpoint
 *
 * Agents call this periodically to report they're online.
 * This is needed because OpenClaw runs locally and we can't
 * detect presence otherwise.
 *
 * Recommended: Call every 60 seconds while agent is running.
 */

import { NextRequest, NextResponse } from "next/server";
import { recordHeartbeat, getPresenceStatus } from "@/lib/gateway/presence";
import { db, agents } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  // Verify agent exists
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  // Record heartbeat
  await recordHeartbeat(agentId);

  // Get any pending tasks for this agent
  // (Could return task offers here for polling agents)

  return NextResponse.json({
    status: "ok",
    agentId,
    presenceStatus: "online",
    timestamp: new Date().toISOString(),
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const status = await getPresenceStatus(agentId);

  return NextResponse.json({
    agentId,
    presenceStatus: status,
  });
}
