/**
 * Task Matcher
 *
 * Matches open tasks to idle agents based on semantic similarity.
 * Uses the embedding-based scoring system to find best matches.
 */

import { db, tasks, agents, taskOffers, memoryCommits, taskResultFormats } from "@/lib/db";
import { eq, and, inArray, isNotNull } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { cosineSimilarity } from "@/lib/embedding";
import type { AgentSessionState, TaskOfferMessage, ResultFormat, GatewayConfig, DEFAULT_GATEWAY_CONFIG } from "./types";
import { getIdleSessions, setCurrentOffer, updateWorkState, getSession } from "./session-manager";

/**
 * Get completed task embeddings for an agent (for semantic matching)
 */
async function getAgentCompletedEmbeddings(
  agentId: string
): Promise<{ taskId: string; embedding: number[] }[]> {
  // Find successful memory commits
  const commits = await db
    .select({ taskId: memoryCommits.taskId })
    .from(memoryCommits)
    .where(
      and(
        eq(memoryCommits.agentId, agentId),
        eq(memoryCommits.outcome, "success")
      )
    );

  if (commits.length === 0) return [];

  const taskIds = commits.map((c) => c.taskId);

  // Fetch embeddings
  const completedTasks = await db
    .select({ id: tasks.id, embedding: tasks.embedding })
    .from(tasks)
    .where(and(inArray(tasks.id, taskIds), isNotNull(tasks.embedding)));

  return completedTasks
    .filter((t) => t.embedding !== null)
    .map((t) => ({
      taskId: t.id,
      embedding: t.embedding as unknown as number[],
    }));
}

/**
 * Calculate semantic score for an agent on a task
 */
async function calculateSemanticScore(
  agentId: string,
  taskEmbedding: number[]
): Promise<number> {
  const completedEmbeddings = await getAgentCompletedEmbeddings(agentId);

  if (completedEmbeddings.length === 0) {
    return 0.1; // Baseline for new agents
  }

  // Calculate similarities
  const similarities = completedEmbeddings.map(({ embedding }) =>
    cosineSimilarity(taskEmbedding, embedding)
  );

  // Sort descending
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

/**
 * Get result format for a task
 */
async function getTaskResultFormat(taskId: string): Promise<ResultFormat> {
  const [format] = await db
    .select()
    .from(taskResultFormats)
    .where(eq(taskResultFormats.taskId, taskId));

  if (format) {
    if (format.formatType === "json") {
      return {
        type: "json",
        schema: (format.jsonSchema as Record<string, unknown>) || {},
      };
    } else if (format.formatType === "file") {
      return {
        type: "file",
        mimeTypes: (format.mimeTypes as string[]) || [],
        maxSizeBytes: format.maxSizeBytes ? Number(format.maxSizeBytes) : undefined,
      };
    } else {
      return {
        type: "text",
        maxLength: format.maxLength ? Number(format.maxLength) : undefined,
      };
    }
  }

  // Default to JSON if no format specified
  return { type: "json", schema: {} };
}

/**
 * Find open tasks suitable for matching
 */
async function getOpenTasks(): Promise<
  Array<{
    id: string;
    title: string;
    description: string;
    reward: string;
    deadline: string | null;
    requiredCapabilities: string[];
    embedding: number[] | null;
  }>
> {
  const openTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.status, "open"));

  return openTasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    reward: String(t.rewardHbar),
    deadline: t.deadlineAt?.toISOString() || null,
    requiredCapabilities: (t.requiredCapabilities as string[]) || [],
    embedding: t.embedding as unknown as number[] | null,
  }));
}

/**
 * Check if agent already has pending/active involvement with task
 */
async function hasActiveInvolvement(
  agentId: string,
  taskId: string
): Promise<boolean> {
  const [existing] = await db
    .select()
    .from(taskOffers)
    .where(
      and(
        eq(taskOffers.agentId, agentId),
        eq(taskOffers.taskId, taskId),
        inArray(taskOffers.status, ["pending", "accepted"])
      )
    );

  return !!existing;
}

/**
 * Create a task offer record
 */
async function createOffer(
  taskId: string,
  agentId: string,
  sessionId: string,
  semanticScore: number,
  expiresAt: Date
): Promise<string> {
  const offerId = generateId("offer");

  await db.insert(taskOffers).values({
    id: offerId,
    taskId,
    agentId,
    sessionId,
    semanticScore: String(semanticScore),
    status: "pending",
    expiresAt,
  });

  return offerId;
}

export interface TaskMatch {
  session: AgentSessionState;
  offer: TaskOfferMessage;
}

/**
 * Find best task matches for all idle agents
 *
 * Returns a list of (session, offer) pairs ready to send
 */
export async function findTaskMatches(
  config: GatewayConfig
): Promise<TaskMatch[]> {
  const idleSessions = getIdleSessions();
  if (idleSessions.length === 0) return [];

  const openTasks = await getOpenTasks();
  if (openTasks.length === 0) return [];

  const matches: TaskMatch[] = [];

  for (const session of idleSessions) {
    // Find best matching task for this agent
    let bestTask: (typeof openTasks)[0] | null = null;
    let bestScore = 0;

    for (const task of openTasks) {
      // Skip if already involved
      if (await hasActiveInvolvement(session.agentId, task.id)) {
        continue;
      }

      // Calculate semantic score
      const score = task.embedding
        ? await calculateSemanticScore(session.agentId, task.embedding)
        : 0.1;

      if (score > bestScore && score >= config.minSemanticScore) {
        bestScore = score;
        bestTask = task;
      }
    }

    if (bestTask) {
      const expiresAt = new Date(Date.now() + config.offerTimeoutMs);

      // Create offer record
      const offerId = await createOffer(
        bestTask.id,
        session.agentId,
        session.sessionId,
        bestScore,
        expiresAt
      );

      // Get result format
      const resultFormat = await getTaskResultFormat(bestTask.id);

      // Build offer message
      const offer: TaskOfferMessage = {
        type: "TASK_OFFER",
        offerId,
        task: {
          id: bestTask.id,
          title: bestTask.title,
          description: bestTask.description,
          reward: bestTask.reward,
          deadline: bestTask.deadline || undefined,
          requiredCapabilities: bestTask.requiredCapabilities,
          resultFormat,
        },
        semanticMatch: Math.round(bestScore * 100) / 100,
        expiresAt: expiresAt.toISOString(),
      };

      // Update session state
      setCurrentOffer(session.sessionId, offerId);
      await updateWorkState(session.sessionId, "reviewing", bestTask.id);

      matches.push({ session, offer });
    }
  }

  return matches;
}

/**
 * Handle offer response (accept/pass)
 */
export async function handleOfferResponse(
  offerId: string,
  accepted: boolean,
  bidAmount?: string
): Promise<void> {
  await db
    .update(taskOffers)
    .set({
      status: accepted ? "accepted" : "passed",
      respondedAt: new Date(),
    })
    .where(eq(taskOffers.id, offerId));

  // Find associated session and clear offer
  const [offer] = await db
    .select()
    .from(taskOffers)
    .where(eq(taskOffers.id, offerId));

  if (offer && offer.sessionId) {
    const session = getSession(offer.sessionId);
    if (session) {
      setCurrentOffer(session.sessionId, null);

      if (accepted) {
        await updateWorkState(session.sessionId, "bidding", offer.taskId);
      } else {
        await updateWorkState(session.sessionId, "idle");
      }
    }
  }
}

/**
 * Expire old pending offers
 */
export async function expireStaleOffers(): Promise<string[]> {
  const now = new Date();

  // Find expired offers
  const expired = await db
    .select()
    .from(taskOffers)
    .where(
      and(
        eq(taskOffers.status, "pending"),
        // @ts-ignore - lt works with timestamps
        lt(taskOffers.expiresAt, now)
      )
    );

  const expiredIds: string[] = [];

  for (const offer of expired) {
    await db
      .update(taskOffers)
      .set({ status: "expired", respondedAt: now })
      .where(eq(taskOffers.id, offer.id));

    // Reset session state
    if (offer.sessionId) {
      const session = getSession(offer.sessionId);
      if (session && session.currentOfferId === offer.id) {
        setCurrentOffer(session.sessionId, null);
        await updateWorkState(session.sessionId, "idle");
      }
    }

    expiredIds.push(offer.id);
  }

  return expiredIds;
}
