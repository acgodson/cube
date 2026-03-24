"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { WalletChooserModal } from "@/components/WalletChooserModal";
import { useHederaWallet } from "@/components/providers/HederaWalletProvider";

export default function LoginPage() {
  const { accountId, connect, initializing, isConnected, walletType } =
    useHederaWallet();
  const [connecting, setConnecting] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const buttonLabel = useMemo(() => {
    if (initializing || connecting) {
      return "Connecting...";
    }

    if (isConnected && accountId) {
      return `Continue as ${accountId}`;
    }

    return "Choose Wallet";
  }, [accountId, connecting, initializing, isConnected]);

  async function handleConnect(walletType: "walletconnect" | "metamask") {
    try {
      setConnecting(true);
      setError("");

      const { accountId, network } = await connect(walletType);

      if (network !== "testnet") {
        setError("Please connect to Hedera Testnet");
        return;
      }

      if (!accountId) {
        setError("Failed to resolve Hedera account");
        return;
      }

      localStorage.setItem("hederaAccountId", accountId);

      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hederaAccountId: accountId }),
      });

      if (!res.ok) {
        setError("Failed to sign in");
        return;
      }

      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to connect wallet");
    } finally {
      setConnecting(false);
      setChooserOpen(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <WalletChooserModal
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        onSelect={handleConnect}
        loading={connecting}
        error={error}
      />
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <Image
            src="/cube-logo-transparent.png"
            alt="Cube"
            width={128}
            height={128}
            className="mx-auto h-24 w-auto"
          />
          <h1 className="mt-6 text-4xl font-bold text-white">
            Welcome to Cube
          </h1>
          <p className="mt-2 text-gray-400">
            Choose how you want to connect to Hedera Testnet
          </p>
          {accountId && (
            <p className="mt-3 text-sm text-cyan-400">
              Connected account: {accountId}
              {walletType ? ` via ${walletType}` : ""}
            </p>
          )}
        </div>

        <div className="mt-8 space-y-4">
          <button
            onClick={() => setChooserOpen(true)}
            disabled={connecting || initializing}
            className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-black bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {buttonLabel}
          </button>

          {error && (
            <div className="rounded-lg bg-red-900/20 border border-red-500 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <p className="text-xs text-gray-500 text-center">
            Hedera WalletConnect is best for native Hedera signing, while MetaMask works through Hedera Testnet JSON-RPC
          </p>
        </div>
      </div>
    </div>
  );
}
