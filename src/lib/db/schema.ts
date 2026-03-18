import {
  pgTable,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
  vector,
} from "drizzle-orm/pg-core";

// Agents table
export const agents = pgTable(
  "agents",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    walletAddress: text("wallet_address").notNull(),
    endpointUrl: text("endpoint_url").notNull(),
    status: text("status").notNull().default("active"),
    capabilities: jsonb("capabilities").notNull().default([]),
    model: text("model").notNull(),
    trustScore: numeric("trust_score", { precision: 10, scale: 4 }).notNull().default("0"),
    tasksCompleted: numeric("tasks_completed").notNull().default("0"),
    tasksAccepted: numeric("tasks_accepted").notNull().default("0"),
    tasksChallenged: numeric("tasks_challenged").notNull().default("0"),
    tasksRejected: numeric("tasks_rejected").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agents_wallet_idx").on(table.walletAddress),
    index("agents_status_idx").on(table.status),
  ]
);

// Tasks table
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    rewardHbar: numeric("reward_hbar", { precision: 18, scale: 8 }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    posterId: text("poster_id").notNull(),
    posterWallet: text("poster_wallet").notNull(),
    requiredCapabilities: jsonb("required_capabilities").notNull().default([]),
    status: text("status").notNull().default("open"),
    winningBidId: text("winning_bid_id"),
    resultId: text("result_id"),
    escrowTxHash: text("escrow_tx_hash"),
    payoutTxHash: text("payout_tx_hash"),
    hcsSequence: text("hcs_sequence"),
    // Semantic embedding via Gemini Embedding 2 (768 dims via MRL)
    embedding: vector("embedding", { dimensions: 768 }),
    embeddingHash: text("embedding_hash"), // SHA256 hash for HCS verification
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("tasks_status_idx").on(table.status),
    index("tasks_poster_idx").on(table.posterId),
    // HNSW index for fast similarity search
    index("tasks_embedding_idx").using("hnsw", table.embedding.op("vector_cosine_ops")),
  ]
);

// Bids table
export const bids = pgTable(
  "bids",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    agentId: text("agent_id").notNull().references(() => agents.id),
    bidAmountHbar: numeric("bid_amount_hbar", { precision: 18, scale: 8 }).notNull(),
    stakeHbar: numeric("stake_hbar", { precision: 18, scale: 8 }).notNull(),
    stakeTxHash: text("stake_tx_hash"),
    proofRef: text("proof_ref"),
    status: text("status").notNull().default("pending"),
    hcsSequence: text("hcs_sequence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bids_task_idx").on(table.taskId),
    index("bids_agent_idx").on(table.agentId),
  ]
);

// Task Results table
export const taskResults = pgTable("task_results", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  agentId: text("agent_id").notNull().references(() => agents.id),
  artifactRef: text("artifact_ref").notNull(),
  outputSummary: text("output_summary").notNull(),
  resultHash: text("result_hash").notNull(),
  submitTxHash: text("submit_tx_hash"),
  hcsSequence: text("hcs_sequence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Validations table
export const validations = pgTable("validations", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id),
  resultId: text("result_id").notNull().references(() => taskResults.id),
  validatorId: text("validator_id").notNull(),
  decision: text("decision").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  notes: text("notes"),
  hcsSequence: text("hcs_sequence"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Skill Snapshots table
export const skillSnapshots = pgTable(
  "skill_snapshots",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    taskId: text("task_id").notNull().references(() => tasks.id),
    resultId: text("result_id").notNull().references(() => taskResults.id),
    validationId: text("validation_id").notNull().references(() => validations.id),
    scoreDelta: numeric("score_delta", { precision: 10, scale: 4 }).notNull(),
    ipfsCid: text("ipfs_cid").notNull(),
    hcsSequence: text("hcs_sequence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("snapshots_agent_idx").on(table.agentId)]
);

// HCS Events table (for local event log)
export const hcsEvents = pgTable(
  "hcs_events",
  {
    id: text("id").primaryKey(),
    topicId: text("topic_id").notNull(),
    sequenceNumber: text("sequence_number").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    consensusTimestamp: text("consensus_timestamp").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("hcs_topic_idx").on(table.topicId),
    index("hcs_sequence_idx").on(table.sequenceNumber),
  ]
);

// ============================================
// SKILL GRAPH TABLES (Ontology-Constrained Context Graph)
// ============================================

// Task Ontology - extracted semantic structure from task descriptions
export const taskOntology = pgTable(
  "task_ontology",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => tasks.id),
    domain: text("domain").notNull(), // finance, legal, research, engineering
    taskType: text("task_type").notNull(), // extraction, analysis, summarization, generation
    artifactType: text("artifact_type"), // pdf, spreadsheet, document, code
    entities: jsonb("entities").notNull().default([]), // extracted entities
    complexity: text("complexity").notNull().default("medium"), // low, medium, high
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ontology_task_idx").on(table.taskId),
    index("ontology_domain_idx").on(table.domain),
    index("ontology_type_idx").on(table.taskType),
  ]
);

// Skill Nodes - agent capabilities organized by ontology
export const skillNodes = pgTable(
  "skill_nodes",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    domain: text("domain").notNull(),
    taskType: text("task_type").notNull(),
    artifactType: text("artifact_type"),
    successCount: numeric("success_count").notNull().default("0"),
    totalCount: numeric("total_count").notNull().default("0"),
    avgConfidence: numeric("avg_confidence", { precision: 5, scale: 4 }).notNull().default("0"),
    lastTaskId: text("last_task_id"),
    lastTaskAt: timestamp("last_task_at", { withTimezone: true }),
    hcsAnchor: text("hcs_anchor"), // Latest HCS sequence for this node
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("skill_agent_idx").on(table.agentId),
    index("skill_domain_idx").on(table.domain),
    index("skill_compound_idx").on(table.agentId, table.domain, table.taskType),
  ]
);

// Skill Edges - task lineage showing evolution of capability
export const skillEdges = pgTable(
  "skill_edges",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    fromTaskId: text("from_task_id"), // NULL for first task in domain
    toTaskId: text("to_task_id").notNull().references(() => tasks.id),
    domain: text("domain").notNull(),
    taskType: text("task_type").notNull(),
    outcome: text("outcome").notNull(), // success, failure
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    hcsSequence: text("hcs_sequence").notNull(),
    hcsTimestamp: timestamp("hcs_timestamp", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("edge_agent_idx").on(table.agentId),
    index("edge_domain_idx").on(table.domain),
    index("edge_lineage_idx").on(table.agentId, table.domain, table.hcsTimestamp),
  ]
);

// Memory Commits - HCS-anchored skill updates
export const memoryCommits = pgTable(
  "memory_commits",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").notNull().references(() => agents.id),
    taskId: text("task_id").notNull().references(() => tasks.id),
    commitType: text("commit_type").notNull(), // SKILL_ACQUIRED, SKILL_REINFORCED, SKILL_DEGRADED
    ontology: jsonb("ontology").notNull(), // {domain, taskType, artifactType, entities}
    outcome: text("outcome").notNull(), // success, failure
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    scoreDelta: numeric("score_delta", { precision: 10, scale: 4 }).notNull(),
    previousCommitId: text("previous_commit_id"), // Chain link
    hcsSequence: text("hcs_sequence").notNull(),
    hcsTimestamp: timestamp("hcs_timestamp", { withTimezone: true }).notNull(),
    ipfsCid: text("ipfs_cid"), // Full snapshot stored on IPFS
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("commit_agent_idx").on(table.agentId),
    index("commit_chain_idx").on(table.agentId, table.hcsSequence),
    index("commit_type_idx").on(table.commitType),
  ]
);

// Type exports for use in application code
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type Bid = typeof bids.$inferSelect;
export type NewBid = typeof bids.$inferInsert;
export type TaskResult = typeof taskResults.$inferSelect;
export type NewTaskResult = typeof taskResults.$inferInsert;
export type Validation = typeof validations.$inferSelect;
export type NewValidation = typeof validations.$inferInsert;
export type SkillSnapshot = typeof skillSnapshots.$inferSelect;
export type NewSkillSnapshot = typeof skillSnapshots.$inferInsert;
export type HcsEvent = typeof hcsEvents.$inferSelect;
export type NewHcsEvent = typeof hcsEvents.$inferInsert;
export type TaskOntology = typeof taskOntology.$inferSelect;
export type NewTaskOntology = typeof taskOntology.$inferInsert;
export type SkillNode = typeof skillNodes.$inferSelect;
export type NewSkillNode = typeof skillNodes.$inferInsert;
export type SkillEdge = typeof skillEdges.$inferSelect;
export type NewSkillEdge = typeof skillEdges.$inferInsert;
export type MemoryCommit = typeof memoryCommits.$inferSelect;
export type NewMemoryCommit = typeof memoryCommits.$inferInsert;
