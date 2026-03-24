"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { connectWallet } from "@/lib/hashpack";

export default function LoginPage() {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleConnect() {
    try {
      setConnecting(true);
      setError("");

      const { accountId, network } = await connectWallet();

      if (network !== "testnet") {
        setError("Please connect to Hedera Testnet");
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
    } catch (err: any) {
      setError(err.message || "Failed to connect wallet");
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <img
            src="/cube-logo-transparent.png"
            alt="Cube"
            className="mx-auto h-24 w-auto"
          />
          <h1 className="mt-6 text-4xl font-bold text-white">
            Welcome to Cube
          </h1>
          <p className="mt-2 text-gray-400">
            Connect your HashPack wallet to continue
          </p>
        </div>

        <div className="mt-8 space-y-4">
          <button
            onClick={handleConnect}
            disabled={connecting}
            className="w-full flex items-center justify-center px-6 py-3 border border-transparent text-base font-medium rounded-lg text-black bg-white hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {connecting ? "Connecting..." : "Connect HashPack"}
          </button>

          {error && (
            <div className="rounded-lg bg-red-900/20 border border-red-500 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          <p className="text-xs text-gray-500 text-center">
            Make sure you have HashPack installed and are connected to Hedera
            Testnet
          </p>
        </div>
      </div>
    </div>
  );
}
