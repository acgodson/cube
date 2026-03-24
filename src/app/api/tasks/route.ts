import { NextRequest, NextResponse } from "next/server";
import { db, tasks, bids, agents } from "@/lib/db";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { rankBidsForTask } from "@/lib/scoring";
import { storeTaskOntology } from "@/lib/skillgraph";
import { generateTaskEmbedding } from "@/lib/embedding";
import { notifyMatchingAgents, DEFAULT_GATEWAY_CONFIG } from "@/lib/gateway";
import { getSession } from "@/lib/auth";
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
        const rankedBids = await rankBidsForTask(task, taskBids, allAgents);

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
    const session = await getSession();
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

    const resolvedPosterId = session?.userId || posterId;
    const resolvedPosterWallet = session?.hederaAccountId || posterWallet;

    if (!title || !description || !rewardHbar || !resolvedPosterId || !resolvedPosterWallet) {
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
      posterId: resolvedPosterId,
      posterWallet: resolvedPosterWallet,
      requiredCapabilities: requiredCapabilities || [],
      status: "open",
    };

    await db.insert(tasks).values(newTask);

    // Extract and store task ontology (for skill graph matching)
    let ontology = null;
    try {
      ontology = await storeTaskOntology(taskId, title, description);
    } catch (ontologyError) {
      console.warn("Ontology extraction failed (continuing without):", ontologyError);
    }

    // Generate semantic embedding using Gemini Embedding 2
    let embedding: number[] | null = null;
    let embeddingHash: string | null = null;
    try {
      const embeddingResult = await generateTaskEmbedding(title, description);
      embedding = embeddingResult.embedding;
      embeddingHash = embeddingResult.hash;

      // Update task with embedding
      await db
        .update(tasks)
        .set({
          embedding: embedding as unknown as number[],
          embeddingHash,
        })
        .where(eq(tasks.id, taskId));
    } catch (embeddingError) {
      console.warn("Embedding generation failed (continuing without):", embeddingError);
    }

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
          ontology: ontology ? {
            domain: ontology.domain,
            taskType: ontology.taskType,
            artifactType: ontology.artifactType,
            complexity: ontology.complexity,
          } : null,
          embeddingHash,
          posterId: resolvedPosterId,
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

    // Notify matching agents about the new task
    // This sends webhooks to OpenClaw agents and SSE updates to gateway-connected agents
    let agentNotifications = { notified: 0, failed: 0 };
    try {
      agentNotifications = await notifyMatchingAgents(taskId, DEFAULT_GATEWAY_CONFIG);
      console.log(`[Task] Notified ${agentNotifications.notified} agents about task ${taskId}`);
    } catch (notifyError) {
      console.warn("Agent notification failed (continuing):", notifyError);
    }

    return NextResponse.json(
      {
        task: created,
        ontology,
        embeddingHash,
        hcsSequence,
        agentNotifications,
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
