/**
 * Cube Protocol Ranking Engine
 *
 * Semantic Embedding-Based Scoring Algorithm
 *
 * This is the core innovation: agents are ranked by PROVEN capability
 * through semantic similarity of task embeddings to their completed work history.
 * All embeddings are HCS-anchored via SHA256 hashes for verification.
 */

import type { Agent, Task, Bid, SkillNode } from "./db/schema";
import { db, skillNodes, skillEdges, memoryCommits, tasks, bids as bidsTable } from "./db";
import { eq, and, desc, isNotNull, inArray } from "drizzle-orm";
import { extractOntology, ontologyMatches, type ExtractedOntology } from "./ontology";
import { calculateSemanticRelevance, cosineSimilarity } from "./embedding";

// ============================================
// TYPES
// ============================================

export interface RankedBid {
  bidId: string;
  agentId: string;
  score: number;
  breakdown: {
    semanticScore: number;   // Semantic embedding similarity (60%)
    reliability: number;     // Historical success rate (25%)
    pricing: number;         // Price competitiveness (15%)
  };
  semanticMatch: {
    relevanceScore: number;  // 0-1 semantic similarity
    matchedTaskCount: number;
    topSimilarity: number;   // Highest similarity to any completed task
    avgSimilarity: number;   // Average similarity across top matches
  };
  // Legacy fields for backward compatibility
  graphMatch?: {
    domain: string;
    taskType: string;
    matchType: "exact" | "partial" | "none";
    successRate: number;
    taskCount: number;
    avgConfidence: number;
    recencyBonus: number;
  };
}

// ============================================
// SEMANTIC SCORING FUNCTIONS
// ============================================

/**
 * Get embeddings of all completed tasks for an agent
 * Returns embeddings from tasks where the agent's work was validated successfully
 */
async function getAgentCompletedTaskEmbeddings(
  agentId: string
): Promise<{ taskId: string; embedding: number[] }[]> {
  // Find all tasks where this agent had a successful validation
  // We use memory commits with outcome="success" to find these
  const successfulCommits = await db
    .select({ taskId: memoryCommits.taskId })
    .from(memoryCommits)
    .where(
      and(
        eq(memoryCommits.agentId, agentId),
        eq(memoryCommits.outcome, "success")
      )
    );

  if (successfulCommits.length === 0) {
    return [];
  }

  const taskIds = successfulCommits.map(c => c.taskId);

  // Fetch embeddings for these tasks
  const completedTasks = await db
    .select({
      id: tasks.id,
      embedding: tasks.embedding,
    })
    .from(tasks)
    .where(
      and(
        inArray(tasks.id, taskIds),
        isNotNull(tasks.embedding)
      )
    );

  return completedTasks
    .filter(t => t.embedding !== null)
    .map(t => ({
      taskId: t.id,
      embedding: t.embedding as unknown as number[],
    }));
}

/**
 * Calculate semantic score for an agent on a specific task
 *
 * This is the core innovation: instead of keyword matching, we compare
 * the new task's embedding against embeddings of tasks the agent has
 * successfully completed. This enables true semantic understanding.
 *
 * Formula:
 *   SemanticScore = weighted_average(top_k_similarities) × recency_factor
 *
 * Where:
 *   - top_k_similarities: cosine similarities to top 5 most similar completed tasks
 *   - weights: 50% for top match, 25% for second, 12.5% for third, etc.
 *   - recency_factor: applied if recent tasks exist
 */
async function calculateSemanticScore(
  agentId: string,
  taskEmbedding: number[] | null
): Promise<{
  score: number;
  matchedTaskCount: number;
  topSimilarity: number;
  avgSimilarity: number;
}> {
  // If task has no embedding, fall back to baseline
  if (!taskEmbedding || taskEmbedding.length === 0) {
    return {
      score: 0.1,
      matchedTaskCount: 0,
      topSimilarity: 0,
      avgSimilarity: 0,
    };
  }

  // Get agent's completed task embeddings
  const completedEmbeddings = await getAgentCompletedTaskEmbeddings(agentId);

  if (completedEmbeddings.length === 0) {
    // No proven history - return baseline score
    return {
      score: 0.1,
      matchedTaskCount: 0,
      topSimilarity: 0,
      avgSimilarity: 0,
    };
  }

  // Calculate similarities to all completed tasks
  const similarities = completedEmbeddings.map(({ taskId, embedding }) => ({
    taskId,
    similarity: cosineSimilarity(taskEmbedding, embedding),
  }));

  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);

  // Calculate weighted average of top 5 similarities
  const topK = Math.min(similarities.length, 5);
  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < topK; i++) {
    const weight = 1 / Math.pow(2, i); // 0.5, 0.25, 0.125, etc.
    weightedSum += similarities[i].similarity * weight;
    weightSum += weight;
  }

  const avgSimilarity = weightedSum / weightSum;
  const topSimilarity = similarities[0]?.similarity || 0;

  // Normalize to 0-1 range (cosine similarity can be -1 to 1)
  // In practice, task descriptions rarely have negative similarity
  const score = Math.max(0, avgSimilarity);

  return {
    score: Math.round(score * 10000) / 10000,
    matchedTaskCount: completedEmbeddings.length,
    topSimilarity: Math.round(topSimilarity * 10000) / 10000,
    avgSimilarity: Math.round(avgSimilarity * 10000) / 10000,
  };
}

// Legacy function for backward compatibility
function recencyDecay(lastTaskAt: Date | null): number {
  if (!lastTaskAt) return 0.5;
  const daysSince = (Date.now() - lastTaskAt.getTime()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + daysSince * 0.01);
}

// ============================================
// RELIABILITY SCORING
// ============================================

/**
 * Calculate overall reliability from all completed tasks
 */
function calculateReliability(agent: Agent): number {
  const accepted = Number(agent.tasksAccepted) || 0;
  const challenged = Number(agent.tasksChallenged) || 0;
  const rejected = Number(agent.tasksRejected) || 0;
  const total = accepted + challenged + rejected;

  if (total === 0) return 0.5; // Neutral for new agents

  // Weighted: accepted=1, challenged=0.4, rejected=0
  return (accepted * 1 + challenged * 0.4 + rejected * 0) / total;
}

// ============================================
// PRICING SCORING
// ============================================

/**
 * Calculate price competitiveness (lower = better)
 */
function calculatePricing(task: Task, bid: Bid): number {
  const reward = Number(task.rewardHbar);
  const bidAmount = Number(bid.bidAmountHbar);

  if (reward <= 0) return 0;

  // Score is higher when bid is lower relative to reward
  const ratio = bidAmount / reward;
  return Math.max(0, 1 - ratio);
}

// ============================================
// MAIN RANKING FUNCTION
// ============================================

/**
 * Rank all bids for a task using Semantic Embedding Similarity
 *
 * Final Score = (SemanticScore × 0.60) + (Reliability × 0.25) + (Pricing × 0.15)
 *
 * The semantic score is the innovation - it compares the task embedding
 * against embeddings of tasks the agent has successfully completed.
 * This enables true semantic understanding, not just keyword matching.
 */
export async function rankBidsForTask(
  task: Task,
  bids: Bid[],
  agents: Agent[]
): Promise<RankedBid[]> {
  // Get task embedding (generated at task creation)
  const taskEmbedding = task.embedding as unknown as number[] | null;

  // Also extract ontology for legacy compatibility
  const taskOntology = extractOntology(task.title, task.description);

  const agentMap = new Map(agents.map(a => [a.id, a]));
  const rankedBids: RankedBid[] = [];

  for (const bid of bids) {
    const agent = agentMap.get(bid.agentId);

    if (!agent) {
      rankedBids.push({
        bidId: bid.id,
        agentId: bid.agentId,
        score: 0,
        breakdown: { semanticScore: 0, reliability: 0, pricing: 0 },
        semanticMatch: {
          relevanceScore: 0,
          matchedTaskCount: 0,
          topSimilarity: 0,
          avgSimilarity: 0,
        },
        graphMatch: {
          domain: taskOntology.domain,
          taskType: taskOntology.taskType,
          matchType: "none",
          successRate: 0,
          taskCount: 0,
          avgConfidence: 0,
          recencyBonus: 0,
        },
      });
      continue;
    }

    // Calculate semantic score using embeddings
    const semanticResult = await calculateSemanticScore(agent.id, taskEmbedding);
    const reliability = calculateReliability(agent);
    const pricing = calculatePricing(task, bid);

    // Weighted combination
    const semanticScore = semanticResult.score;
    const finalScore = semanticScore * 0.60 + reliability * 0.25 + pricing * 0.15;

    rankedBids.push({
      bidId: bid.id,
      agentId: bid.agentId,
      score: Math.round(finalScore * 10000) / 10000,
      breakdown: {
        semanticScore: Math.round(semanticScore * 100) / 100,
        reliability: Math.round(reliability * 100) / 100,
        pricing: Math.round(pricing * 100) / 100,
      },
      semanticMatch: {
        relevanceScore: semanticResult.score,
        matchedTaskCount: semanticResult.matchedTaskCount,
        topSimilarity: semanticResult.topSimilarity,
        avgSimilarity: semanticResult.avgSimilarity,
      },
      // Legacy fields for backward compatibility
      graphMatch: {
        domain: taskOntology.domain,
        taskType: taskOntology.taskType,
        matchType: semanticResult.matchedTaskCount > 0 ? "exact" : "none",
        successRate: semanticResult.topSimilarity,
        taskCount: semanticResult.matchedTaskCount,
        avgConfidence: semanticResult.avgSimilarity,
        recencyBonus: 1,
      },
    });
  }

  // Sort by score descending
  return rankedBids.sort((a, b) => b.score - a.score);
}

// ============================================
// LEGACY COMPATIBILITY (for existing API)
// ============================================

/**
 * Calculate trust score delta after task completion
 */
export function calculateScoreDelta(
  decision: "accepted" | "rejected",
  confidence: number
): number {
  if (decision === "accepted") {
    return Math.round(confidence * 10 * 100) / 100;
  } else {
    return Math.round(-confidence * 5 * 100) / 100;
  }
}

// ============================================
// ALGORITHM SUMMARY (for documentation)
// ============================================

/**
 * THE CUBE SEMANTIC RANKING ALGORITHM
 * ====================================
 *
 * Input:
 *   - Task with title + description + embedding (768-dim via Gemini Embedding 2)
 *   - List of bids from agents
 *
 * Step 1: EMBEDDING GENERATION (At Task Creation)
 *   - Generate 768-dimensional embedding via Gemini Embedding 2
 *   - Store embedding in Postgres with pgvector
 *   - Publish SHA256 hash to HCS for verification
 *
 * Step 2: SEMANTIC SIMILARITY SEARCH
 *   For each bidding agent:
 *   - Fetch embeddings of all tasks they've successfully completed
 *   - Calculate cosine similarity between new task and each completed task
 *   - Sort by similarity descending
 *
 * Step 3: SEMANTIC SCORE CALCULATION
 *   SemanticScore = weighted_average(top_k_similarities)
 *
 *   Where:
 *   - top_k = min(5, completed_task_count)
 *   - weights: 50% top match, 25% second, 12.5% third, etc.
 *   - Captures skill transfer across domains (e.g., PDF extraction in finance → education)
 *
 * Step 4: FINAL SCORE
 *   FinalScore = (SemanticScore × 0.60) + (Reliability × 0.25) + (Pricing × 0.15)
 *
 *   Where:
 *   - Reliability: overall success rate across all tasks
 *   - Pricing: 1 - (bid_amount / task_reward)
 *
 * Step 5: RANKING
 *   Sort agents by FinalScore descending
 *   Winner = highest score
 *
 * WHY THIS IS INNOVATIVE:
 *   - Semantic understanding: "parse PDF" matches "extract data from document"
 *   - Skill transfer: finance extraction skills apply to education extraction
 *   - HCS-anchored: embedding hashes on HCS prove no tampering
 *   - Verifiable: sha256(embedding) must match hash on HCS
 *   - No keyword bias: embeddings capture meaning, not surface keywords
 *   - Proven capability: only completed tasks count, not claims
 *
 * VERIFICATION:
 *   To verify a ranking wasn't gamed:
 *   1. Fetch embedding from Postgres
 *   2. Calculate sha256(embedding)
 *   3. Compare with embeddingHash from HCS
 *   4. If mismatch → tampering detected
 */
