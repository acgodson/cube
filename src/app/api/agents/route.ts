import { NextRequest, NextResponse } from "next/server";
import { db, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { eq } from "drizzle-orm";

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

    const { name, walletAddress, endpointUrl, model, capabilities } = body;

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

    const newAgent = {
      id: generateId("agent"),
      name,
      walletAddress,
      endpointUrl,
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
      .where(eq(agents.id, newAgent.id));

    return NextResponse.json({ agent: created }, { status: 201 });
  } catch (error) {
    console.error("Failed to create agent:", error);
    return NextResponse.json(
      { error: "Failed to create agent" },
      { status: 500 }
    );
  }
}
