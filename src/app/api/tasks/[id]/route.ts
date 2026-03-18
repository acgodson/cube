import { NextRequest, NextResponse } from "next/server";
import { db, tasks, bids, agents, taskResults, validations, skillSnapshots } from "@/lib/db";
import { rankBidsForTask } from "@/lib/scoring";
import { eq } from "drizzle-orm";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [task] = await db.select().from(tasks).where(eq(tasks.id, id));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    // Get all related data
    const taskBids = await db.select().from(bids).where(eq(bids.taskId, id));
    const allAgents = await db.select().from(agents);
    const rankedBids = await rankBidsForTask(task, taskBids, allAgents);

    const results = await db
      .select()
      .from(taskResults)
      .where(eq(taskResults.taskId, id));

    const taskValidations = await db
      .select()
      .from(validations)
      .where(eq(validations.taskId, id));

    const snapshots = await db
      .select()
      .from(skillSnapshots)
      .where(eq(skillSnapshots.taskId, id));

    // Get winning agent info if exists
    let winningAgent = null;
    if (task.winningBidId) {
      const [winningBid] = await db
        .select()
        .from(bids)
        .where(eq(bids.id, task.winningBidId));

      if (winningBid) {
        const [agent] = await db
          .select()
          .from(agents)
          .where(eq(agents.id, winningBid.agentId));
        winningAgent = agent;
      }
    }

    return NextResponse.json({
      task,
      bids: taskBids,
      rankedBids,
      results,
      validations: taskValidations,
      snapshots,
      winningAgent,
    });
  } catch (error) {
    console.error("Failed to fetch task:", error);
    return NextResponse.json(
      { error: "Failed to fetch task" },
      { status: 500 }
    );
  }
}
