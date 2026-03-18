import { NextRequest, NextResponse } from "next/server";
import { db, tasks, bids, agents } from "@/lib/db";
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

    if (task.status !== "validated") {
      return NextResponse.json(
        { error: "Task must be validated before payout" },
        { status: 409 }
      );
    }

    if (!task.winningBidId) {
      return NextResponse.json(
        { error: "Task has no winning bid" },
        { status: 409 }
      );
    }

    // Get winning bid and agent
    const [winningBid] = await db
      .select()
      .from(bids)
      .where(eq(bids.id, task.winningBidId));

    if (!winningBid) {
      return NextResponse.json(
        { error: "Winning bid not found" },
        { status: 404 }
      );
    }

    const [winningAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, winningBid.agentId));

    // In production, this would call the escrow contract to release funds
    // For MVP demo, we mark it as paid and log the transaction
    const payoutTxHash = `demo_payout_${Date.now()}`;

    await db
      .update(tasks)
      .set({
        status: "paid",
        payoutTxHash,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "PAYOUT_RELEASED",
          taskId,
          winningBidId: task.winningBidId,
          agentId: winningBid.agentId,
          rewardHbar: task.rewardHbar,
          payoutTxHash,
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

    return NextResponse.json({
      task: updatedTask,
      winningBid,
      winningAgent,
      payoutTxHash,
      hcsSequence,
    });
  } catch (error) {
    console.error("Failed to release payout:", error);
    return NextResponse.json(
      { error: "Failed to release payout" },
      { status: 500 }
    );
  }
}
