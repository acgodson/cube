import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, pendingApprovals } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { submitSignedTransaction } from "@/lib/hedera/tx-constructor";

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

    return NextResponse.json({
      success: true,
      txId,
      txHash,
      status,
      message: "Transaction submitted successfully",
    });
  } catch (error: any) {
    console.error("Error approving transaction:", error);

    const { id } = await params;
    await db
      .update(pendingApprovals)
      .set({
        status: "failed",
        metadata: {
          error: error.message,
        },
      })
      .where(eq(pendingApprovals.id, id));

    return NextResponse.json(
      { error: error.message || "Failed to submit transaction" },
      { status: 500 }
    );
  }
}
