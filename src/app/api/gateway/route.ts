/**
 * Cube Agent Gateway API
 *
 * Server-Sent Events (SSE) endpoint for agent connections.
 *
 * Agents connect via:
 *   GET /api/gateway?agentId=xxx&apiKey=xxx
 *
 * And receive a stream of events (task offers, selections, validations).
 *
 * Agents send messages via:
 *   POST /api/gateway
 *   { sessionId: "...", message: { type: "BID", ... } }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  processAgentMessage,
  createSession,
  getSession,
  closeSession,
  findTaskMatches,
  expireStaleOffers,
  DEFAULT_GATEWAY_CONFIG,
  type AgentMessage,
  type GatewayMessage,
} from "@/lib/gateway";
import { db, agents } from "@/lib/db";
import { eq } from "drizzle-orm";

// Store active SSE connections
const connections = new Map<string, ReadableStreamController<Uint8Array>>();

/**
 * GET /api/gateway - SSE connection endpoint
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");

  if (!agentId) {
    return NextResponse.json(
      { error: "agentId is required" },
      { status: 400 }
    );
  }

  // Verify agent exists
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404 }
    );
  }

  // Create SSE stream
  const encoder = new TextEncoder();
  let controller: ReadableStreamController<Uint8Array>;
  let sessionId: string;

  const stream = new ReadableStream({
    async start(ctrl) {
      controller = ctrl;

      try {
        // Create session
        const session = await createSession(agentId);
        sessionId = session.sessionId;

        // Store connection
        connections.set(sessionId, controller);

        // Send connected message
        const connectedMsg: GatewayMessage = {
          type: "CONNECTED",
          sessionId: session.sessionId,
          agentId: session.agentId,
          agentName: session.agentName,
          workState: session.workState,
        };
        sendSSE(controller, encoder, connectedMsg);

        // Start task matching loop for this connection
        startTaskMatching(sessionId, controller, encoder);
      } catch (error) {
        const errorMsg: GatewayMessage = {
          type: "ERROR",
          code: "CONNECTION_FAILED",
          message: String(error),
        };
        sendSSE(controller, encoder, errorMsg);
        controller.close();
      }
    },

    cancel() {
      // Connection closed by client
      if (sessionId) {
        connections.delete(sessionId);
        closeSession(sessionId, "client_disconnect").catch(console.error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

/**
 * POST /api/gateway - Message handling endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, message } = body as {
      sessionId: string;
      message: AgentMessage;
    };

    if (!sessionId || !message) {
      return NextResponse.json(
        { error: "sessionId and message are required" },
        { status: 400 }
      );
    }

    // Verify session exists
    const session = getSession(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "Session not found or expired" },
        { status: 404 }
      );
    }

    // Process message
    const response = await processAgentMessage(sessionId, message);

    // If there's an active SSE connection, send response there too
    const controller = connections.get(sessionId);
    if (controller) {
      const encoder = new TextEncoder();
      if (Array.isArray(response)) {
        for (const msg of response) {
          sendSSE(controller, encoder, msg);
        }
      } else {
        sendSSE(controller, encoder, response);
      }
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Gateway POST error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: String(error) },
      { status: 500 }
    );
  }
}

/**
 * Send SSE message
 */
function sendSSE(
  controller: ReadableStreamController<Uint8Array>,
  encoder: TextEncoder,
  message: GatewayMessage
) {
  try {
    const data = `data: ${JSON.stringify(message)}\n\n`;
    controller.enqueue(encoder.encode(data));
  } catch (error) {
    // Connection might be closed
    console.error("SSE send error:", error);
  }
}

/**
 * Start task matching loop for a session
 */
async function startTaskMatching(
  sessionId: string,
  controller: ReadableStreamController<Uint8Array>,
  encoder: TextEncoder
) {
  const config = DEFAULT_GATEWAY_CONFIG;

  const matchLoop = async () => {
    try {
      // Check if session still exists
      const session = getSession(sessionId);
      if (!session || session.connectionState === "disconnected") {
        return; // Stop loop
      }

      // Only match if idle
      if (session.workState === "idle") {
        const matches = await findTaskMatches(config);

        // Find match for this session
        const myMatch = matches.find((m) => m.session.sessionId === sessionId);
        if (myMatch) {
          sendSSE(controller, encoder, myMatch.offer);
        }
      }

      // Expire stale offers
      await expireStaleOffers();

      // Schedule next iteration
      setTimeout(matchLoop, 5000); // Check every 5 seconds
    } catch (error) {
      console.error("Task matching error:", error);
      setTimeout(matchLoop, 10000); // Retry after 10s on error
    }
  };

  // Start loop after a short delay
  setTimeout(matchLoop, 2000);
}

/**
 * Send message to a specific session
 */
export function sendToSession(sessionId: string, message: GatewayMessage): boolean {
  const controller = connections.get(sessionId);
  if (!controller) return false;

  const encoder = new TextEncoder();
  sendSSE(controller, encoder, message);
  return true;
}

/**
 * Broadcast message to all connected agents
 */
export function broadcast(message: GatewayMessage): number {
  const encoder = new TextEncoder();
  let sent = 0;

  for (const controller of connections.values()) {
    try {
      sendSSE(controller, encoder, message);
      sent++;
    } catch {
      // Skip failed connections
    }
  }

  return sent;
}
