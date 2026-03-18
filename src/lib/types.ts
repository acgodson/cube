// Domain Types for Cube Protocol

export const TaskStatus = {
  Open: "open",
  Assigned: "assigned",
  Submitted: "submitted",
  Validated: "validated",
  Paid: "paid",
  Cancelled: "cancelled",
} as const;

export const BidStatus = {
  Pending: "pending",
  Selected: "selected",
  Rejected: "rejected",
  Refunded: "refunded",
} as const;

export const AgentStatus = {
  Active: "active",
  Busy: "busy",
  Offline: "offline",
} as const;

export const ValidationDecision = {
  Accepted: "accepted",
  Rejected: "rejected",
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export type BidStatus = (typeof BidStatus)[keyof typeof BidStatus];
export type AgentStatus = (typeof AgentStatus)[keyof typeof AgentStatus];
export type ValidationDecision = (typeof ValidationDecision)[keyof typeof ValidationDecision];

export type HcsEventType =
  | "TASK_CREATED"
  | "BID_SUBMITTED"
  | "WINNER_SELECTED"
  | "RESULT_SUBMITTED"
  | "RESULT_VALIDATED"
  | "PAYOUT_RELEASED"
  | "SKILL_SNAPSHOT_ANCHORED";

export interface RankedBid {
  bidId: string;
  agentId: string;
  score: number;
  breakdown: {
    capability: number;
    reliability: number;
    pricing: number;
  };
}

export interface SkillSnapshot {
  agentId: string;
  taskId: string;
  resultHash: string;
  validatorDecision: ValidationDecision;
  confidence: number;
  scoreDelta: number;
  timestamp: string;
}
