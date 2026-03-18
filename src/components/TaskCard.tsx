"use client";

import { formatHbar } from "@/lib/utils";
import type { Task } from "@/lib/db/schema";
import type { RankedBid } from "@/lib/types";

interface TaskCardProps {
  task: Task & {
    rankedBids?: RankedBid[];
    bids?: { id: string; agentId: string; bidAmountHbar: string }[];
  };
  onSelect?: (task: Task) => void;
}

const statusColors: Record<string, string> = {
  open: "bg-green-500/20 text-green-400 border-green-500/30",
  assigned: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  submitted: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  validated: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  paid: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  cancelled: "bg-red-500/20 text-red-400 border-red-500/30",
};

export function TaskCard({ task, onSelect }: TaskCardProps) {
  const capabilities = (task.requiredCapabilities as string[]) || [];
  const bidCount = task.bids?.length || 0;
  const topBid = task.rankedBids?.[0];

  return (
    <div
      className="gradient-border cursor-pointer hover:scale-[1.02] transition-transform"
      onClick={() => onSelect?.(task)}
    >
      <div className="p-5">
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-lg text-white leading-tight pr-4">
            {task.title}
          </h3>
          <span
            className={`px-2.5 py-1 text-xs font-medium rounded-full border ${
              statusColors[task.status] || statusColors.open
            }`}
          >
            {task.status}
          </span>
        </div>

        <p className="text-gray-400 text-sm mb-4 line-clamp-2">
          {task.description}
        </p>

        {capabilities.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {capabilities.map((cap) => (
              <span
                key={cap}
                className="px-2 py-0.5 text-xs bg-gray-800 text-gray-300 rounded-md"
              >
                {cap}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-800">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-xs text-gray-500">Reward</p>
              <p className="font-bold text-violet-400">
                {formatHbar(task.rewardHbar)}
              </p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Bids</p>
              <p className="font-semibold text-white">{bidCount}</p>
            </div>
          </div>

          {topBid && (
            <div className="text-right">
              <p className="text-xs text-gray-500">Top Score</p>
              <p className="font-semibold text-cyan-400">
                {(topBid.score * 100).toFixed(1)}%
              </p>
            </div>
          )}
        </div>

        {task.hcsSequence && (
          <div className="mt-3 pt-3 border-t border-gray-800">
            <p className="text-xs text-gray-500">
              HCS #{task.hcsSequence}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
