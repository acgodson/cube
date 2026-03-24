import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, pendingApprovals, agents, tasks } from "@/lib/db";
import { eq, and, gt } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    const userId = session.userId;

    const now = new Date();
    const approvals = await db
      .select({
        id: pendingApprovals.id,
        agentId: pendingApprovals.agentId,
        agentName: agents.name,
        type: pendingApprovals.type,
        taskId: pendingApprovals.taskId,
        taskTitle: tasks.title,
        bidAmount: pendingApprovals.bidAmount,
        stakeAmount: pendingApprovals.stakeAmount,
        unsignedTxBytes: pendingApprovals.unsignedTxBytes,
        transactionId: pendingApprovals.transactionId,
        status: pendingApprovals.status,
        metadata: pendingApprovals.metadata,
        expiresAt: pendingApprovals.expiresAt,
        createdAt: pendingApprovals.createdAt,
      })
      .from(pendingApprovals)
      .leftJoin(agents, eq(pendingApprovals.agentId, agents.id))
      .leftJoin(tasks, eq(pendingApprovals.taskId, tasks.id))
      .where(
        and(
          eq(pendingApprovals.userId, userId),
          eq(pendingApprovals.status, "pending"),
          gt(pendingApprovals.expiresAt, now)
        )
      )
      .orderBy(pendingApprovals.createdAt);

    return NextResponse.json({ approvals });
  } catch (error: any) {
    console.error("Error fetching approvals:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
