/**
 * HOL (Hashgraph Online) Registry Client
 *
 * Interfaces with the HOL Registry Broker API to:
 * - Lookup existing agent profiles by UAID
 * - Search for agents by capabilities
 * - Verify HCS-11 profiles
 */

const HOL_API_BASE = "https://hol.org/registry/api/v1";

/**
 * HCS-11 Agent Profile (from HOL)
 */
export interface HCS11Profile {
  version: string;
  type: number; // 1 = AI Agent
  display_name: string;
  uaid?: string;
  alias?: string;
  bio?: string;
  profileImage?: string;
  inboundTopicId?: string;
  outboundTopicId?: string;
  aiAgent?: {
    type: number; // 0 = manual, 1 = autonomous
    capabilities: number[];
    model: string;
    creator?: string;
  };
  socials?: Array<{ platform: string; handle: string }>;
  properties?: Record<string, unknown>;
}

/**
 * HOL Agent Lookup Response
 */
export interface HOLAgentResponse {
  uaid: string;
  profile: HCS11Profile;
  trustScore?: number;
  registries?: string[];
  indexed_at?: string;
}

/**
 * Lookup an agent by UAID from HOL Registry
 */
export async function lookupAgentByUAID(uaid: string): Promise<HOLAgentResponse | null> {
  try {
    const response = await fetch(`${HOL_API_BASE}/agents/${encodeURIComponent(uaid)}`, {
      method: "GET",
      headers: {
        "Accept": "application/json",
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      console.error(`HOL lookup failed: ${response.status}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("HOL API error:", error);
    return null;
  }
}

/**
 * Search for agents by capabilities
 */
export async function searchAgentsByCapability(
  capabilities: string[],
  options?: {
    minTrust?: number;
    limit?: number;
  }
): Promise<HOLAgentResponse[]> {
  try {
    const params = new URLSearchParams();
    if (options?.minTrust) params.set("minTrust", String(options.minTrust));
    if (options?.limit) params.set("limit", String(options.limit));

    const response = await fetch(`${HOL_API_BASE}/search/capabilities?${params}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({ capabilities }),
    });

    if (!response.ok) {
      console.error(`HOL search failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    return data.agents || data.results || [];
  } catch (error) {
    console.error("HOL search error:", error);
    return [];
  }
}

/**
 * Check if a UAID is valid format
 * Format: uaid:did:...:uid=...;registry=...;nativeId=...
 */
export function isValidUAID(uaid: string): boolean {
  if (!uaid.startsWith("uaid:")) return false;
  // Basic format check
  return uaid.includes(";") || uaid.includes("did:");
}

/**
 * Extract Hedera account from UAID if present
 * Example: uaid:did:...:nativeId=hedera:testnet:0.0.12345
 */
export function extractHederaAccountFromUAID(uaid: string): string | null {
  const match = uaid.match(/hedera:(?:testnet|mainnet):(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

/**
 * Import agent from HOL into Cube
 *
 * If an agent already exists on HOL, we can import their profile
 * instead of creating a new registration.
 */
export async function importAgentFromHOL(uaid: string): Promise<{
  success: boolean;
  profile?: HCS11Profile;
  error?: string;
}> {
  const agent = await lookupAgentByUAID(uaid);

  if (!agent) {
    return { success: false, error: "Agent not found on HOL registry" };
  }

  if (agent.profile.type !== 1) {
    return { success: false, error: "Not an AI agent profile (type must be 1)" };
  }

  return {
    success: true,
    profile: agent.profile,
  };
}
