import { NextRequest, NextResponse } from "next/server";
import { db, tasks, bids, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { rankBidsForTask } from "@/lib/scoring";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  try {
    const allTasks = await db.select().from(tasks).orderBy(desc(tasks.createdAt));

    // Enrich tasks with ranked bids
    const enrichedTasks = await Promise.all(
      allTasks.map(async (task) => {
        const taskBids = await db
          .select()
          .from(bids)
          .where(eq(bids.taskId, task.id));

        const allAgents = await db.select().from(agents);
        const rankedBids = rankBidsForTask(task, taskBids, allAgents);

        return {
          ...task,
          bids: taskBids,
          rankedBids,
        };
      })
    );

    return NextResponse.json({ tasks: enrichedTasks });
  } catch (error) {
    console.error("Failed to fetch tasks:", error);
    return NextResponse.json(
      { error: "Failed to fetch tasks" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const {
      title,
      description,
      rewardHbar,
      deadlineAt,
      posterId,
      posterWallet,
      requiredCapabilities,
    } = body;

    if (!title || !description || !rewardHbar || !posterId || !posterWallet) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: title, description, rewardHbar, posterId, posterWallet",
        },
        { status: 400 }
      );
    }

    const taskId = generateId("task");

    const newTask = {
      id: taskId,
      title,
      description,
      rewardHbar: String(rewardHbar),
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null,
      posterId,
      posterWallet,
      requiredCapabilities: requiredCapabilities || [],
      status: "open",
    };

    await db.insert(tasks).values(newTask);

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "TASK_CREATED",
          taskId,
          title,
          rewardHbar,
          requiredCapabilities: requiredCapabilities || [],
          posterId,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;

        // Update task with HCS sequence
        await db
          .update(tasks)
          .set({ hcsSequence })
          .where(eq(tasks.id, taskId));
      } catch (hcsError) {
        console.warn("HCS publish failed (continuing without):", hcsError);
      }
    }

    const [created] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    return NextResponse.json(
      {
        task: created,
        hcsSequence,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create task:", error);
    return NextResponse.json(
      { error: "Failed to create task" },
      { status: 500 }
    );
  }
}
