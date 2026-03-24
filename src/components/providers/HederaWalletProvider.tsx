"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  addMetaMaskListeners,
  connectWallet,
  disconnectWallet,
  getWalletState,
  restoreWalletState,
  signTransaction,
  subscribeWalletState,
  type WalletState,
  type WalletType,
} from "@/lib/hedera/wallet-connect";

interface HederaWalletContextValue extends WalletState {
  initializing: boolean;
  connect: (walletType: WalletType) => Promise<WalletState>;
  disconnect: typeof disconnectWallet;
  sign: typeof signTransaction;
  refresh: () => Promise<void>;
}

const HederaWalletContext = createContext<HederaWalletContextValue | null>(null);

export function HederaWalletProvider({ children }: { children: ReactNode }) {
  const [walletState, setWalletState] = useState<WalletState>(getWalletState());
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeWalletState(setWalletState);
    const removeMetaMaskListeners = addMetaMaskListeners(() => {
      restoreWalletState().catch((error) => {
        console.error("Failed to sync MetaMask wallet state:", error);
      });
    });

    restoreWalletState()
      .catch((error) => {
        console.error("Failed to restore wallet state:", error);
      })
      .finally(() => {
        setInitializing(false);
      });

    return () => {
      unsubscribe();
      removeMetaMaskListeners();
    };
  }, []);

  const value = useMemo<HederaWalletContextValue>(
    () => ({
      ...walletState,
      initializing,
      connect: connectWallet,
      disconnect: disconnectWallet,
      sign: signTransaction,
      refresh: async () => {
        await restoreWalletState();
      },
    }),
    [initializing, walletState]
  );

  return (
    <HederaWalletContext.Provider value={value}>
      {children}
    </HederaWalletContext.Provider>
  );
}

export function useHederaWallet() {
  const context = useContext(HederaWalletContext);

  if (!context) {
    throw new Error("useHederaWallet must be used within HederaWalletProvider");
  }

  return context;
}
