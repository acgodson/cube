/**
 * Cube Agent Gateway Protocol Types
 *
 * Defines the message protocol for agent-gateway communication.
 * Agents connect via WebSocket/SSE and exchange these typed messages.
 */

// ============================================
// AGENT STATES
// ============================================

export type ConnectionState = "connected" | "disconnected";

export type WorkState =
  | "idle"        // Ready to receive task offers
  | "reviewing"   // Considering a task offer
  | "bidding"     // Has submitted a bid, waiting for selection
  | "selected"    // Won the bid, preparing to work
  | "working"     // Actively working on task
  | "submitting"; // Submitting result

// ============================================
// RESULT FORMAT SPECIFICATION
// ============================================

export interface JsonResultFormat {
  type: "json";
  schema: Record<string, unknown>; // JSON Schema
}

export interface FileResultFormat {
  type: "file";
  mimeTypes: string[]; // ["application/pdf", "image/png"]
  maxSizeBytes?: number;
}

export interface TextResultFormat {
  type: "text";
  maxLength?: number;
}

export type ResultFormat = JsonResultFormat | FileResultFormat | TextResultFormat;

// ============================================
// AGENT -> GATEWAY MESSAGES
// ============================================

export interface ConnectMessage {
  type: "CONNECT";
  agentId: string;
  apiKey: string; // Agent's API key for authentication
  capabilities?: string[]; // Optional override of registered capabilities
  version?: string; // Agent SDK version
}

export interface BidMessage {
  type: "BID";
  taskId: string;
  amount: string; // HBAR amount as string
  estimatedTime?: number; // Estimated completion time in seconds
  notes?: string; // Optional bid notes
}

export interface PassMessage {
  type: "PASS";
  taskId: string;
  reason?: string; // Why agent is passing
}

export interface SubmitMessage {
  type: "SUBMIT";
  taskId: string;
  result: SubmitResult;
}

export interface SubmitResult {
  type: "json" | "file" | "text";
  data?: Record<string, unknown>; // For JSON results
  text?: string; // For text results
  fileCid?: string; // IPFS CID for file results
  fileUrl?: string; // Alternative: direct URL
  summary: string; // Human-readable summary
}

export interface PingMessage {
  type: "PING";
}

export interface DisconnectMessage {
  type: "DISCONNECT";
  reason?: string;
}

export type AgentMessage =
  | ConnectMessage
  | BidMessage
  | PassMessage
  | SubmitMessage
  | PingMessage
  | DisconnectMessage;

// ============================================
// GATEWAY -> AGENT MESSAGES
// ============================================

export interface ConnectedMessage {
  type: "CONNECTED";
  sessionId: string;
  agentId: string;
  agentName: string;
  workState: WorkState;
}

export interface TaskOfferMessage {
  type: "TASK_OFFER";
  offerId: string;
  task: {
    id: string;
    title: string;
    description: string;
    reward: string; // HBAR
    deadline?: string; // ISO timestamp
    requiredCapabilities: string[];
    resultFormat: ResultFormat;
    posterName?: string;
  };
  semanticMatch: number; // 0-1 similarity score
  expiresAt: string; // ISO timestamp - offer expires if no response
}

export interface OfferExpiredMessage {
  type: "OFFER_EXPIRED";
  offerId: string;
  taskId: string;
}

export interface BidAcceptedMessage {
  type: "BID_ACCEPTED";
  taskId: string;
  bidId: string;
  position: number; // Rank among all bids (1 = highest)
  totalBids: number;
}

export interface SelectedMessage {
  type: "SELECTED";
  taskId: string;
  bidId: string;
  deadline?: string;
  instructions?: string; // Additional instructions from poster
}

export interface OutbidMessage {
  type: "OUTBID";
  taskId: string;
  reason: string;
}

export interface ValidatedMessage {
  type: "VALIDATED";
  taskId: string;
  outcome: "success" | "rejected" | "challenged";
  payout?: string; // HBAR paid out
  confidence: number;
  feedback?: string;
  memoryCommit: {
    commitId: string;
    commitType: string;
    hcsSequence: string;
    scoreDelta: number;
  };
}

export interface ErrorMessage {
  type: "ERROR";
  code: string;
  message: string;
  taskId?: string;
}

export interface PongMessage {
  type: "PONG";
  serverTime: string;
}

export interface StateUpdateMessage {
  type: "STATE_UPDATE";
  workState: WorkState;
  currentTaskId?: string;
}

export type GatewayMessage =
  | ConnectedMessage
  | TaskOfferMessage
  | OfferExpiredMessage
  | BidAcceptedMessage
  | SelectedMessage
  | OutbidMessage
  | ValidatedMessage
  | ErrorMessage
  | PongMessage
  | StateUpdateMessage;

// ============================================
// SESSION STATE
// ============================================

export interface AgentSessionState {
  sessionId: string;
  agentId: string;
  agentName: string;
  connectionState: ConnectionState;
  workState: WorkState;
  currentTaskId: string | null;
  currentOfferId: string | null;
  connectedAt: Date;
  lastPingAt: Date;
}

// ============================================
// GATEWAY CONFIGURATION
// ============================================

export interface GatewayConfig {
  // Task offer settings
  offerTimeoutMs: number; // How long agent has to respond to offer
  maxConcurrentOffers: number; // Max pending offers per agent (usually 1)

  // Matching settings
  minSemanticScore: number; // Minimum similarity to offer task

  // Connection settings
  pingIntervalMs: number;
  pingTimeoutMs: number;

  // Rate limiting
  maxOffersPerMinute: number;
}

export const DEFAULT_GATEWAY_CONFIG: GatewayConfig = {
  offerTimeoutMs: 60_000, // 1 minute to respond
  maxConcurrentOffers: 1,
  minSemanticScore: 0.05, // 5% similarity threshold (lowered for new agents to receive tasks)
  pingIntervalMs: 30_000, // Ping every 30s
  pingTimeoutMs: 10_000, // 10s to respond to ping
  maxOffersPerMinute: 10,
};
