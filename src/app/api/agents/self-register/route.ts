/**
 * Agent Self-Registration Endpoint
 *
 * This endpoint is designed for agents (not humans) to register themselves.
 * Called by the OpenClaw Cube skill when an agent joins the marketplace.
 *
 * Key differences from manual registration:
 * - NO claimed skills (skills are built from history only)
 * - Automatically configures webhook URL
 * - Can accept existing HOL UAID
 * - Returns simple response for agent to store
 */

import { NextRequest, NextResponse } from "next/server";
import { db, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";
import { publishToHcs } from "@/lib/hedera";
import { validateWalletAddress } from "@/lib/hedera/validation";
import { generateAgentDID } from "@/lib/hol/registry";

interface SelfRegisterRequest {
  // Required
  name: string;
  walletAddress: string;
  openclawGatewayUrl: string; // e.g., "http://localhost:18789"
  model: string;

  // Optional - if agent already has HOL profile
  holUaid?: string;

  // Optional - custom webhook path (defaults to /hooks/agent)
  webhookPath?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: SelfRegisterRequest = await request.json();

    const {
      name,
      walletAddress,
      openclawGatewayUrl,
      model,
      holUaid,
      webhookPath = "/hooks/agent",
    } = body;

    // Validate required fields
    if (!name || !walletAddress || !openclawGatewayUrl || !model) {
      return NextResponse.json(
        {
          error: "Missing required fields",
          required: ["name", "walletAddress", "openclawGatewayUrl", "model"],
        },
        { status: 400 }
      );
    }

    // Validate Hedera wallet address
    const walletValidation = validateWalletAddress(walletAddress);
    if (!walletValidation.valid) {
      return NextResponse.json(
        {
          error: "Invalid wallet address",
          details: walletValidation.error,
          hint: "Expected Hedera account ID (0.0.XXXXX) or EVM address (0x...)",
        },
        { status: 400 }
      );
    }
    const normalizedWallet = walletValidation.normalized!;

    // Check if agent with this wallet already exists
    const existing = await db
      .select()
      .from(agents)
      .where(eq(agents.walletAddress, normalizedWallet))
      .limit(1);

    if (existing.length > 0) {
      // Return existing agent info instead of error
      // This allows idempotent registration
      return NextResponse.json({
        status: "already_registered",
        agentId: existing[0].id,
        name: existing[0].name,
        message: "You are already registered on Cube Protocol",
      });
    }

    // Build webhook URL from OpenClaw Gateway URL
    // Only add webhookPath if the gateway URL doesn't already include /hooks/
    const baseUrl = openclawGatewayUrl.replace(/\/$/, "");
    const webhookUrl = baseUrl.includes("/hooks/")
      ? baseUrl
      : `${baseUrl}${webhookPath}`;

    const agentId = generateId("agent");
    const agentDID = generateAgentDID(agentId);

    // Create agent with NO claimed skills
    // Skills will be built purely from task completion history
    const newAgent = {
      id: agentId,
      name,
      walletAddress: normalizedWallet,
      endpointUrl: webhookUrl,
      model,
      capabilities: [], // EMPTY - no claimed skills
      status: "active",
      trustScore: "0",
      tasksCompleted: "0",
      tasksAccepted: "0",
      tasksChallenged: "0",
      tasksRejected: "0",
    };

    await db.insert(agents).values(newAgent);

    // Publish registration to HCS
    const topicId = process.env.HCS_TOPIC_ID;
    let hcsSequence: string | null = null;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "AGENT_SELF_REGISTERED",
          agentId,
          name,
          walletAddress: normalizedWallet,
          model,
          webhookUrl,
          // If they have existing HOL profile, reference it
          holUaid: holUaid || null,
          // HCS-11 compatible profile (minimal - no claimed skills)
          hcs11Profile: {
            version: "1.0",
            type: 1,
            display_name: name,
            uaid: holUaid,
            aiAgent: {
              type: 1, // autonomous
              capabilities: [], // NO CLAIMS
              model,
              creator: "Cube Protocol",
            },
          },
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;
      } catch (error) {
        console.warn("HCS publish failed:", error);
      }
    }

    // Build the callback URL where we'll send task offers
    const cubeApiUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    return NextResponse.json({
      status: "registered",
      agentId,
      name,
      walletAddress: normalizedWallet,
      hcsSequence,

      // Instructions for the agent
      instructions: {
        // This is where Cube will send task offers
        taskDelivery: "Tasks will be sent to your OpenClaw webhook",

        // How to check for tasks manually
        checkTasks: `GET ${cubeApiUrl}/api/tasks?status=open`,

        // How to submit bids
        submitBid: `POST ${cubeApiUrl}/api/bids`,

        // How to submit results
        submitResult: `POST ${cubeApiUrl}/api/results`,

        // Your skills
        skills: "Your skills will be built from completed task history. Complete tasks to build your reputation.",

        // Semantic matching
        matching: "Tasks are matched to you based on semantic similarity to your past successful work. New agents start with baseline score (0.1).",
      },
    }, { status: 201 });
  } catch (error) {
    console.error("Self-registration failed:", error);
    return NextResponse.json(
      { error: "Registration failed", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * GET - Check if a wallet is already registered
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const walletAddress = searchParams.get("wallet");

  if (!walletAddress) {
    return NextResponse.json(
      { error: "wallet parameter required" },
      { status: 400 }
    );
  }

  const existing = await db
    .select()
    .from(agents)
    .where(eq(agents.walletAddress, walletAddress))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ registered: false });
  }

  return NextResponse.json({
    registered: true,
    agentId: existing[0].id,
    name: existing[0].name,
  });
}
