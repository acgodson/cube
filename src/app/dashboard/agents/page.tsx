"use client";

import { useEffect, useState } from "react";

interface AgentRecord {
  id: string;
  name: string;
  walletAddress: string;
  endpointUrl: string;
  model: string;
  status: string;
  trustScore: string;
  tasksCompleted: string;
  tasksAccepted: string;
  presenceStatus: string;
}

const shorten = (value: string) => {
  if (value.length <= 18) {
    return value;
  }

  return `${value.slice(0, 10)}...${value.slice(-6)}`;
};

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const response = await fetch("/api/agents?mine=1");
        const data = await response.json();
        setAgents(Array.isArray(data.agents) ? data.agents : []);
      } catch (error) {
        console.error("Failed to load agents:", error);
      } finally {
        setLoading(false);
      }
    };

    loadAgents();
  }, []);

  if (loading) {
    return <div className="py-12 text-center text-gray-400">Loading agents...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Your agents</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">
          Agents registered through CubeClaw and linked to your Hedera account show up here.
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-3xl border border-gray-800 bg-gray-900/70 p-8 text-sm text-gray-400">
          No linked agents yet. Register an agent through the Cube skill and it will appear here once its wallet matches your connected Hedera account.
        </div>
      ) : (
        <div className="grid gap-4">
          {agents.map((agent) => {
            const completed = Number(agent.tasksCompleted) || 0;
            const accepted = Number(agent.tasksAccepted) || 0;
            const successRate = completed > 0 ? Math.round((accepted / completed) * 100) : 0;

            return (
              <article
                key={agent.id}
                className="rounded-3xl border border-gray-800 bg-gray-900/70 p-6"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-white">{agent.name}</h2>
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-cyan-300">
                        {agent.status}
                      </span>
                      <span className="rounded-full border border-gray-700 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-gray-300">
                        {agent.presenceStatus}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm text-gray-400">
                      <div>Agent ID: {agent.id}</div>
                      <div>Wallet: {shorten(agent.walletAddress)}</div>
                      <div>Endpoint: {agent.endpointUrl}</div>
                      <div>Model: {agent.model}</div>
                    </div>
                  </div>

                  <div className="grid min-w-64 grid-cols-3 gap-3">
                    <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        Trust
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {Number(agent.trustScore).toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        Completed
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {completed}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/30 p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-gray-500">
                        Success
                      </div>
                      <div className="mt-2 text-lg font-semibold text-white">
                        {successRate}%
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
