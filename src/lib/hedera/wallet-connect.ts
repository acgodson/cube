"use client";

import {
  DAppConnector,
  HederaChainId,
  HederaJsonRpcMethod,
  HederaSessionEvent,
} from "@hashgraph/hedera-wallet-connect";
import { LedgerId, Transaction } from "@hiero-ledger/sdk";

export type HederaNetwork = "testnet" | "mainnet";
export type WalletType = "walletconnect" | "metamask";

export interface WalletState {
  accountId: string | null;
  evmAddress: string | null;
  isConnected: boolean;
  network: HederaNetwork;
  walletType: WalletType | null;
}

interface EthereumProvider {
  request: (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
}

const DEFAULT_PROJECT_ID = "377d75bb6f86a2ffd427d032ff6ea7d3";
const META_MASK_CHAIN_ID = "0x128";
const META_MASK_NETWORK = {
  chainId: META_MASK_CHAIN_ID,
  chainName: "Hedera Testnet",
  nativeCurrency: {
    name: "HBAR",
    symbol: "HBAR",
    decimals: 18,
  },
  rpcUrls: ["https://testnet.hashio.io/api"],
  blockExplorerUrls: ["https://hashscan.io/testnet"],
};
const MIRROR_NODE_BASE_URL = "https://testnet.mirrornode.hedera.com/api/v1";
const STORAGE_KEYS = {
  accountId: "hederaAccountId",
  evmAddress: "hederaEvmAddress",
  walletType: "cubeWalletType",
} as const;

const listeners = new Set<(state: WalletState) => void>();
let connector: DAppConnector | null = null;
let initPromise: Promise<void> | null = null;
let currentState: WalletState = {
  accountId: null,
  evmAddress: null,
  isConnected: false,
  network: "testnet",
  walletType: null,
};

const getProjectId = () => {
  return (
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || DEFAULT_PROJECT_ID
  );
};

const getEthereumProvider = () => {
  const provider =
    typeof window !== "undefined"
      ? ((window as Window & { ethereum?: unknown }).ethereum as
          | EthereumProvider
          | undefined)
      : undefined;

  if (!provider) {
    throw new Error("MetaMask is not installed");
  }

  return provider;
};

const hexToBytes = (hex: string) => {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(normalized.length / 2);

  for (let index = 0; index < normalized.length; index += 2) {
    bytes[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
  }

  return bytes;
};

const bytesToHex = (bytes: Uint8Array) => {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
};

const setStoredWalletState = (state: WalletState) => {
  if (typeof window === "undefined") {
    return;
  }

  if (state.accountId) {
    window.localStorage.setItem(STORAGE_KEYS.accountId, state.accountId);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.accountId);
  }

  if (state.evmAddress) {
    window.localStorage.setItem(STORAGE_KEYS.evmAddress, state.evmAddress);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.evmAddress);
  }

  if (state.walletType) {
    window.localStorage.setItem(STORAGE_KEYS.walletType, state.walletType);
  } else {
    window.localStorage.removeItem(STORAGE_KEYS.walletType);
  }
};

const notify = () => {
  setStoredWalletState(currentState);

  for (const listener of listeners) {
    listener(currentState);
  }
};

const setState = (state: WalletState) => {
  currentState = state;
  notify();
  return currentState;
};

const clearState = () => {
  return setState({
    accountId: null,
    evmAddress: null,
    isConnected: false,
    network: "testnet",
    walletType: null,
  });
};

const getConnector = () => {
  if (typeof window === "undefined") {
    throw new Error("WalletConnect is only available in the browser");
  }

  if (!connector) {
    connector = new DAppConnector(
      {
        name: "Cube Protocol",
        description: "Proof-of-skill routing for AI agents on Hedera",
        url: window.location.origin,
        icons: [`${window.location.origin}/cube-square-banner.png`],
      },
      LedgerId.TESTNET,
      getProjectId(),
      Object.values(HederaJsonRpcMethod),
      [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
      [HederaChainId.Testnet]
    );
  }

  return connector;
};

const syncWalletConnectState = () => {
  const accountId = connector?.signers[0]?.getAccountId()?.toString() ?? null;

  if (!accountId) {
    return clearState();
  }

  return setState({
    accountId,
    evmAddress: null,
    isConnected: true,
    network: "testnet",
    walletType: "walletconnect",
  });
};

const ensureMetaMaskNetwork = async () => {
  const provider = getEthereumProvider();

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: META_MASK_CHAIN_ID }],
    });
  } catch (error) {
    const switchError = error as { code?: number };

    if (switchError.code !== 4902) {
      throw error;
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [META_MASK_NETWORK],
    });
  }
};

const resolveAccountIdFromEvmAddress = async (evmAddress: string) => {
  const response = await fetch(
    `${MIRROR_NODE_BASE_URL}/accounts/${evmAddress.toLowerCase()}`
  );

  if (!response.ok) {
    throw new Error("Unable to resolve Hedera account from MetaMask address");
  }

  const payload = (await response.json()) as {
    account?: string;
    account_id?: string;
  };
  const accountId = payload.account || payload.account_id;

  if (!accountId) {
    throw new Error("MetaMask account is not linked to a Hedera account ID");
  }

  return accountId;
};

const syncMetaMaskState = async () => {
  if (typeof window === "undefined" || !window.ethereum) {
    return clearState();
  }

  const provider = getEthereumProvider();
  const chainId = (await provider.request({
    method: "eth_chainId",
  })) as string;
  const accounts = (await provider.request({
    method: "eth_accounts",
  })) as string[];
  const evmAddress = accounts[0] ?? null;

  if (!evmAddress || chainId.toLowerCase() !== META_MASK_CHAIN_ID) {
    return clearState();
  }

  const accountId = await resolveAccountIdFromEvmAddress(evmAddress);

  return setState({
    accountId,
    evmAddress,
    isConnected: true,
    network: "testnet",
    walletType: "metamask",
  });
};

export const initWalletConnect = async () => {
  const dappConnector = getConnector();

  if (!initPromise) {
    initPromise = dappConnector.init({ logger: "error" }).then(() => {
      const storedWalletType =
        typeof window !== "undefined"
          ? (window.localStorage.getItem(STORAGE_KEYS.walletType) as WalletType | null)
          : null;

      if (storedWalletType === "walletconnect") {
        syncWalletConnectState();
      }
    });
  }

  await initPromise;

  return dappConnector;
};

export const restoreWalletState = async () => {
  if (typeof window === "undefined") {
    return currentState;
  }

  const storedWalletType = window.localStorage.getItem(
    STORAGE_KEYS.walletType
  ) as WalletType | null;

  if (storedWalletType === "walletconnect") {
    await initWalletConnect();
    return syncWalletConnectState();
  }

  if (storedWalletType === "metamask") {
    return syncMetaMaskState().catch(() => clearState());
  }

  return currentState;
};

export const subscribeWalletState = (
  listener: (state: WalletState) => void
) => {
  listeners.add(listener);
  listener(currentState);

  return () => {
    listeners.delete(listener);
  };
};

export const getWalletState = () => {
  return currentState;
};

export async function connectWallet(walletType: WalletType = "walletconnect") {
  if (walletType === "walletconnect") {
    const dappConnector = await initWalletConnect();
    await dappConnector.openModal();
    const state = syncWalletConnectState();

    if (!state.accountId) {
      throw new Error("Failed to connect Hedera wallet");
    }

    return state;
  }

  await ensureMetaMaskNetwork();
  const provider = getEthereumProvider();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as string[];
  const evmAddress = accounts[0];

  if (!evmAddress) {
    throw new Error("Failed to connect MetaMask");
  }

  const accountId = await resolveAccountIdFromEvmAddress(evmAddress);

  return setState({
    accountId,
    evmAddress,
    isConnected: true,
    network: "testnet",
    walletType: "metamask",
  });
}

export async function disconnectWallet() {
  if (currentState.walletType === "walletconnect") {
    const dappConnector = await initWalletConnect();
    await dappConnector.disconnectAll();
  }

  return clearState();
}

export async function signTransaction(
  accountId: string,
  unsignedTxBytes: string
): Promise<string> {
  if (currentState.walletType !== "walletconnect") {
    throw new Error(
      "MetaMask is connected, but Cube approvals currently require a Hedera wallet session"
    );
  }

  const dappConnector = await initWalletConnect();
  const transaction = Transaction.fromBytes(hexToBytes(unsignedTxBytes));

  await dappConnector.signTransaction({
    signerAccountId: `hedera:testnet:${accountId}`,
    transactionBody: transaction,
  });

  return bytesToHex(transaction.toBytes());
}

export const addMetaMaskListeners = (onChange: () => void) => {
  if (typeof window === "undefined" || !window.ethereum) {
    return () => undefined;
  }

  const provider = getEthereumProvider();
  const handleAccountsChanged = () => {
    onChange();
  };
  const handleChainChanged = () => {
    onChange();
  };

  provider.on("accountsChanged", handleAccountsChanged);
  provider.on("chainChanged", handleChainChanged);

  return () => {
    provider.removeListener("accountsChanged", handleAccountsChanged);
    provider.removeListener("chainChanged", handleChainChanged);
  };
};

export async function getDAppConnector() {
  return initWalletConnect();
}
