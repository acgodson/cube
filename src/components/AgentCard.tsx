"use client";

import type { Agent } from "@/lib/db/schema";

interface AgentCardProps {
  agent: Agent;
  rank?: number;
  score?: number;
  breakdown?: {
    capability: number;
    reliability: number;
    pricing: number;
  };
}

const statusColors: Record<string, string> = {
  active: "bg-green-500",
  busy: "bg-yellow-500",
  offline: "bg-gray-500",
};

export function AgentCard({ agent, rank, score, breakdown }: AgentCardProps) {
  const capabilities = (agent.capabilities as string[]) || [];
  const completed = Number(agent.tasksCompleted) || 0;
  const accepted = Number(agent.tasksAccepted) || 0;
  const successRate = completed > 0 ? ((accepted / completed) * 100).toFixed(0) : "N/A";
  const trustScore = Number(agent.trustScore) || 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          {rank !== undefined && (
            <div className="w-8 h-8 rounded-full bg-violet-500/20 flex items-center justify-center">
              <span className="text-sm font-bold text-violet-400">#{rank}</span>
            </div>
          )}
          <div>
            <h4 className="font-semibold text-white">{agent.name}</h4>
            <p className="text-xs text-gray-500 font-mono">{agent.model}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              statusColors[agent.status] || statusColors.offline
            } ${agent.status === "active" ? "status-active" : ""}`}
          />
          <span className="text-xs text-gray-400 capitalize">{agent.status}</span>
        </div>
      </div>

      {capabilities.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {capabilities.slice(0, 4).map((cap) => (
            <span
              key={cap}
              className="px-2 py-0.5 text-xs bg-gray-800 text-gray-400 rounded"
            >
              {cap}
            </span>
          ))}
          {capabilities.length > 4 && (
            <span className="px-2 py-0.5 text-xs bg-gray-800 text-gray-500 rounded">
              +{capabilities.length - 4}
            </span>
          )}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 text-center py-3 border-y border-gray-800">
        <div>
          <p className="text-lg font-bold text-white">{trustScore.toFixed(1)}</p>
          <p className="text-xs text-gray-500">Trust Score</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{completed}</p>
          <p className="text-xs text-gray-500">Tasks</p>
        </div>
        <div>
          <p className="text-lg font-bold text-white">{successRate}%</p>
          <p className="text-xs text-gray-500">Success</p>
        </div>
      </div>

      {score !== undefined && breakdown && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Match Score</span>
            <span className="text-lg font-bold text-cyan-400">
              {(score * 100).toFixed(1)}%
            </span>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Capability</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-violet-500 rounded-full"
                    style={{ width: `${breakdown.capability * 100}%` }}
                  />
                </div>
                <span className="text-gray-400 w-8">
                  {(breakdown.capability * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Reliability</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-green-500 rounded-full"
                    style={{ width: `${breakdown.reliability * 100}%` }}
                  />
                </div>
                <span className="text-gray-400 w-8">
                  {(breakdown.reliability * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Pricing</span>
              <div className="flex items-center gap-2">
                <div className="w-20 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-cyan-500 rounded-full"
                    style={{ width: `${breakdown.pricing * 100}%` }}
                  />
                </div>
                <span className="text-gray-400 w-8">
                  {(breakdown.pricing * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-gray-800">
        <p className="text-xs text-gray-500 font-mono truncate">
          {agent.walletAddress}
        </p>
      </div>
    </div>
  );
}
