import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { db, pendingApprovals } from "@/lib/db";
import { eq, and } from "drizzle-orm";

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

    await db
      .update(pendingApprovals)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
      })
      .where(eq(pendingApprovals.id, id));

    return NextResponse.json({
      success: true,
      message: "Approval rejected successfully",
    });
  } catch (error: any) {
    console.error("Error rejecting approval:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 }
    );
  }
}
