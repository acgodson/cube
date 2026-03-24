/**
 * Quick fix endpoint for agent endpoint URL
 * DELETE after testing
 */

import { NextRequest, NextResponse } from "next/server";
import { db, agents } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;
  const body = await request.json();
  const { endpointUrl } = body;

  if (!endpointUrl) {
    return NextResponse.json({ error: "endpointUrl required" }, { status: 400 });
  }

  await db
    .update(agents)
    .set({ endpointUrl })
    .where(eq(agents.id, agentId));

  return NextResponse.json({ status: "updated", agentId, endpointUrl });
}
