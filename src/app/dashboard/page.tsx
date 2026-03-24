"use client";

import Link from "next/link";
import { useHederaWallet } from "@/components/providers/HederaWalletProvider";

const shortenAccountId = (accountId: string | null) => {
  if (!accountId) {
    return "No wallet connected";
  }

  if (accountId.length <= 12) {
    return accountId;
  }

  return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`;
};

export default function DashboardPage() {
  const { accountId, initializing, isConnected, walletType } =
    useHederaWallet();

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-950 to-cyan-950/40 p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-cyan-300">
              Hedera Wallet
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white">Cube Workspace</h1>
              <p className="mt-2 max-w-2xl text-gray-400">
                Manage pending approvals, track agent activity, and route tasks with a connected Hedera account.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-black/30 p-5 lg:min-w-80">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">
              Current Session
            </div>
            <div className="mt-3 flex items-center gap-3">
              <span
                className={`h-2.5 w-2.5 rounded-full ${isConnected ? "bg-cyan-400" : "bg-gray-600"}`}
              />
              <span className="text-lg font-semibold text-white">
                {initializing ? "Initializing..." : shortenAccountId(accountId)}
              </span>
            </div>
            <p className="mt-2 text-sm text-gray-400">
              {initializing
                ? "Preparing WalletConnect session"
                : isConnected
                  ? `Connected to Hedera Testnet via ${walletType ?? "wallet"}`
                  : "Connect a Hedera wallet to approve transactions and manage Cube tasks"}
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="text-sm text-gray-500">Primary Action</div>
          <div className="mt-2 text-xl font-semibold text-white">Review approvals</div>
          <p className="mt-2 text-sm text-gray-400">
            Approve bid stakes and sign pending Hedera transactions from one place.
          </p>
          <Link
            href="/dashboard/approvals"
            className="mt-5 inline-flex rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-200"
          >
            Open approvals
          </Link>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="text-sm text-gray-500">Agent Layer</div>
          <div className="mt-2 text-xl font-semibold text-white">Track registered agents</div>
          <p className="mt-2 text-sm text-gray-400">
            Inspect active agents, task-fit signals, and routing readiness across the network.
          </p>
          <Link
            href="/dashboard/agents"
            className="mt-5 inline-flex rounded-full border border-gray-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:border-gray-500"
          >
            View agents
          </Link>
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6">
          <div className="text-sm text-gray-500">Task Layer</div>
          <div className="mt-2 text-xl font-semibold text-white">Explore Trending Tasks</div>
          <p className="mt-2 text-sm text-gray-400">
            Review tasks posted by users in need of agents
          </p>
          <Link
            href="/"
            className="mt-5 inline-flex rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-200 transition-colors hover:bg-cyan-500/20"
          >
            Back to task feed
          </Link>
        </div>
      </section>
    </div>
  );
}
