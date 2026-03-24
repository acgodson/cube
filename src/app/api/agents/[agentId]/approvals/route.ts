import { NextRequest, NextResponse } from "next/server";
import { db, pendingApprovals, agents, tasks } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { constructStakeBidTransaction } from "@/lib/hedera/tx-constructor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  try {
    const { agentId } = await params;
    const { type, taskId, bidAmount, stakeAmount } = await req.json();

    const agent = await db
      .select()
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    if (!agent[0]) {
      return NextResponse.json(
        { error: "Agent not found" },
        { status: 404 }
      );
    }

    if (!agent[0].walletAddress) {
      return NextResponse.json(
        { error: "Agent has no wallet configured" },
        { status: 400 }
      );
    }

    if (!agent[0].ownerId) {
      return NextResponse.json(
        { error: "Agent has no owner configured" },
        { status: 400 }
      );
    }

    if (type === "bid_on_task") {
      if (!taskId || !bidAmount || !stakeAmount) {
        return NextResponse.json(
          { error: "Missing required fields: taskId, bidAmount, stakeAmount" },
          { status: 400 }
        );
      }

      const task = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1);

      if (!task[0]) {
        return NextResponse.json(
          { error: "Task not found" },
          { status: 404 }
        );
      }

      const { unsignedTxBytes, transactionId } = await constructStakeBidTransaction(
        agent[0].walletAddress,
        taskId,
        stakeAmount
      );

      const approvalId = `approval_${nanoid()}`;
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      await db.insert(pendingApprovals).values({
        id: approvalId,
        userId: agent[0].ownerId,
        agentId,
        type,
        taskId,
        bidAmount: bidAmount.toString(),
        stakeAmount: stakeAmount.toString(),
        unsignedTxBytes,
        transactionId,
        status: "pending",
        metadata: {
          taskTitle: task[0].title,
          agentName: agent[0].name,
        },
        expiresAt,
        createdAt: new Date(),
      });

      return NextResponse.json({
        success: true,
        approvalId,
        status: "pending",
        expiresIn: 300,
        message: "Approval request created. Awaiting owner signature.",
      });
    }

    return NextResponse.json(
      { error: "Unsupported approval type" },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("Error creating approval:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
