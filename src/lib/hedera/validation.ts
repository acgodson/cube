/**
 * Hedera Address Validation
 *
 * Validates Hedera account IDs and wallet addresses.
 */

/**
 * Hedera Account ID format: 0.0.XXXXX
 * - Shard: 0 (currently only shard 0 exists)
 * - Realm: 0 (currently only realm 0 exists)
 * - Account: positive integer
 */
const HEDERA_ACCOUNT_REGEX = /^0\.0\.\d+$/;

/**
 * EVM address format: 0x followed by 40 hex characters
 * Hedera also supports EVM-compatible addresses
 */
const EVM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

/**
 * Validate Hedera account ID (0.0.XXXXX format)
 */
export function isValidHederaAccountId(accountId: string): boolean {
  if (!accountId || typeof accountId !== "string") return false;
  return HEDERA_ACCOUNT_REGEX.test(accountId.trim());
}

/**
 * Validate EVM address (0x... format)
 */
export function isValidEvmAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  return EVM_ADDRESS_REGEX.test(address.trim());
}

/**
 * Validate any Hedera-compatible wallet address
 * Accepts both 0.0.XXXXX and 0x... formats
 */
export function isValidHederaAddress(address: string): boolean {
  if (!address || typeof address !== "string") return false;
  const trimmed = address.trim();
  return isValidHederaAccountId(trimmed) || isValidEvmAddress(trimmed);
}

/**
 * Normalize Hedera address for storage
 * - Trims whitespace
 * - Lowercases EVM addresses
 */
export function normalizeHederaAddress(address: string): string {
  const trimmed = address.trim();
  if (isValidEvmAddress(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

/**
 * Extract account number from Hedera account ID
 */
export function extractAccountNumber(accountId: string): number | null {
  if (!isValidHederaAccountId(accountId)) return null;
  const parts = accountId.split(".");
  return parseInt(parts[2], 10);
}

/**
 * Validation result with error message
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  normalized?: string;
}

/**
 * Validate and normalize a Hedera wallet address
 */
export function validateWalletAddress(address: string): ValidationResult {
  if (!address) {
    return { valid: false, error: "Wallet address is required" };
  }

  if (typeof address !== "string") {
    return { valid: false, error: "Wallet address must be a string" };
  }

  const trimmed = address.trim();

  if (trimmed.length === 0) {
    return { valid: false, error: "Wallet address cannot be empty" };
  }

  // Check for Hedera account ID format
  if (trimmed.startsWith("0.0.")) {
    if (!isValidHederaAccountId(trimmed)) {
      return {
        valid: false,
        error: "Invalid Hedera account ID format. Expected: 0.0.XXXXX",
      };
    }
    return { valid: true, normalized: trimmed };
  }

  // Check for EVM address format
  if (trimmed.startsWith("0x")) {
    if (!isValidEvmAddress(trimmed)) {
      return {
        valid: false,
        error: "Invalid EVM address format. Expected: 0x followed by 40 hex characters",
      };
    }
    return { valid: true, normalized: trimmed.toLowerCase() };
  }

  return {
    valid: false,
    error: "Invalid wallet address format. Expected Hedera account ID (0.0.XXXXX) or EVM address (0x...)",
  };
}
