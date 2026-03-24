"use client";

import Image from "next/image";
import { createPortal } from "react-dom";
import type { WalletType } from "@/lib/hedera/wallet-connect";

interface WalletChooserModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (walletType: WalletType) => Promise<void>;
  loading?: boolean;
  error?: string;
}

const OPTIONS: Array<{
  walletType: WalletType;
  title: string;
  description: string;
  icon: string;
}> = [
  {
    walletType: "walletconnect",
    title: "Hedera Wallet",
    description: "Use Hedera WalletConnect with native Hedera wallet signing",
    icon: "/walletconnect-logo.svg",
  },
  {
    walletType: "metamask",
    title: "MetaMask",
    description: "Use MetaMask on Hedera Testnet through the Hedera JSON-RPC network",
    icon: "/metamask-logo.svg",
  },
];

export function WalletChooserModal({
  open,
  onClose,
  onSelect,
  loading = false,
  error,
}: WalletChooserModalProps) {
  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 overflow-y-auto bg-black/80 p-4 sm:flex sm:items-center sm:justify-center sm:p-6"
      style={{ zIndex: 2147483647 }}
    >
      <div className="flex min-h-dvh w-full items-start justify-center sm:min-h-0">
        <div className="relative my-auto w-full max-w-lg overflow-hidden rounded-3xl border border-gray-800 bg-gray-950 p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">Choose a wallet</h2>
              <p className="mt-2 text-sm text-gray-400">
                Select how you want Cube to connect on Hedera Testnet.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-gray-800 px-3 py-1 text-sm text-gray-400 transition-colors hover:text-white"
            >
              Close
            </button>
          </div>

          <div className="mt-6 grid gap-3">
            {OPTIONS.map((option) => (
              <button
                key={option.walletType}
                onClick={() => onSelect(option.walletType)}
                disabled={loading}
                className="flex items-center gap-4 rounded-2xl border border-gray-800 bg-gray-900/80 p-4 text-left transition-colors hover:border-cyan-500/40 hover:bg-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white">
                  <Image
                    src={option.icon}
                    alt={option.title}
                    width={28}
                    height={28}
                  />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-white">
                    {option.title}
                  </div>
                  <p className="mt-1 text-sm text-gray-400">
                    {option.description}
                  </p>
                </div>
              </button>
            ))}
          </div>

          {error && (
            <div className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
