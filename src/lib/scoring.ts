import type { Agent, Task, Bid } from "./db/schema";
import type { RankedBid } from "./types";

/**
 * Calculate capability overlap between task requirements and agent capabilities
 */
function capabilityScore(task: Task, agent: Agent): number {
  const required = (task.requiredCapabilities as string[]) || [];
  if (required.length === 0) return 1;

  const agentCaps = new Set(
    ((agent.capabilities as string[]) || []).map((c) => c.toLowerCase())
  );
  const taskCaps = required.map((c) => c.toLowerCase());

  let matched = 0;
  for (const cap of taskCaps) {
    if (agentCaps.has(cap)) matched++;
  }

  return matched / taskCaps.length;
}

/**
 * Calculate reliability score based on validation history
 */
function reliabilityScore(agent: Agent): number {
  const accepted = Number(agent.tasksAccepted) || 0;
  const challenged = Number(agent.tasksChallenged) || 0;
  const rejected = Number(agent.tasksRejected) || 0;
  const total = accepted + challenged + rejected;

  if (total === 0) return 0.5; // Neutral for new agents

  // Weighted scoring: accepted = 1, challenged = 0.4, rejected = 0
  return (accepted * 1 + challenged * 0.4 + rejected * 0) / total;
}

/**
 * Calculate pricing competitiveness (lower bid = higher score)
 */
function pricingScore(task: Task, bid: Bid): number {
  const reward = Number(task.rewardHbar);
  const bidAmount = Number(bid.bidAmountHbar);

  if (reward <= 0) return 0;

  // Score is higher when bid is lower relative to reward
  const ratio = bidAmount / reward;
  return Math.max(0, 1 - ratio);
}

/**
 * Rank all bids for a task using the Cube scoring algorithm
 *
 * Weights:
 * - Capability match: 50%
 * - Reliability history: 35%
 * - Price competitiveness: 15%
 */
export function rankBidsForTask(
  task: Task,
  bids: Bid[],
  agents: Agent[]
): RankedBid[] {
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  const rankedBids: RankedBid[] = bids.map((bid) => {
    const agent = agentMap.get(bid.agentId);

    if (!agent) {
      return {
        bidId: bid.id,
        agentId: bid.agentId,
        score: 0,
        breakdown: { capability: 0, reliability: 0, pricing: 0 },
      };
    }

    const capability = capabilityScore(task, agent);
    const reliability = reliabilityScore(agent);
    const pricing = pricingScore(task, bid);

    // Weighted combination
    const score = capability * 0.5 + reliability * 0.35 + pricing * 0.15;

    return {
      bidId: bid.id,
      agentId: bid.agentId,
      score: Math.round(score * 10000) / 10000,
      breakdown: {
        capability: Math.round(capability * 100) / 100,
        reliability: Math.round(reliability * 100) / 100,
        pricing: Math.round(pricing * 100) / 100,
      },
    };
  });

  // Sort by score descending
  return rankedBids.sort((a, b) => b.score - a.score);
}

/**
 * Calculate trust score delta after task completion
 */
export function calculateScoreDelta(
  decision: "accepted" | "rejected",
  confidence: number
): number {
  if (decision === "accepted") {
    // Positive delta based on confidence
    return Math.round(confidence * 10 * 100) / 100;
  } else {
    // Negative delta for rejected work
    return Math.round(-confidence * 5 * 100) / 100;
  }
}
