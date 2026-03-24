/**
 * Cube Agent Gateway
 *
 * Main orchestration layer for agent connections.
 * Handles the message protocol and coordinates state transitions.
 */

export * from "./types";
export * from "./session-manager";
export * from "./task-matcher";
export * from "./openclaw-notifier";
export * from "./presence";

import { db, agents, bids, tasks, taskResults } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { createMemoryCommit } from "@/lib/skillgraph";
import { extractOntology } from "@/lib/ontology";

import type {
  AgentMessage,
  GatewayMessage,
  ConnectMessage,
  BidMessage,
  PassMessage,
  SubmitMessage,
  GatewayConfig,
  DEFAULT_GATEWAY_CONFIG,
} from "./types";

import {
  createSession,
  closeSession,
  getSession,
  updateWorkState,
  recordPing,
  setCurrentOffer,
} from "./session-manager";

import { handleOfferResponse } from "./task-matcher";

// Message handler type
type MessageHandler = (sessionId: string | null, message: AgentMessage) => Promise<GatewayMessage | GatewayMessage[]>;

/**
 * Process incoming agent message
 */
export async function processAgentMessage(
  sessionId: string | null,
  message: AgentMessage
): Promise<GatewayMessage | GatewayMessage[]> {
  switch (message.type) {
    case "CONNECT":
      return handleConnect(message);

    case "BID":
      if (!sessionId) return errorMessage("NOT_CONNECTED", "Must connect first");
      return handleBid(sessionId, message);

    case "PASS":
      if (!sessionId) return errorMessage("NOT_CONNECTED", "Must connect first");
      return handlePass(sessionId, message);

    case "SUBMIT":
      if (!sessionId) return errorMessage("NOT_CONNECTED", "Must connect first");
      return handleSubmit(sessionId, message);

    case "PING":
      if (sessionId) await recordPing(sessionId);
      return { type: "PONG", serverTime: new Date().toISOString() };

    case "DISCONNECT":
      if (sessionId) await closeSession(sessionId, message.reason);
      return { type: "STATE_UPDATE", workState: "idle" };

    default:
      return errorMessage("UNKNOWN_MESSAGE", `Unknown message type`);
  }
}

/**
 * Handle CONNECT message
 */
async function handleConnect(message: ConnectMessage): Promise<GatewayMessage> {
  try {
    // Verify agent exists
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, message.agentId));

    if (!agent) {
      return errorMessage("AGENT_NOT_FOUND", `Agent ${message.agentId} not registered`);
    }

    // TODO: Verify API key when we add authentication
    // For now, just check agent exists

    // Create session
    const session = await createSession(message.agentId);

    return {
      type: "CONNECTED",
      sessionId: session.sessionId,
      agentId: session.agentId,
      agentName: session.agentName,
      workState: session.workState,
    };
  } catch (error) {
    return errorMessage("CONNECTION_FAILED", String(error));
  }
}

/**
 * Handle BID message
 */
async function handleBid(sessionId: string, message: BidMessage): Promise<GatewayMessage | GatewayMessage[]> {
  const session = getSession(sessionId);
  if (!session) {
    return errorMessage("SESSION_NOT_FOUND", "Session expired");
  }

  // Verify session is in reviewing state for this task
  if (session.workState !== "reviewing" || session.currentTaskId !== message.taskId) {
    return errorMessage("INVALID_STATE", `Cannot bid: state is ${session.workState}`);
  }

  try {
    // Get task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, message.taskId));
    if (!task || task.status !== "open") {
      return errorMessage("TASK_UNAVAILABLE", "Task is no longer open");
    }

    // Create bid record
    const bidId = generateId("bid");
    await db.insert(bids).values({
      id: bidId,
      taskId: message.taskId,
      agentId: session.agentId,
      bidAmountHbar: message.amount,
      stakeHbar: "0", // Gateway bids don't require stake initially
      status: "pending",
    });

    // Update offer status
    if (session.currentOfferId) {
      await handleOfferResponse(session.currentOfferId, true, message.amount);
    }

    // Publish to HCS
    const topicId = process.env.HCS_TOPIC_ID;
    if (topicId) {
      await publishToHcs(topicId, {
        eventType: "BID_SUBMITTED",
        bidId,
        taskId: message.taskId,
        agentId: session.agentId,
        bidAmount: message.amount,
        source: "gateway",
        timestamp: new Date().toISOString(),
      });
    }

    // Count total bids for position
    const allBids = await db
      .select()
      .from(bids)
      .where(eq(bids.taskId, message.taskId));

    return {
      type: "BID_ACCEPTED",
      taskId: message.taskId,
      bidId,
      position: allBids.length,
      totalBids: allBids.length,
    };
  } catch (error) {
    return errorMessage("BID_FAILED", String(error), message.taskId);
  }
}

/**
 * Handle PASS message
 */
async function handlePass(sessionId: string, message: PassMessage): Promise<GatewayMessage> {
  const session = getSession(sessionId);
  if (!session) {
    return errorMessage("SESSION_NOT_FOUND", "Session expired");
  }

  if (session.workState !== "reviewing") {
    return errorMessage("INVALID_STATE", `Cannot pass: state is ${session.workState}`);
  }

  // Update offer status
  if (session.currentOfferId) {
    await handleOfferResponse(session.currentOfferId, false);
  }

  return {
    type: "STATE_UPDATE",
    workState: "idle",
  };
}

/**
 * Handle SUBMIT message
 */
async function handleSubmit(sessionId: string, message: SubmitMessage): Promise<GatewayMessage> {
  const session = getSession(sessionId);
  if (!session) {
    return errorMessage("SESSION_NOT_FOUND", "Session expired");
  }

  if (session.workState !== "working" || session.currentTaskId !== message.taskId) {
    return errorMessage("INVALID_STATE", `Cannot submit: state is ${session.workState}`);
  }

  try {
    // Get task
    const [task] = await db.select().from(tasks).where(eq(tasks.id, message.taskId));
    if (!task) {
      return errorMessage("TASK_NOT_FOUND", "Task not found");
    }

    // Create result record
    const resultId = generateId("result");
    const result = message.result;

    let artifactRef = "";
    if (result.type === "json" && result.data) {
      artifactRef = JSON.stringify(result.data);
    } else if (result.type === "file" && result.fileCid) {
      artifactRef = `ipfs://${result.fileCid}`;
    } else if (result.type === "text" && result.text) {
      artifactRef = result.text;
    }

    await db.insert(taskResults).values({
      id: resultId,
      taskId: message.taskId,
      agentId: session.agentId,
      artifactRef,
      outputSummary: result.summary,
      resultHash: generateId("hash"), // TODO: Calculate actual hash
    });

    // Update task
    await db
      .update(tasks)
      .set({
        status: "submitted",
        resultId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, message.taskId));

    // Publish to HCS
    const topicId = process.env.HCS_TOPIC_ID;
    if (topicId) {
      await publishToHcs(topicId, {
        eventType: "RESULT_SUBMITTED",
        taskId: message.taskId,
        resultId,
        agentId: session.agentId,
        resultType: result.type,
        source: "gateway",
        timestamp: new Date().toISOString(),
      });
    }

    // Update session state
    await updateWorkState(sessionId, "submitting", message.taskId);

    return {
      type: "STATE_UPDATE",
      workState: "submitting",
      currentTaskId: message.taskId,
    };
  } catch (error) {
    return errorMessage("SUBMIT_FAILED", String(error), message.taskId);
  }
}

/**
 * Notify agent of selection result
 */
export async function notifySelection(
  agentId: string,
  taskId: string,
  selected: boolean,
  bidId?: string
): Promise<GatewayMessage> {
  // Find agent's session
  const { getSessionByAgent } = await import("./session-manager");
  const session = getSessionByAgent(agentId);

  if (!session) {
    // Agent not connected - they'll see status when they reconnect
    return { type: "STATE_UPDATE", workState: "idle" };
  }

  if (selected && bidId) {
    await updateWorkState(session.sessionId, "selected", taskId);

    return {
      type: "SELECTED",
      taskId,
      bidId,
    };
  } else {
    await updateWorkState(session.sessionId, "idle");

    return {
      type: "OUTBID",
      taskId,
      reason: "Another agent was selected",
    };
  }
}

/**
 * Notify agent of validation result
 */
export async function notifyValidation(
  agentId: string,
  taskId: string,
  outcome: "success" | "rejected" | "challenged",
  confidence: number,
  payout?: string,
  feedback?: string
): Promise<GatewayMessage> {
  const { getSessionByAgent } = await import("./session-manager");
  const session = getSessionByAgent(agentId);

  // Get task for ontology
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

  // Create memory commit
  let memoryCommitResult = {
    commitId: "",
    commitType: "",
    hcsSequence: "0",
    scoreDelta: 0,
  };

  if (task) {
    const ontology = extractOntology(task.title, task.description);

    try {
      memoryCommitResult = await createMemoryCommit({
        agentId,
        taskId,
        ontology,
        outcome: outcome === "success" ? "success" : "failure",
        confidence,
        validatorId: task.posterId,
      });
    } catch (error) {
      console.error("Memory commit failed:", error);
    }
  }

  // Reset session state
  if (session) {
    await updateWorkState(session.sessionId, "idle");
  }

  return {
    type: "VALIDATED",
    taskId,
    outcome,
    payout,
    confidence,
    feedback,
    memoryCommit: memoryCommitResult,
  };
}

/**
 * Helper to create error messages
 */
function errorMessage(code: string, message: string, taskId?: string): GatewayMessage {
  return {
    type: "ERROR",
    code,
    message,
    taskId,
  };
}
