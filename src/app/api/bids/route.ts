import { NextRequest, NextResponse } from "next/server";
import { db, bids, tasks, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { eq, and } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const agentId = searchParams.get("agentId");

    let query = db.select().from(bids);

    if (taskId) {
      const allBids = await db
        .select()
        .from(bids)
        .where(eq(bids.taskId, taskId));
      return NextResponse.json({ bids: allBids });
    }

    if (agentId) {
      const allBids = await db
        .select()
        .from(bids)
        .where(eq(bids.agentId, agentId));
      return NextResponse.json({ bids: allBids });
    }

    const allBids = await query;
    return NextResponse.json({ bids: allBids });
  } catch (error) {
    console.error("Failed to fetch bids:", error);
    return NextResponse.json(
      { error: "Failed to fetch bids" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { taskId, agentId, bidAmountHbar, stakeHbar, proofRef } = body;

    if (!taskId || !agentId || bidAmountHbar === undefined || stakeHbar === undefined) {
      return NextResponse.json(
        {
          error: "Missing required fields: taskId, agentId, bidAmountHbar, stakeHbar",
        },
        { status: 400 }
      );
    }

    // Verify task exists and is open
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "open") {
      return NextResponse.json(
        { error: "Task is not accepting bids" },
        { status: 409 }
      );
    }

    // Verify agent exists
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId));

    if (!agent) {
      return NextResponse.json({ error: "Agent not found" }, { status: 404 });
    }

    // Check if agent already bid on this task
    const existingBid = await db
      .select()
      .from(bids)
      .where(and(eq(bids.taskId, taskId), eq(bids.agentId, agentId)))
      .limit(1);

    if (existingBid.length > 0) {
      return NextResponse.json(
        { error: "Agent has already bid on this task" },
        { status: 409 }
      );
    }

    const bidId = generateId("bid");

    const newBid = {
      id: bidId,
      taskId,
      agentId,
      bidAmountHbar: String(bidAmountHbar),
      stakeHbar: String(stakeHbar),
      proofRef: proofRef || null,
      status: "pending",
    };

    await db.insert(bids).values(newBid);

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "BID_SUBMITTED",
          bidId,
          taskId,
          agentId,
          bidAmountHbar,
          stakeHbar,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;

        await db.update(bids).set({ hcsSequence }).where(eq(bids.id, bidId));
      } catch (hcsError) {
        console.warn("HCS publish failed:", hcsError);
      }
    }

    const [created] = await db.select().from(bids).where(eq(bids.id, bidId));

    return NextResponse.json(
      {
        bid: created,
        agent,
        task,
        hcsSequence,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create bid:", error);
    return NextResponse.json(
      { error: "Failed to create bid" },
      { status: 500 }
    );
  }
}
