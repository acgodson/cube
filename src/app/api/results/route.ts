import { NextRequest, NextResponse } from "next/server";
import { db, taskResults, tasks, bids, agents } from "@/lib/db";
import { generateId, hashContent } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");

    if (taskId) {
      const results = await db
        .select()
        .from(taskResults)
        .where(eq(taskResults.taskId, taskId));
      return NextResponse.json({ results });
    }

    const allResults = await db.select().from(taskResults);
    return NextResponse.json({ results: allResults });
  } catch (error) {
    console.error("Failed to fetch results:", error);
    return NextResponse.json(
      { error: "Failed to fetch results" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { taskId, agentId, artifactRef, outputSummary } = body;

    if (!taskId || !agentId || !artifactRef || !outputSummary) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: taskId, agentId, artifactRef, outputSummary",
        },
        { status: 400 }
      );
    }

    // Verify task exists and is assigned to this agent
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "assigned") {
      return NextResponse.json(
        { error: "Task is not in assigned state" },
        { status: 409 }
      );
    }

    // Verify agent is the winner
    if (!task.winningBidId) {
      return NextResponse.json(
        { error: "Task has no winning bid" },
        { status: 409 }
      );
    }

    const [winningBid] = await db
      .select()
      .from(bids)
      .where(eq(bids.id, task.winningBidId));

    if (!winningBid || winningBid.agentId !== agentId) {
      return NextResponse.json(
        { error: "Agent is not the task winner" },
        { status: 403 }
      );
    }

    const resultId = generateId("result");
    const resultHash = hashContent(JSON.stringify({ artifactRef, outputSummary }));

    const newResult = {
      id: resultId,
      taskId,
      agentId,
      artifactRef,
      outputSummary,
      resultHash,
    };

    await db.insert(taskResults).values(newResult);

    // Update task status
    await db
      .update(tasks)
      .set({
        status: "submitted",
        resultId,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "RESULT_SUBMITTED",
          resultId,
          taskId,
          agentId,
          resultHash,
          artifactRef,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;

        await db
          .update(taskResults)
          .set({ hcsSequence })
          .where(eq(taskResults.id, resultId));
      } catch (hcsError) {
        console.warn("HCS publish failed:", hcsError);
      }
    }

    const [created] = await db
      .select()
      .from(taskResults)
      .where(eq(taskResults.id, resultId));

    const [updatedTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    return NextResponse.json(
      {
        result: created,
        task: updatedTask,
        hcsSequence,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to submit result:", error);
    return NextResponse.json(
      { error: "Failed to submit result" },
      { status: 500 }
    );
  }
}
