import { NextRequest, NextResponse } from "next/server";
import { db, tasks, bids, agents } from "@/lib/db";
import { rankBidsForTask } from "@/lib/scoring";
import { publishToHcs } from "@/lib/hedera";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: taskId } = await params;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "open") {
      return NextResponse.json(
        { error: "Task is not open for selection" },
        { status: 409 }
      );
    }

    // Get all bids and rank them
    const taskBids = await db
      .select()
      .from(bids)
      .where(eq(bids.taskId, taskId));

    if (taskBids.length === 0) {
      return NextResponse.json(
        { error: "No bids available for selection" },
        { status: 409 }
      );
    }

    const allAgents = await db.select().from(agents);
    const rankedBids = await rankBidsForTask(task, taskBids, allAgents);

    // Select the top-ranked bid
    const winner = rankedBids[0];
    if (!winner) {
      return NextResponse.json(
        { error: "Failed to determine winner" },
        { status: 500 }
      );
    }

    // Update winning bid status
    await db
      .update(bids)
      .set({ status: "selected", updatedAt: new Date() })
      .where(eq(bids.id, winner.bidId));

    // Reject other bids
    for (const bid of taskBids) {
      if (bid.id !== winner.bidId) {
        await db
          .update(bids)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(bids.id, bid.id));
      }
    }

    // Update task status
    await db
      .update(tasks)
      .set({
        status: "assigned",
        winningBidId: winner.bidId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "WINNER_SELECTED",
          taskId,
          winningBidId: winner.bidId,
          winningAgentId: winner.agentId,
          score: winner.score,
          breakdown: winner.breakdown,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;
      } catch (hcsError) {
        console.warn("HCS publish failed:", hcsError);
      }
    }

    const [updatedTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    const [winningAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, winner.agentId));

    return NextResponse.json({
      task: updatedTask,
      winner: {
        ...winner,
        agent: winningAgent,
      },
      rankedBids,
      hcsSequence,
    });
  } catch (error) {
    console.error("Failed to select winner:", error);
    return NextResponse.json(
      { error: "Failed to select winner" },
      { status: 500 }
    );
  }
}
