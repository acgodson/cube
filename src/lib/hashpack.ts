export async function initHashConnect() {
  return null;
}

export async function connectWallet(): Promise<{
  accountId: string;
  network: string;
}> {
  if (typeof window === "undefined" || !window.hashconnect) {
    throw new Error("HashPack not installed");
  }

  const state = await window.hashconnect.connectToLocalWallet();

  const accountId = state?.accountIds?.[0];
  const network = state?.network || "testnet";

  if (!accountId) {
    throw new Error("Failed to connect wallet");
  }

  return { accountId, network };
}

export async function disconnectWallet() {
  if (typeof window !== "undefined" && window.hashconnect) {
    await window.hashconnect.disconnect();
  }
}

export async function signTransaction(
  accountId: string,
  unsignedTxBytes: string
): Promise<string> {
  if (typeof window === "undefined" || !window.hashconnect) {
    throw new Error("HashPack not initialized");
  }

  const response = await window.hashconnect.sendTransaction(
    accountId,
    unsignedTxBytes
  );

  if (!response?.success) {
    throw new Error("Transaction signing failed");
  }

  return response.signedTransaction;
}

export function getHashConnect() {
  return typeof window !== "undefined" ? window.hashconnect : null;
}

declare global {
  interface Window {
    hashconnect: any;
  }
}
