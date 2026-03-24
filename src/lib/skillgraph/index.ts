/**
 * Cube Protocol Skill Graph Engine
 *
 * Manages agent skill graphs with HCS-anchored memory commits.
 * This is the core innovation - deterministic, verifiable skill tracking.
 */

import { db, skillNodes, skillEdges, memoryCommits, taskOntology, tasks } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { uploadSkillSnapshot } from "@/lib/ipfs/client";
import { extractOntology, type ExtractedOntology } from "@/lib/ontology";



export interface MemoryCommitData {
  agentId: string;
  taskId: string;
  ontology: ExtractedOntology;
  outcome: "success" | "failure";
  confidence: number;
  validatorId: string;
}

export interface SkillGraphNode {
  id: string;
  domain: string;
  taskType: string;
  artifactType: string | null;
  successCount: number;
  totalCount: number;
  avgConfidence: number;
  successRate: number;
  lastTaskAt: Date | null;
}

export interface AgentSkillGraph {
  agentId: string;
  nodes: SkillGraphNode[];
  totalTasks: number;
  domains: string[];
  lastCommitHcs: string | null;
}

// ============================================
// SKILL NODE MANAGEMENT
// ============================================

/**
 * Get or create a skill node for an agent
 */
async function getOrCreateSkillNode(
  agentId: string,
  ontology: ExtractedOntology
): Promise<{ id: string; isNew: boolean }> {
  // Check if node exists
  const existing = await db
    .select()
    .from(skillNodes)
    .where(
      and(
        eq(skillNodes.agentId, agentId),
        eq(skillNodes.domain, ontology.domain),
        eq(skillNodes.taskType, ontology.taskType)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { id: existing[0].id, isNew: false };
  }

  // Create new node
  const nodeId = generateId("skill");
  await db.insert(skillNodes).values({
    id: nodeId,
    agentId,
    domain: ontology.domain,
    taskType: ontology.taskType,
    artifactType: ontology.artifactType,
    successCount: "0",
    totalCount: "0",
    avgConfidence: "0",
  });

  return { id: nodeId, isNew: true };
}

/**
 * Update skill node after task completion
 */
async function updateSkillNode(
  nodeId: string,
  outcome: "success" | "failure",
  confidence: number,
  taskId: string,
  hcsAnchor: string
): Promise<void> {
  const [node] = await db.select().from(skillNodes).where(eq(skillNodes.id, nodeId));

  if (!node) throw new Error(`Skill node ${nodeId} not found`);

  const currentSuccess = Number(node.successCount) || 0;
  const currentTotal = Number(node.totalCount) || 0;
  const currentAvgConf = Number(node.avgConfidence) || 0;

  const newTotal = currentTotal + 1;
  const newSuccess = outcome === "success" ? currentSuccess + 1 : currentSuccess;

  // Running average of confidence
  const newAvgConf = outcome === "success"
    ? (currentAvgConf * currentTotal + confidence) / newTotal
    : currentAvgConf;

  await db
    .update(skillNodes)
    .set({
      successCount: String(newSuccess),
      totalCount: String(newTotal),
      avgConfidence: String(Math.round(newAvgConf * 10000) / 10000),
      lastTaskId: taskId,
      lastTaskAt: new Date(),
      hcsAnchor,
      updatedAt: new Date(),
    })
    .where(eq(skillNodes.id, nodeId));
}

// ============================================
// SKILL EDGE MANAGEMENT
// ============================================

/**
 * Find the previous task in this domain/type for lineage
 */
async function findPreviousTask(
  agentId: string,
  domain: string,
  taskType: string
): Promise<string | null> {
  const [lastEdge] = await db
    .select()
    .from(skillEdges)
    .where(
      and(
        eq(skillEdges.agentId, agentId),
        eq(skillEdges.domain, domain),
        eq(skillEdges.taskType, taskType)
      )
    )
    .orderBy(desc(skillEdges.hcsTimestamp))
    .limit(1);

  return lastEdge?.toTaskId || null;
}

/**
 * Create skill edge (task lineage)
 */
async function createSkillEdge(
  agentId: string,
  fromTaskId: string | null,
  toTaskId: string,
  ontology: ExtractedOntology,
  outcome: "success" | "failure",
  confidence: number,
  hcsSequence: string,
  hcsTimestamp: Date
): Promise<string> {
  const edgeId = generateId("edge");

  await db.insert(skillEdges).values({
    id: edgeId,
    agentId,
    fromTaskId,
    toTaskId,
    domain: ontology.domain,
    taskType: ontology.taskType,
    outcome,
    confidence: String(confidence),
    hcsSequence,
    hcsTimestamp,
  });

  return edgeId;
}

// ============================================
// MEMORY COMMIT SYSTEM
// ============================================

/**
 * Find the previous memory commit for chain linking
 */
async function findPreviousCommit(agentId: string): Promise<string | null> {
  const [lastCommit] = await db
    .select()
    .from(memoryCommits)
    .where(eq(memoryCommits.agentId, agentId))
    .orderBy(desc(memoryCommits.hcsTimestamp))
    .limit(1);

  return lastCommit?.id || null;
}

/**
 * Determine commit type based on history
 */
function determineCommitType(
  isNewNode: boolean,
  outcome: "success" | "failure",
  previousSuccess: number
): "SKILL_ACQUIRED" | "SKILL_REINFORCED" | "SKILL_DEGRADED" {
  if (isNewNode && outcome === "success") {
    return "SKILL_ACQUIRED";
  }
  if (outcome === "success") {
    return "SKILL_REINFORCED";
  }
  return "SKILL_DEGRADED";
}

/**
 * Calculate score delta based on outcome and confidence
 */
function calculateScoreDelta(
  outcome: "success" | "failure",
  confidence: number,
  isNewNode: boolean
): number {
  if (outcome === "success") {
    // New skills get bonus
    const bonus = isNewNode ? 1.5 : 1.0;
    return Math.round(confidence * 10 * bonus * 100) / 100;
  } else {
    // Failures penalize
    return Math.round(-confidence * 5 * 100) / 100;
  }
}

/**
 * Create a memory commit - the core primitive
 *
 * This function:
 * 1. Updates the skill node
 * 2. Creates the skill edge (lineage)
 * 3. Publishes to HCS for consensus ordering
 * 4. Stores snapshot on IPFS
 * 5. Records the commit in database
 */
export async function createMemoryCommit(
  data: MemoryCommitData
): Promise<{
  commitId: string;
  commitType: string;
  hcsSequence: string;
  ipfsCid: string | null;
  scoreDelta: number;
}> {
  const { agentId, taskId, ontology, outcome, confidence, validatorId } = data;

  // Step 1: Get or create skill node
  const { id: nodeId, isNew } = await getOrCreateSkillNode(agentId, ontology);

  // Step 2: Find previous task for lineage
  const previousTaskId = await findPreviousTask(agentId, ontology.domain, ontology.taskType);

  // Step 3: Find previous commit for chain linking
  const previousCommitId = await findPreviousCommit(agentId);

  // Step 4: Determine commit type and score delta
  const currentNode = await db.select().from(skillNodes).where(eq(skillNodes.id, nodeId)).then(r => r[0]);
  const commitType = determineCommitType(isNew, outcome, Number(currentNode?.successCount) || 0);
  const scoreDelta = calculateScoreDelta(outcome, confidence, isNew);

  // Step 4.5: Fetch task embedding hash for HCS verification
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  const embeddingHash = task?.embeddingHash || null;

  // Step 5: Publish to HCS FIRST to get consensus timestamp
  const topicId = process.env.HCS_TOPIC_ID;
  let hcsSequence = "0";
  let hcsTimestamp = new Date();

  if (topicId) {
    try {
      const hcsMessage = {
        type: "MEMORY_COMMIT",
        agentId,
        taskId,
        commitType,
        ontology: {
          domain: ontology.domain,
          taskType: ontology.taskType,
          artifactType: ontology.artifactType,
        },
        outcome,
        confidence,
        scoreDelta,
        previousCommitId,
        previousTaskId,
        embeddingHash, // SHA256 hash of task embedding for verification
        validatorId,
        timestamp: new Date().toISOString(),
      };

      const hcsResult = await publishToHcs(topicId, hcsMessage);
      hcsSequence = hcsResult.sequenceNumber;
      hcsTimestamp = new Date(hcsResult.consensusTimestamp);
    } catch (error) {
      console.error("HCS publish failed for memory commit:", error);
      // Continue without HCS - still record locally
    }
  }

  // Step 6: Update skill node with HCS anchor
  await updateSkillNode(nodeId, outcome, confidence, taskId, hcsSequence);

  // Step 7: Create skill edge
  await createSkillEdge(
    agentId,
    previousTaskId,
    taskId,
    ontology,
    outcome,
    confidence,
    hcsSequence,
    hcsTimestamp
  );

  // Step 8: Upload to IPFS
  let ipfsCid: string | null = null;
  try {
    const snapshot = {
      agentId,
      taskId,
      commitType,
      ontology,
      outcome,
      confidence,
      scoreDelta,
      previousCommitId,
      previousTaskId,
      embeddingHash, // SHA256 hash for embedding verification
      hcsSequence,
      hcsTimestamp: hcsTimestamp.toISOString(),
      validatorId,
    };

    ipfsCid = await uploadSkillSnapshot(snapshot as any);

    // Publish CID to HCS for anchoring
    if (topicId && ipfsCid) {
      await publishToHcs(topicId, {
        type: "SKILL_SNAPSHOT_ANCHORED",
        agentId,
        taskId,
        commitType,
        ipfsCid,
        hcsSequence,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.warn("IPFS upload failed (continuing without):", error);
  }

  // Step 9: Record memory commit
  const commitId = generateId("commit");
  await db.insert(memoryCommits).values({
    id: commitId,
    agentId,
    taskId,
    commitType,
    ontology: ontology as any,
    outcome,
    confidence: String(confidence),
    scoreDelta: String(scoreDelta),
    previousCommitId,
    hcsSequence,
    hcsTimestamp,
    ipfsCid,
  });

  return {
    commitId,
    commitType,
    hcsSequence,
    ipfsCid,
    scoreDelta,
  };
}

// ============================================
// SKILL GRAPH QUERIES
// ============================================

/**
 * Get an agent's full skill graph
 */
export async function getAgentSkillGraph(agentId: string): Promise<AgentSkillGraph> {
  const nodes = await db
    .select()
    .from(skillNodes)
    .where(eq(skillNodes.agentId, agentId));

  const [lastCommit] = await db
    .select()
    .from(memoryCommits)
    .where(eq(memoryCommits.agentId, agentId))
    .orderBy(desc(memoryCommits.hcsTimestamp))
    .limit(1);

  const graphNodes: SkillGraphNode[] = nodes.map(node => ({
    id: node.id,
    domain: node.domain,
    taskType: node.taskType,
    artifactType: node.artifactType,
    successCount: Number(node.successCount) || 0,
    totalCount: Number(node.totalCount) || 0,
    avgConfidence: Number(node.avgConfidence) || 0,
    successRate: Number(node.totalCount) > 0
      ? (Number(node.successCount) || 0) / (Number(node.totalCount) || 1)
      : 0,
    lastTaskAt: node.lastTaskAt,
  }));

  const domains = [...new Set(graphNodes.map(n => n.domain))];
  const totalTasks = graphNodes.reduce((sum, n) => sum + n.totalCount, 0);

  return {
    agentId,
    nodes: graphNodes,
    totalTasks,
    domains,
    lastCommitHcs: lastCommit?.hcsSequence || null,
  };
}

/**
 * Get task lineage for an agent in a specific domain
 */
export async function getTaskLineage(
  agentId: string,
  domain: string,
  limit: number = 10
): Promise<Array<{
  taskId: string;
  outcome: string;
  confidence: number;
  hcsSequence: string;
  hcsTimestamp: Date;
}>> {
  const edges = await db
    .select()
    .from(skillEdges)
    .where(
      and(
        eq(skillEdges.agentId, agentId),
        eq(skillEdges.domain, domain)
      )
    )
    .orderBy(desc(skillEdges.hcsTimestamp))
    .limit(limit);

  return edges.map(e => ({
    taskId: e.toTaskId,
    outcome: e.outcome,
    confidence: Number(e.confidence),
    hcsSequence: e.hcsSequence,
    hcsTimestamp: e.hcsTimestamp,
  }));
}

/**
 * Store task ontology when task is created
 */
export async function storeTaskOntology(
  taskId: string,
  title: string,
  description: string
): Promise<ExtractedOntology> {
  const ontology = extractOntology(title, description);

  const ontologyId = generateId("onto");
  await db.insert(taskOntology).values({
    id: ontologyId,
    taskId,
    domain: ontology.domain,
    taskType: ontology.taskType,
    artifactType: ontology.artifactType,
    entities: ontology.entities as any,
    complexity: ontology.complexity,
  });

  return ontology;
}

/**
 * Get stored ontology for a task
 */
export async function getTaskOntology(taskId: string): Promise<ExtractedOntology | null> {
  const [stored] = await db
    .select()
    .from(taskOntology)
    .where(eq(taskOntology.taskId, taskId));

  if (!stored) return null;

  return {
    domain: stored.domain,
    taskType: stored.taskType,
    artifactType: stored.artifactType,
    complexity: stored.complexity as "low" | "medium" | "high",
    entities: (stored.entities as string[]) || [],
    confidence: 1, // Stored ontology is already extracted
    keywords: { domain: [], taskType: [], artifactType: [] },
  };
}
