import { NextRequest, NextResponse } from "next/server";
import {
  db,
  validations,
  tasks,
  taskResults,
  agents,
  skillSnapshots,
} from "@/lib/db";
import { generateId } from "@/lib/utils";
import { publishToHcs } from "@/lib/hedera";
import { uploadSkillSnapshot } from "@/lib/ipfs/client";
import { calculateScoreDelta } from "@/lib/scoring";
import { createMemoryCommit, getTaskOntology } from "@/lib/skillgraph";
import { extractOntology } from "@/lib/ontology";
import type { SkillSnapshot } from "@/lib/types";
import { eq, sql } from "drizzle-orm";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { taskId, validatorId, decision, confidence, notes } = body;

    if (!taskId || !validatorId || !decision || confidence === undefined) {
      return NextResponse.json(
        {
          error:
            "Missing required fields: taskId, validatorId, decision, confidence",
        },
        { status: 400 }
      );
    }

    if (!["accepted", "rejected"].includes(decision)) {
      return NextResponse.json(
        { error: "Decision must be 'accepted' or 'rejected'" },
        { status: 400 }
      );
    }

    // Verify task exists and has a submitted result
    const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));

    if (!task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    if (task.status !== "submitted") {
      return NextResponse.json(
        { error: "Task is not in submitted state" },
        { status: 409 }
      );
    }

    if (!task.resultId) {
      return NextResponse.json(
        { error: "Task has no result to validate" },
        { status: 409 }
      );
    }

    // Get result
    const [result] = await db
      .select()
      .from(taskResults)
      .where(eq(taskResults.id, task.resultId));

    if (!result) {
      return NextResponse.json({ error: "Result not found" }, { status: 404 });
    }

    const validationId = generateId("val");

    const newValidation = {
      id: validationId,
      taskId,
      resultId: task.resultId,
      validatorId,
      decision,
      confidence: String(confidence),
      notes: notes || null,
    };

    await db.insert(validations).values(newValidation);

    // Update task status
    await db
      .update(tasks)
      .set({
        status: "validated",
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));

    // Calculate score delta and update agent stats
    const scoreDelta = calculateScoreDelta(decision, confidence);
    const [agent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, result.agentId));

    if (agent) {
      const updateData: Record<string, unknown> = {
        trustScore: sql`${agents.trustScore} + ${scoreDelta}`,
        tasksCompleted: sql`${agents.tasksCompleted} + 1`,
        updatedAt: new Date(),
      };

      if (decision === "accepted") {
        updateData.tasksAccepted = sql`${agents.tasksAccepted} + 1`;
      } else {
        updateData.tasksRejected = sql`${agents.tasksRejected} + 1`;
      }

      await db.update(agents).set(updateData).where(eq(agents.id, agent.id));
    }

    // Publish to HCS
    let hcsSequence: string | null = null;
    const topicId = process.env.HCS_TOPIC_ID;

    if (topicId) {
      try {
        const hcsResult = await publishToHcs(topicId, {
          eventType: "RESULT_VALIDATED",
          validationId,
          taskId,
          resultId: task.resultId,
          agentId: result.agentId,
          decision,
          confidence,
          scoreDelta,
          timestamp: new Date().toISOString(),
        });
        hcsSequence = hcsResult.sequenceNumber;

        await db
          .update(validations)
          .set({ hcsSequence })
          .where(eq(validations.id, validationId));
      } catch (hcsError) {
        console.warn("HCS publish failed:", hcsError);
      }
    }

    // Create memory commit (skill graph update) - THE CORE INNOVATION
    let memoryCommitResult = null;
    let snapshot = null;
    let ipfsCid = null;

    try {
      // Get task ontology (or extract it)
      let ontology = await getTaskOntology(taskId);
      if (!ontology) {
        ontology = extractOntology(task.title, task.description);
      }

      // Create memory commit - this updates skill graph, publishes to HCS, and stores on IPFS
      memoryCommitResult = await createMemoryCommit({
        agentId: result.agentId,
        taskId,
        ontology,
        outcome: decision === "accepted" ? "success" : "failure",
        confidence,
        validatorId,
      });

      ipfsCid = memoryCommitResult.ipfsCid;

      // Also create legacy skill snapshot for backwards compatibility
      if (decision === "accepted") {
        const snapshotData: SkillSnapshot = {
          agentId: result.agentId,
          taskId,
          resultHash: result.resultHash,
          validatorDecision: decision,
          confidence,
          scoreDelta,
          timestamp: new Date().toISOString(),
        };

        const snapshotId = generateId("snap");
        snapshot = {
          id: snapshotId,
          agentId: result.agentId,
          taskId,
          resultId: task.resultId,
          validationId,
          scoreDelta: String(scoreDelta),
          ipfsCid: ipfsCid || "",
        };

        await db.insert(skillSnapshots).values(snapshot);
      }
    } catch (commitError) {
      console.warn("Memory commit failed (continuing without):", commitError);
    }

    const [created] = await db
      .select()
      .from(validations)
      .where(eq(validations.id, validationId));

    const [updatedTask] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId));

    const [updatedAgent] = await db
      .select()
      .from(agents)
      .where(eq(agents.id, result.agentId));

    return NextResponse.json(
      {
        validation: created,
        task: updatedTask,
        agent: updatedAgent,
        snapshot,
        ipfsCid,
        hcsSequence,
        memoryCommit: memoryCommitResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to create validation:", error);
    return NextResponse.json(
      { error: "Failed to create validation" },
      { status: 500 }
    );
  }
}
