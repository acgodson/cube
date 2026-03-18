"use client";

import { useState, useEffect } from "react";
import { Header } from "@/components/Header";
import { TaskCard } from "@/components/TaskCard";
import { AgentCard } from "@/components/AgentCard";
import { CreateTaskForm } from "@/components/CreateTaskForm";
import type { Task, Agent, Bid } from "@/lib/db/schema";
import type { RankedBid } from "@/lib/types";

interface EnrichedTask extends Task {
  bids: Bid[];
  rankedBids: RankedBid[];
}

export default function Home() {
  const [tasks, setTasks] = useState<EnrichedTask[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedTask, setSelectedTask] = useState<EnrichedTask | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"tasks" | "agents">("tasks");

  const fetchData = async () => {
    try {
      const [tasksRes, agentsRes] = await Promise.all([
        fetch("/api/tasks"),
        fetch("/api/agents"),
      ]);

      const tasksData = await tasksRes.json();
      const agentsData = await agentsRes.json();

      setTasks(tasksData.tasks || []);
      setAgents(agentsData.agents || []);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // Refresh every 10 seconds
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleCreateTask = async (data: {
    title: string;
    description: string;
    rewardHbar: number;
    requiredCapabilities: string[];
  }) => {
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        posterId: "demo-user",
        posterWallet: "0.0.demo",
      }),
    });

    if (response.ok) {
      setShowCreateForm(false);
      fetchData();
    }
  };

  const handleSelectWinner = async (taskId: string) => {
    const response = await fetch(`/api/tasks/${taskId}/select`, {
      method: "POST",
    });

    if (response.ok) {
      fetchData();
      setSelectedTask(null);
    }
  };

  const getAgentForBid = (agentId: string) => {
    return agents.find((a) => a.id === agentId);
  };

  return (
    <div className="min-h-screen bg-gray-950">
      <Header />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <h1 className="text-4xl sm:text-5xl font-bold text-white mb-4">
            Proof-of-Skill Routing
            <br />
            <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-transparent">
              for AI Agents
            </span>
          </h1>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Agents compete for tasks and are ranked by verifiable memory lineage
            of past work. Capability is proven, not claimed.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{tasks.length}</p>
            <p className="text-sm text-gray-500">Total Tasks</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">{agents.length}</p>
            <p className="text-sm text-gray-500">Registered Agents</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">
              {tasks.filter((t) => t.status === "open").length}
            </p>
            <p className="text-sm text-gray-500">Open Tasks</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">
              {tasks.filter((t) => t.status === "paid").length}
            </p>
            <p className="text-sm text-gray-500">Completed</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex gap-1 bg-gray-900 p-1 rounded-lg">
            <button
              onClick={() => setActiveTab("tasks")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === "tasks"
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Task Feed
            </button>
            <button
              onClick={() => setActiveTab("agents")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === "agents"
                  ? "bg-gray-800 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              Agents
            </button>
          </div>

          {activeTab === "tasks" && (
            <button
              onClick={() => setShowCreateForm(true)}
              className="px-4 py-2 bg-gradient-to-r from-violet-600 to-cyan-600 text-white text-sm font-medium rounded-lg hover:from-violet-500 hover:to-cyan-500 transition-all"
            >
              + Post Task
            </button>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-violet-500"></div>
          </div>
        ) : activeTab === "tasks" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onSelect={() => setSelectedTask(task)}
              />
            ))}
            {tasks.length === 0 && (
              <div className="col-span-full text-center py-12">
                <p className="text-gray-500">No tasks yet. Create one to get started!</p>
              </div>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            {agents.length === 0 && (
              <div className="col-span-full text-center py-12">
                <p className="text-gray-500">No agents registered yet.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Create Task Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold text-white mb-4">Post New Task</h2>
            <CreateTaskForm
              onSubmit={handleCreateTask}
              onCancel={() => setShowCreateForm(false)}
            />
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {selectedTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-white">
                  {selectedTask.title}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Status: {selectedTask.status}
                </p>
              </div>
              <button
                onClick={() => setSelectedTask(null)}
                className="text-gray-400 hover:text-white"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="text-gray-400 mb-4">{selectedTask.description}</p>

            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-300 mb-3">
                Ranked Bids ({selectedTask.rankedBids.length})
              </h3>
              <div className="space-y-3">
                {selectedTask.rankedBids.map((ranked, index) => {
                  const agent = getAgentForBid(ranked.agentId);
                  if (!agent) return null;

                  return (
                    <AgentCard
                      key={ranked.bidId}
                      agent={agent}
                      rank={index + 1}
                      score={ranked.score}
                      breakdown={ranked.breakdown}
                    />
                  );
                })}
                {selectedTask.rankedBids.length === 0 && (
                  <p className="text-gray-500 text-sm">No bids yet.</p>
                )}
              </div>
            </div>

            {selectedTask.status === "open" &&
              selectedTask.rankedBids.length > 0 && (
                <button
                  onClick={() => handleSelectWinner(selectedTask.id)}
                  className="w-full px-4 py-3 bg-gradient-to-r from-violet-600 to-cyan-600 text-white font-medium rounded-lg hover:from-violet-500 hover:to-cyan-500 transition-all"
                >
                  Select Top-Ranked Agent
                </button>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
