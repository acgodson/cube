/**
 * OpenClaw Task Notifier
 *
 * Sends task offers to OpenClaw agents via their webhook endpoints.
 * This enables "push" notifications to agents running OpenClaw Gateway.
 */

import { db, agents, tasks, taskOffers, memoryCommits } from "@/lib/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { cosineSimilarity } from "@/lib/embedding";
import { recordWebhookSuccess, recordWebhookFailure, isAgentReachable } from "./presence";
import type { TaskOfferMessage, ResultFormat, GatewayConfig, DEFAULT_GATEWAY_CONFIG } from "./types";

/**
 * Send task offer to an OpenClaw agent via webhook
 *
 * Uses OpenClaw's /hooks/agent endpoint format
 */
export async function sendTaskToOpenClaw(
  agentId: string,
  endpointUrl: string,
  taskOffer: TaskOfferMessage,
  hookToken?: string
): Promise<{ success: boolean; error?: string }> {
  // Build the message for OpenClaw
  const message = buildTaskMessage(taskOffer);

  // OpenClaw expects POST to /hooks/agent
  // But we might be given a full URL or just a base URL
  let webhookUrl = endpointUrl;
  if (!webhookUrl.includes("/hooks/")) {
    // Assume it's OpenClaw Gateway base URL
    webhookUrl = `${endpointUrl.replace(/\/$/, "")}/hooks/agent`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(hookToken ? { "Authorization": `Bearer ${hookToken}` } : {}),
      },
      body: JSON.stringify({
        message,
        name: `Cube Task: ${taskOffer.task.title}`,
        // Tell OpenClaw where to send the response
        replyWebhook: process.env.NEXT_PUBLIC_APP_URL
          ? `${process.env.NEXT_PUBLIC_APP_URL}/api/webhook/openclaw/${agentId}`
          : undefined,
        // Optional: specify model
        // model: "anthropic/claude-sonnet-4-20250514",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ [Cube → Agent] Webhook failed for ${agentId}: HTTP ${response.status}`);
      console.error(`   Error: ${text}`);
      return { success: false, error: `HTTP ${response.status}: ${text}` };
    }

    console.log(`✅ [Cube → Agent] Task offer sent to ${agentId}`);
    console.log(`   📋 Task: "${taskOffer.task.title}"`);
    console.log(`   💰 Reward: ${taskOffer.task.reward} HBAR`);
    console.log(`   📊 Match Score: ${(taskOffer.semanticMatch * 100).toFixed(1)}%`);

    await recordWebhookSuccess(agentId);
    return { success: true };
  } catch (error) {
    console.error(`[OpenClaw] Failed to send to ${agentId}:`, error);
    // Track failed delivery
    await recordWebhookFailure(agentId);
    return { success: false, error: String(error) };
  }
}

/**
 * Build the task message for OpenClaw agent
 */
function buildTaskMessage(offer: TaskOfferMessage): string {
  const { task, semanticMatch, expiresAt } = offer;

  // Format result expectations
  let formatInstructions = "";
  if (task.resultFormat.type === "json") {
    formatInstructions = `
Expected output format: JSON
${task.resultFormat.schema ? `Schema: ${JSON.stringify(task.resultFormat.schema, null, 2)}` : ""}`;
  } else if (task.resultFormat.type === "file") {
    const fmt = task.resultFormat as { type: "file"; mimeTypes?: string[] };
    formatInstructions = `
Expected output format: File
Accepted types: ${fmt.mimeTypes?.join(", ") || "any"}`;
  } else {
    formatInstructions = `
Expected output format: Text`;
  }

  return `
# Cube Protocol Task Offer

You have received a task offer from Cube Protocol marketplace.

## Task Details
- **Title**: ${task.title}
- **Reward**: ${task.reward} HBAR
- **Deadline**: ${task.deadline || "No deadline"}
- **Semantic Match**: ${(semanticMatch * 100).toFixed(1)}% (how well this matches your proven skills)

## Description
${task.description}

## Required Capabilities
${task.requiredCapabilities.length > 0 ? task.requiredCapabilities.join(", ") : "General"}

${formatInstructions}

## Your Decision

Based on your capabilities and the semantic match score, decide whether to:

1. **BID** - If you can complete this task, respond with:
   - action: "BID"
   - taskId: "${task.id}"
   - bidAmount: [your bid in HBAR, typically 80-95% of reward]

2. **PASS** - If this task doesn't match your skills, respond with:
   - action: "PASS"
   - taskId: "${task.id}"
   - reason: [brief explanation]

This offer expires at: ${expiresAt}

Respond with your decision in structured JSON format.
`.trim();
}

/**
 * Find and notify all matching OpenClaw agents about a new task
 */
export async function notifyMatchingAgents(
  taskId: string,
  config: GatewayConfig
): Promise<{ notified: number; failed: number }> {
  // Get the task
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task || task.status !== "open") {
    return { notified: 0, failed: 0 };
  }

  const taskEmbedding = task.embedding as unknown as number[] | null;

  // Get all active agents with endpoint URLs
  const activeAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.status, "active"));

  let notified = 0;
  let failed = 0;

  for (const agent of activeAgents) {
    // Skip if no endpoint
    if (!agent.endpointUrl) continue;

    // Skip if agent is known to be offline
    const reachable = await isAgentReachable(agent.id);
    if (!reachable) continue;

    // Calculate semantic score
    let semanticScore = 0.1;
    if (taskEmbedding) {
      semanticScore = await calculateAgentSemanticScore(agent.id, taskEmbedding);
    }

    // Skip if below threshold
    if (semanticScore < config.minSemanticScore) continue;

    // Check if already offered
    const [existingOffer] = await db
      .select()
      .from(taskOffers)
      .where(
        and(
          eq(taskOffers.taskId, taskId),
          eq(taskOffers.agentId, agent.id)
        )
      );

    if (existingOffer) continue;

    // Create offer record
    const offerId = generateId("offer");
    const expiresAt = new Date(Date.now() + config.offerTimeoutMs);

    await db.insert(taskOffers).values({
      id: offerId,
      taskId,
      agentId: agent.id,
      sessionId: null, // Webhook-based offers don't have SSE sessions
      semanticScore: String(semanticScore),
      status: "pending",
      expiresAt,
    });

    // Build task offer message
    const taskOffer: TaskOfferMessage = {
      type: "TASK_OFFER",
      offerId,
      task: {
        id: task.id,
        title: task.title,
        description: task.description,
        reward: String(task.rewardHbar),
        deadline: task.deadlineAt?.toISOString(),
        requiredCapabilities: (task.requiredCapabilities as string[]) || [],
        resultFormat: { type: "json", schema: {} }, // Default
      },
      semanticMatch: Math.round(semanticScore * 100) / 100,
      expiresAt: expiresAt.toISOString(),
    };

    // Send to OpenClaw
    const result = await sendTaskToOpenClaw(
      agent.id,
      agent.endpointUrl,
      taskOffer
    );

    if (result.success) {
      notified++;
    } else {
      failed++;
      // Mark offer as failed
      await db
        .update(taskOffers)
        .set({ status: "expired" })
        .where(eq(taskOffers.id, offerId));
    }
  }

  return { notified, failed };
}

/**
 * Calculate semantic score for an agent on a task
 */
async function calculateAgentSemanticScore(
  agentId: string,
  taskEmbedding: number[]
): Promise<number> {
  // Get completed task embeddings
  const commits = await db
    .select({ taskId: memoryCommits.taskId })
    .from(memoryCommits)
    .where(
      and(
        eq(memoryCommits.agentId, agentId),
        eq(memoryCommits.outcome, "success")
      )
    );

  if (commits.length === 0) return 0.1;

  const taskIds = commits.map((c) => c.taskId);
  const completedTasks = await db
    .select({ embedding: tasks.embedding })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), isNotNull(tasks.embedding)));

  if (completedTasks.length === 0) return 0.1;

  // Calculate similarities
  const similarities = completedTasks
    .filter((t) => t.embedding)
    .map((t) => cosineSimilarity(taskEmbedding, t.embedding as unknown as number[]));

  similarities.sort((a, b) => b - a);

  // Weighted average of top 5
  let weightedSum = 0;
  let weightSum = 0;
  for (let i = 0; i < Math.min(similarities.length, 5); i++) {
    const weight = 1 / Math.pow(2, i);
    weightedSum += similarities[i] * weight;
    weightSum += weight;
  }

  return Math.max(0, weightedSum / weightSum);
}
