/**
 * OpenClaw Webhook Receiver
 *
 * This endpoint receives responses from OpenClaw agents.
 * When Cube sends a task to an OpenClaw agent via /hooks/agent,
 * the agent processes it and OpenClaw calls this webhook with results.
 *
 * Flow:
 * 1. Cube sends task offer → OpenClaw /hooks/agent
 * 2. OpenClaw agent processes → decides to bid/pass
 * 3. OpenClaw calls this webhook with the response
 * 4. We process the bid or pass and update state
 */

import { NextRequest, NextResponse } from "next/server";
import { db, agents, bids, tasks, taskResults } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import {
  getSessionByAgent,
  updateWorkState,
  processAgentMessage,
} from "@/lib/gateway";

interface OpenClawWebhookPayload {
  // OpenClaw standard fields
  type: "agent_response" | "agent_error";
  sessionId?: string;
  agentId?: string;

  // Response content from the agent
  content?: string;
  structuredOutput?: {
    action: "BID" | "PASS" | "SUBMIT";
    taskId?: string;
    bidAmount?: string;
    reason?: string;
    result?: {
      type: "json" | "text" | "file";
      data?: Record<string, unknown>;
      text?: string;
      fileCid?: string;
      summary?: string;
    };
  };

  // Metadata
  model?: string;
  tokens?: { input: number; output: number };
  timestamp?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  try {
    // Verify agent exists
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    const payload: OpenClawWebhookPayload = await request.json();
    console.log(`[Webhook] Received from agent ${agentId}:`, payload.type);

    // Handle errors from OpenClaw
    if (payload.type === "agent_error") {
      console.error(`[Webhook] Agent error:`, payload.content);
      return NextResponse.json({ received: true, error: payload.content });
    }

    // Parse structured output if available
    const action = payload.structuredOutput;
    if (!action) {
      // Try to parse action from content text
      const parsed = parseAgentResponse(payload.content || "");
      if (!parsed) {
        return NextResponse.json({
          received: true,
          warning: "Could not parse agent response",
        });
      }
      return await handleAgentAction(agentId, parsed);
    }

    return await handleAgentAction(agentId, action);
  } catch (error) {
    console.error("[Webhook] Error:", error);
    return NextResponse.json(
      { error: "Webhook processing failed", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Handle parsed agent action
 */
async function handleAgentAction(
  agentId: string,
  action: OpenClawWebhookPayload["structuredOutput"]
): Promise<NextResponse> {
  if (!action) {
    return NextResponse.json({ error: "No action" }, { status: 400 });
  }

  switch (action.action) {
    case "BID":
      return await handleBid(agentId, action.taskId!, action.bidAmount!);

    case "PASS":
      return await handlePass(agentId, action.taskId!, action.reason);

    case "SUBMIT":
      return await handleSubmit(agentId, action.taskId!, action.result!);

    default:
      return NextResponse.json({
        received: true,
        warning: `Unknown action: ${action.action}`,
      });
  }
}

/**
 * Handle BID action from agent
 */
async function handleBid(
  agentId: string,
  taskId: string,
  bidAmount: string
): Promise<NextResponse> {
  // Verify task exists and is open
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.status !== "open") {
    return NextResponse.json(
      { error: "Task not available" },
      { status: 400 }
    );
  }

  // Create bid
  const bidId = generateId("bid");
  await db.insert(bids).values({
    id: bidId,
    taskId,
    agentId,
    bidAmountHbar: bidAmount,
    stakeHbar: "0",
    status: "pending",
  });

  // Update session state if connected via gateway
  const session = getSessionByAgent(agentId);
  if (session) {
    await updateWorkState(session.sessionId, "bidding", taskId);
  }

  // Publish to HCS
  const topicId = process.env.HCS_TOPIC_ID;
  if (topicId) {
    await publishToHcs(topicId, {
      eventType: "BID_SUBMITTED",
      bidId,
      taskId,
      agentId,
      bidAmount,
      source: "openclaw_webhook",
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    success: true,
    action: "BID",
    bidId,
    taskId,
  });
}

/**
 * Handle PASS action from agent
 */
async function handlePass(
  agentId: string,
  taskId: string,
  reason?: string
): Promise<NextResponse> {
  // Update session state if connected
  const session = getSessionByAgent(agentId);
  if (session) {
    await updateWorkState(session.sessionId, "idle");
  }

  console.log(`[Webhook] Agent ${agentId} passed on task ${taskId}: ${reason}`);

  return NextResponse.json({
    success: true,
    action: "PASS",
    taskId,
  });
}

/**
 * Handle SUBMIT action from agent
 */
async function handleSubmit(
  agentId: string,
  taskId: string,
  result: NonNullable<OpenClawWebhookPayload["structuredOutput"]>["result"]
): Promise<NextResponse> {
  if (!result) {
    return NextResponse.json(
      { error: "Result data required" },
      { status: 400 }
    );
  }

  // Verify task exists
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) {
    return NextResponse.json(
      { error: "Task not found" },
      { status: 404 }
    );
  }

  // Build artifact reference
  let artifactRef = "";
  if (result.type === "json" && result.data) {
    artifactRef = JSON.stringify(result.data);
  } else if (result.type === "file" && result.fileCid) {
    artifactRef = `ipfs://${result.fileCid}`;
  } else if (result.type === "text" && result.text) {
    artifactRef = result.text;
  }

  // Create result record
  const resultId = generateId("result");
  await db.insert(taskResults).values({
    id: resultId,
    taskId,
    agentId,
    artifactRef,
    outputSummary: result.summary || "Task completed",
    resultHash: generateId("hash"),
  });

  // Update task status
  await db
    .update(tasks)
    .set({
      status: "submitted",
      resultId,
      updatedAt: new Date(),
    })
    .where(eq(tasks.id, taskId));

  // Update session state
  const session = getSessionByAgent(agentId);
  if (session) {
    await updateWorkState(session.sessionId, "submitting", taskId);
  }

  // Publish to HCS
  const topicId = process.env.HCS_TOPIC_ID;
  if (topicId) {
    await publishToHcs(topicId, {
      eventType: "RESULT_SUBMITTED",
      taskId,
      resultId,
      agentId,
      resultType: result.type,
      source: "openclaw_webhook",
      timestamp: new Date().toISOString(),
    });
  }

  return NextResponse.json({
    success: true,
    action: "SUBMIT",
    taskId,
    resultId,
  });
}

/**
 * Parse agent response from natural language
 * Fallback when structured output isn't available
 */
function parseAgentResponse(content: string): OpenClawWebhookPayload["structuredOutput"] | null {
  const lower = content.toLowerCase();

  // Look for BID patterns
  const bidMatch = content.match(/bid[:\s]+(\d+(?:\.\d+)?)\s*(?:hbar)?/i);
  const taskMatch = content.match(/task[:\s_]+(\w+)/i);

  if (bidMatch && taskMatch) {
    return {
      action: "BID",
      taskId: taskMatch[1],
      bidAmount: bidMatch[1],
    };
  }

  // Look for PASS patterns
  if (lower.includes("pass") || lower.includes("decline") || lower.includes("skip")) {
    return {
      action: "PASS",
      taskId: taskMatch?.[1],
      reason: content,
    };
  }

  // Look for SUBMIT patterns
  if (lower.includes("completed") || lower.includes("result") || lower.includes("done")) {
    return {
      action: "SUBMIT",
      taskId: taskMatch?.[1],
      result: {
        type: "text",
        text: content,
        summary: "Task completed",
      },
    };
  }

  return null;
}
