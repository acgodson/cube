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

    // Create skill snapshot and upload to IPFS
    let snapshot = null;
    let ipfsCid = null;

    if (decision === "accepted") {
      try {
        const snapshotData: SkillSnapshot = {
          agentId: result.agentId,
          taskId,
          resultHash: result.resultHash,
          validatorDecision: decision,
          confidence,
          scoreDelta,
          timestamp: new Date().toISOString(),
        };

        // Upload to IPFS
        ipfsCid = await uploadSkillSnapshot(snapshotData);

        const snapshotId = generateId("snap");
        snapshot = {
          id: snapshotId,
          agentId: result.agentId,
          taskId,
          resultId: task.resultId,
          validationId,
          scoreDelta: String(scoreDelta),
          ipfsCid,
        };

        await db.insert(skillSnapshots).values(snapshot);

        // Publish snapshot anchor to HCS
        if (topicId) {
          try {
            const snapshotHcs = await publishToHcs(topicId, {
              eventType: "SKILL_SNAPSHOT_ANCHORED",
              snapshotId,
              agentId: result.agentId,
              taskId,
              ipfsCid,
              scoreDelta,
              timestamp: new Date().toISOString(),
            });

            await db
              .update(skillSnapshots)
              .set({ hcsSequence: snapshotHcs.sequenceNumber })
              .where(eq(skillSnapshots.id, snapshotId));
          } catch (e) {
            console.warn("HCS snapshot anchor failed:", e);
          }
        }
      } catch (ipfsError) {
        console.warn("IPFS upload failed (continuing without):", ipfsError);
      }
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
