import { NextRequest, NextResponse } from "next/server";
import { db, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { publishToHcs } from "@/lib/hedera";

/**
 * HCS-11 Profile for AI Agents
 * This is the standard profile format for registering on HOL
 */
interface HCS11AgentProfile {
  version: "1.0";
  type: 1; // AI Agent
  display_name: string;
  uaid?: string;
  alias?: string;
  bio?: string;
  aiAgent: {
    type: 0 | 1; // 0 = manual, 1 = autonomous
    capabilities: number[];
    model: string;
    creator?: string;
  };
  // Cube-specific extensions
  cube?: {
    agentId: string;
    webhookUrl: string;
    skills: string[];
  };
}

export async function GET() {
  try {
    const allAgents = await db.select().from(agents);
    return NextResponse.json({ agents: allAgents });
  } catch (error) {
    console.error("Failed to fetch agents:", error);
    return NextResponse.json(
      { error: "Failed to fetch agents" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      name,
      walletAddress,
      endpointUrl,
      model,
      capabilities,
      // Optional: OpenClaw webhook config
      openclawWebhookUrl,
      openclawHookToken,
      // Optional: Direct HOL UAID if already registered
      holUaid,
    } = body;

    if (!name || !walletAddress || !endpointUrl || !model) {
      return NextResponse.json(
        { error: "Missing required fields: name, walletAddress, endpointUrl, model" },
        { status: 400 }
      );
    }

    // Check if agent with this wallet already exists
    const existing = await db
      .select()
      .from(agents)
      .where(eq(agents.walletAddress, walletAddress))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "Agent with this wallet address already exists", agent: existing[0] },
        { status: 409 }
      );
    }

    const agentId = generateId("agent");

    // Determine webhook URL for task notifications
    // Priority: explicit openclawWebhookUrl > endpointUrl
    const webhookUrl = openclawWebhookUrl || endpointUrl;

    const newAgent = {
      id: agentId,
      name,
      walletAddress,
      endpointUrl: webhookUrl,
      model,
      capabilities: capabilities || [],
      status: "active",
      trustScore: "0",
      tasksCompleted: "0",
      tasksAccepted: "0",
      tasksChallenged: "0",
      tasksRejected: "0",
    };

    await db.insert(agents).values(newAgent);

    const [created] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    // Build HCS-11 compatible profile
    const hcs11Profile: HCS11AgentProfile = {
      version: "1.0",
      type: 1, // AI Agent
      display_name: name,
      uaid: holUaid,
      bio: `Cube Protocol agent specializing in: ${(capabilities || []).join(", ")}`,
      aiAgent: {
        type: 1, // autonomous
        capabilities: mapCapabilitiesToHCS11(capabilities || []),
        model,
        creator: "Cube Protocol",
      },
      cube: {
        agentId,
        webhookUrl,
        skills: capabilities || [],
      },
    };

    // Publish registration to HCS
    const topicId = process.env.HCS_TOPIC_ID;
    let hcsSequence: string | null = null;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "AGENT_REGISTERED",
          agentId,
          name,
          walletAddress,
          model,
          capabilities: capabilities || [],
          hcs11Profile,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;
      } catch (error) {
        console.warn("HCS publish failed (continuing):", error);
      }
    }

    // Generate webhook URLs for OpenClaw integration
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const cubeWebhookUrl = `${baseUrl}/api/webhook/openclaw/${agentId}`;

    return NextResponse.json({
      agent: created,
      hcsSequence,
      integration: {
        // For OpenClaw agents - set this as your webhook URL
        cubeWebhookUrl,
        // Instructions for OpenClaw setup
        openclawSetup: {
          step1: "Copy the 'cube' skill folder to ~/.openclaw/workspace/skills/",
          step2: `Set CUBE_AGENT_ID=${agentId} in your OpenClaw config`,
          step3: `Configure webhook: ${cubeWebhookUrl}`,
          hookConfig: {
            enabled: true,
            token: openclawHookToken || "your-secret-token",
            cubeAgentId: agentId,
          },
        },
        // SSE connection for real-time task feed
        gatewayUrl: `${baseUrl}/api/gateway?agentId=${agentId}`,
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to create agent:", error);
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 }
    );
  }
}

/**
 * Map human-readable capabilities to HCS-11 capability enum values
 * Based on HOL standard capability definitions
 */
function mapCapabilitiesToHCS11(capabilities: string[]): number[] {
  const capabilityMap: Record<string, number> = {
    // Common AI capabilities
    "text_generation": 0,
    "text_analysis": 1,
    "code_generation": 2,
    "code_review": 3,
    "data_extraction": 4,
    "pdf_extraction": 4,
    "data_analysis": 5,
    "summarization": 6,
    "translation": 7,
    "image_analysis": 8,
    "research": 9,
  };

  return capabilities
    .map(cap => capabilityMap[cap.toLowerCase()])
    .filter(num => num !== undefined);
}
