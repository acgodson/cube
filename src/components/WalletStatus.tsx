"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WalletChooserModal } from "@/components/WalletChooserModal";
import { useHederaWallet } from "@/components/providers/HederaWalletProvider";

interface WalletStatusProps {
  mode?: "landing" | "dashboard";
}

const shortenAccountId = (accountId: string) => {
  if (accountId.length <= 10) {
    return accountId;
  }

  return `${accountId.slice(0, 6)}...${accountId.slice(-4)}`;
};

export function WalletStatus({ mode = "landing" }: WalletStatusProps) {
  const router = useRouter();
  const {
    accountId,
    connect,
    disconnect,
    initializing,
    isConnected,
    walletType,
  } = useHederaWallet();
  const [working, setWorking] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleConnect = async (
    walletType: "walletconnect" | "metamask"
  ) => {
    try {
      setWorking(true);
      setError("");
      const state = await connect(walletType);

      if (!state.accountId) {
        throw new Error("Failed to resolve Hedera account");
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hederaAccountId: state.accountId }),
      });

      if (!response.ok) {
        throw new Error("Failed to sign in");
      }
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setWorking(false);
      setChooserOpen(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      setWorking(true);
      setError("");
      await disconnect();
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/");
      router.refresh();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to disconnect wallet"
      );
    } finally {
      setWorking(false);
    }
  };

  const handleCopy = async () => {
    if (!accountId) return;

    try {
      await navigator.clipboard.writeText(accountId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (initializing) {
    return (
      <div className="rounded-full border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-400">
        Initializing wallet...
      </div>
    );
  }

  if (!isConnected || !accountId) {
    return (
      <div className="flex flex-col items-end gap-2">
        <WalletChooserModal
          open={chooserOpen}
          onClose={() => setChooserOpen(false)}
          onSelect={handleConnect}
          loading={working}
          error={error}
        />
        <button
          onClick={() => setChooserOpen(true)}
          disabled={working}
          className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {working ? "Connecting..." : "Connect Wallet"}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleCopy}
        className="flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-2 transition-colors hover:bg-cyan-500/20 cursor-pointer"
        title={`Click to copy: ${accountId}`}
      >
        <span className="h-2 w-2 rounded-full bg-cyan-400" />
        <span className="text-xs font-medium text-cyan-200">
          {copied ? "Copied!" : shortenAccountId(accountId)}
        </span>
        {walletType && (
          <span className="hidden rounded-full border border-cyan-500/20 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-cyan-300 md:inline-flex">
            {walletType}
          </span>
        )}
        <span className="hidden rounded-full border border-cyan-500/20 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] text-cyan-300 sm:inline-flex">
          Testnet
        </span>
      </button>
      <button
        onClick={handleDisconnect}
        disabled={working}
        className="rounded-full border border-transparent px-2.5 py-1 text-xs text-gray-500 transition-colors hover:border-gray-800 hover:bg-gray-900 hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {working ? "Disconnecting..." : "Disconnect"}
      </button>
      {mode === "dashboard" && (
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-full border border-transparent px-2.5 py-1 text-xs text-cyan-300 transition-colors hover:border-cyan-500/20 hover:bg-cyan-500/10 hover:text-cyan-200"
        >
          Open workspace
        </button>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
