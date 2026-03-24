import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, pendingApprovals, bids, tasks } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { submitSignedTransaction } from "@/lib/hedera/tx-constructor";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.userId;

    const { signedTxBytes } = await req.json();

    if (!signedTxBytes) {
      return NextResponse.json(
        { error: "Missing signedTxBytes" },
        { status: 400 }
      );
    }

    const approval = await db
      .select()
      .from(pendingApprovals)
      .where(
        and(
          eq(pendingApprovals.id, id),
          eq(pendingApprovals.userId, userId)
        )
      )
      .limit(1);

    if (!approval[0]) {
      return NextResponse.json(
        { error: "Approval not found" },
        { status: 404 }
      );
    }

    if (approval[0].status !== "pending") {
      return NextResponse.json(
        { error: `Approval already ${approval[0].status}` },
        { status: 400 }
      );
    }

    if (new Date() > approval[0].expiresAt) {
      await db
        .update(pendingApprovals)
        .set({ status: "expired" })
        .where(eq(pendingApprovals.id, id));

      return NextResponse.json(
        { error: "Approval expired" },
        { status: 400 }
      );
    }

    const { txId, txHash, status } = await submitSignedTransaction(signedTxBytes);

    await db
      .update(pendingApprovals)
      .set({
        status: "approved",
        approvedAt: new Date(),
        metadata: {
          ...(approval[0].metadata as object),
          txId,
          txHash,
          txStatus: status,
        },
      })
      .where(eq(pendingApprovals.id, id));

    let createdBidId: string | null = null;

    if (
      approval[0].type === "bid_on_task" &&
      approval[0].taskId &&
      approval[0].bidAmount &&
      approval[0].stakeAmount
    ) {
      const [task] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, approval[0].taskId));

      if (!task) {
        throw new Error("Task not found for approved bid");
      }

      if (task.status !== "open") {
        throw new Error("Task is no longer accepting bids");
      }

      const existingBid = await db
        .select()
        .from(bids)
        .where(
          and(
            eq(bids.taskId, approval[0].taskId),
            eq(bids.agentId, approval[0].agentId)
          )
        )
        .limit(1);

      if (existingBid.length === 0) {
        createdBidId = generateId("bid");

        await db.insert(bids).values({
          id: createdBidId,
          taskId: approval[0].taskId,
          agentId: approval[0].agentId,
          bidAmountHbar: String(approval[0].bidAmount),
          stakeHbar: String(approval[0].stakeAmount),
          stakeTxHash: txHash,
          status: "pending",
        });

        const topicId = process.env.HCS_TOPIC_ID;

        if (topicId) {
          await publishToHcs(topicId, {
            eventType: "BID_SUBMITTED",
            bidId: createdBidId,
            taskId: approval[0].taskId,
            agentId: approval[0].agentId,
            bidAmountHbar: String(approval[0].bidAmount),
            stakeHbar: String(approval[0].stakeAmount),
            stakeTxHash: txHash,
            source: "owner_approval",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      txId,
      txHash,
      status,
      bidId: createdBidId,
      message: "Transaction submitted successfully",
    });
  } catch (error: unknown) {
    console.error("Error approving transaction:", error);
    const message = error instanceof Error ? error.message : "Failed to submit transaction";

    const { id } = await params;
    await db
      .update(pendingApprovals)
      .set({
        status: "failed",
        metadata: {
          error: message,
        },
      })
      .where(eq(pendingApprovals.id, id));

    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
