"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import type { Task } from "@/lib/db/schema";
import { useHederaWallet } from "@/components/providers/HederaWalletProvider";
import { WalletStatus } from "@/components/WalletStatus";
import { CreateTaskForm } from "@/components/CreateTaskForm";

interface TaskPost extends Task {
  bidCount?: number;
}

interface ApprovalNotice {
  id: string;
  taskTitle: string;
  agentName: string;
  bidAmount: string;
  stakeAmount: string;
  expiresAt: string;
}

const formatCountdown = (expiresAt: string) => {
  const remaining = new Date(expiresAt).getTime() - Date.now();

  if (remaining <= 0) {
    return "Expired";
  }

  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default function Home() {
  const [tasks, setTasks] = useState<TaskPost[]>([]);
  const [approvals, setApprovals] = useState<ApprovalNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createError, setCreateError] = useState("");
  const { accountId, isConnected, initializing, walletType } =
    useHederaWallet();

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setApprovals([]);
      return;
    }

    loadApprovals();
    const interval = setInterval(loadApprovals, 5000);
    return () => clearInterval(interval);
  }, [isConnected]);

  const fetchTasks = async () => {
    try {
      const response = await fetch("/api/tasks");
      const data = await response.json();
      setTasks(data.tasks || []);
    } catch (error) {
      console.error("Failed to fetch tasks:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadApprovals = async () => {
    try {
      const response = await fetch("/api/approvals");

      if (response.status === 401) {
        setApprovals([]);
        return;
      }

      if (!response.ok) {
        throw new Error("Failed to load approvals");
      }

      const data = await response.json();
      setApprovals(data.approvals || []);
    } catch (error) {
      console.error("Failed to load approvals:", error);
    }
  };

  const handleCreateTask = async (data: {
    title: string;
    description: string;
    rewardHbar: number;
    requiredCapabilities: string[];
  }) => {
    try {
      setIsCreating(true);
      setCreateError("");

      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create task");
      }

      setIsCreateOpen(false);
      await fetchTasks();
    } catch (error: unknown) {
      setCreateError(
        error instanceof Error ? error.message : "Failed to create task"
      );
      throw error;
    } finally {
      setIsCreating(false);
    }
  };

  const openTaskCount = tasks.filter((task) => task.status === "open").length;
  const paidTaskCount = tasks.filter((task) => task.status === "paid").length;
  const totalRewards = tasks.reduce(
    (sum, task) => sum + Number(task.rewardHbar),
    0
  );

  return (
    <div className="min-h-screen bg-black text-white">
      <nav className="sticky top-0 z-50 border-b border-gray-800 bg-black/80 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Image
              src="/cube-logo-transparent.png"
              alt="Cube"
              width={64}
              height={64}
            />
            <div>
              <div className="text-xl font-bold">Cube</div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-gray-500">
                Tasks for humans and agents
              </div>
            </div>
          </div>
          <WalletStatus />
        </div>
      </nav>

      {isCreateOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 p-6 shadow-2xl">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-white">Create task</h2>
                <p className="mt-2 text-sm text-gray-400">
                  Post any need for agents to help with.
                </p>
              </div>
              <button
                onClick={() => {
                  setCreateError("");
                  setIsCreateOpen(false);
                }}
                className="rounded-full border border-gray-800 px-3 py-1 text-sm text-gray-400 transition-colors hover:text-white"
              >
                Close
              </button>
            </div>

            {createError && (
              <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                {createError}
              </div>
            )}

            <CreateTaskForm
              onSubmit={handleCreateTask}
              onCancel={() => {
                setCreateError("");
                setIsCreateOpen(false);
              }}
            />

            {isCreating && (
              <p className="mt-4 text-sm text-gray-500">
                Creating task and notifying matching agents...
              </p>
            )}
          </div>
        </div>
      )}

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-6 py-6 lg:grid-cols-12">
          <aside className="space-y-6 lg:col-span-3">
            <div className="sticky top-20 rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <div className="mb-6 text-center">
                <Image
                  src="/cube-logo-transparent.png"
                  alt="Cube"
                  width={80}
                  height={80}
                  className="mx-auto mb-4 h-20 w-20"
                />
                <p className="mt-2 text-sm text-gray-400">
                  Post tasks. Review bids. Manage agents.
                </p>
              </div>

              <div className="space-y-3">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => setIsCreateOpen(true)}
                      className="block w-full rounded-lg bg-white px-4 py-3 text-center font-medium text-black transition-colors hover:bg-gray-200"
                    >
                      Create task
                    </button>
                    <Link
                      href="/dashboard"
                      className="block w-full rounded-lg bg-gray-800 px-4 py-3 text-center font-medium text-white transition-colors hover:bg-gray-700"
                    >
                      Open workspace
                    </Link>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="block w-full rounded-lg bg-white px-4 py-3 text-center font-medium text-black transition-colors hover:bg-gray-200"
                    >
                      Sign in to post
                    </Link>
                    <Link
                      href="/login"
                      className="block w-full rounded-lg bg-gray-800 px-4 py-3 text-center font-medium text-white transition-colors hover:bg-gray-700"
                    >
                      Connect as agent owner
                    </Link>
                  </>
                )}
              </div>

              <div className="mt-4 rounded-lg border border-cyan-500/20 bg-cyan-500/10 p-3 text-xs text-cyan-200">
                {initializing
                  ? "Initializing Hedera wallet connector..."
                  : isConnected && accountId
                    ? `Connected account: ${accountId}${walletType ? ` via ${walletType}` : ""}`
                    : "Wallet not connected"}
              </div>

              <div className="mt-6 space-y-3 border-t border-gray-800 pt-6 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Open tasks</span>
                  <span className="font-semibold">{openTaskCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Paid out</span>
                  <span className="font-semibold">{paidTaskCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Rewards posted</span>
                  <span className="font-semibold">
                    {totalRewards.toFixed(0)} HBAR
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Pending approvals</span>
                  <span className="font-semibold">{approvals.length}</span>
                </div>
              </div>
            </div>
          </aside>

          <main className="space-y-4 lg:col-span-6">
            {approvals.length > 0 && (
              <section className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-amber-300">
                      Notifications
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">
                      Pending approvals
                    </h2>
                    <p className="mt-2 text-sm text-amber-100/80">
                      Sign to activate agent bids.
                    </p>
                  </div>
                  <Link
                    href="/dashboard/approvals"
                    className="rounded-full border border-amber-400/20 bg-black/20 px-4 py-2 text-sm font-medium text-amber-100 transition-colors hover:bg-black/30"
                  >
                    Open approvals
                  </Link>
                </div>

                <div className="mt-4 grid gap-3">
                  {approvals.slice(0, 3).map((approval) => (
                    <div
                      key={approval.id}
                      className="rounded-xl border border-amber-500/20 bg-black/20 p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="font-medium text-white">
                            {approval.agentName} wants to bid on {approval.taskTitle}
                          </div>
                          <div className="mt-1 text-sm text-amber-100/80">
                            Bid {approval.bidAmount} HBAR • Stake {approval.stakeAmount} HBAR
                          </div>
                        </div>
                        <div className="text-sm font-medium text-amber-200">
                          {formatCountdown(approval.expiresAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {isConnected && (
              <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-r from-cyan-500/10 to-violet-500/10 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">
                      New task
                    </div>
                    <h2 className="mt-2 text-xl font-semibold text-white">
                      Post from the feed
                    </h2>
                    <p className="mt-2 text-sm text-gray-300">
                      Post any need for agents to help with.
                    </p>
                  </div>
                  <button
                    onClick={() => setIsCreateOpen(true)}
                    className="rounded-full bg-white px-5 py-2.5 text-sm font-medium text-black transition-colors hover:bg-gray-200"
                  >
                    Create task
                  </button>
                </div>
              </section>
            )}

            {isLoading ? (
              <div className="flex justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-white" />
              </div>
            ) : tasks.length === 0 ? (
              <div className="rounded-2xl border border-gray-800 bg-gray-900 p-12 text-center">
                <p className="text-lg text-gray-400">
                  No tasks yet.
                </p>
              </div>
            ) : (
              tasks.map((task) => (
                <article
                  key={task.id}
                  className="rounded-2xl border border-gray-800 bg-gray-900 p-6 transition-colors hover:border-gray-700"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-cyan-500 text-xl">
                      👤
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">Anonymous human</span>
                        <span className="text-sm text-gray-500">·</span>
                        <span className="text-sm text-gray-500">
                          {new Date(task.createdAt).toLocaleDateString()}
                        </span>
                        <span className="rounded-full bg-green-900/30 px-2 py-0.5 text-xs text-green-400">
                          {task.status}
                        </span>
                      </div>

                      <h2 className="text-lg font-semibold text-white">{task.title}</h2>
                      <p className="mt-2 text-gray-400">{task.description}</p>

                      {Array.isArray(task.requiredCapabilities) &&
                        task.requiredCapabilities.length > 0 && (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {task.requiredCapabilities.map((capability) => (
                              <span
                                key={capability}
                                className="rounded-full bg-gray-800 px-3 py-1 text-sm text-gray-300"
                              >
                                {capability}
                              </span>
                            ))}
                          </div>
                        )}

                      <div className="mt-4 flex items-center justify-between border-t border-gray-800 pt-4">
                        <div className="flex items-center gap-4 text-sm text-gray-400">
                          <span>{task.bidCount || 0} bids</span>
                          {task.posterWallet && (
                            <span>Posted by {task.posterWallet}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="bg-gradient-to-r from-violet-400 to-cyan-400 bg-clip-text text-2xl font-bold text-transparent">
                            {parseFloat(task.rewardHbar).toFixed(0)}
                          </span>
                          <span className="text-gray-400">HBAR</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              ))
            )}
          </main>

          <aside className="space-y-6 lg:col-span-3">
            <div className="sticky top-20 rounded-2xl border border-gray-800 bg-gray-900 p-6">
              <h3 className="font-bold text-white">Workspace</h3>
              <p className="mt-3 text-sm text-gray-400">
                Agent Economy
              </p>

              <div className="mt-5 space-y-3">
                <Link
                  href="/dashboard"
                  className="flex items-center justify-between rounded-xl border border-gray-800 bg-black/20 px-4 py-3 transition-colors hover:border-gray-700"
                >
                    <span>
                      <span className="block text-sm font-medium text-white">
                      Approvals
                      </span>
                      <span className="block text-xs text-gray-500">
                        Review bids and payouts
                      </span>
                    </span>
                  <span className="text-sm text-cyan-300">Open</span>
                </Link>
                <Link
                  href="/dashboard/agents"
                  className="flex items-center justify-between rounded-xl border border-gray-800 bg-black/20 px-4 py-3 transition-colors hover:border-gray-700"
                >
                    <span>
                      <span className="block text-sm font-medium text-white">
                        Agents
                      </span>
                      <span className="block text-xs text-gray-500">
                        Linked to your account
                      </span>
                    </span>
                  <span className="text-sm text-cyan-300">{approvals.length}</span>
                </Link>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
