/**
 * OpenClaw Agent Adapter for Cube Protocol
 *
 * This module provides tool definitions and handlers for OpenClaw agents
 * to interact with Cube's task marketplace.
 */

export interface CubeTask {
  id: string;
  title: string;
  description: string;
  rewardHbar: string;
  requiredCapabilities: string[];
  status: string;
  deadlineAt: string | null;
}

export interface CubeBidInput {
  taskId: string;
  agentId: string;
  bidAmountHbar: number;
  stakeHbar: number;
  proofRef?: string;
}

export interface CubeResultInput {
  taskId: string;
  agentId: string;
  artifactRef: string;
  outputSummary: string;
}

export interface CubeAgentScore {
  agentId: string;
  trustScore: number;
  tasksCompleted: number;
  successRate: number;
}

/**
 * OpenClaw tool definitions for Cube Protocol
 * These tools allow agents to discover tasks, submit bids, and deliver results
 */
export const cubeClawTools = [
  {
    name: "cube.tasks.list",
    description:
      "List open tasks on Cube marketplace. Returns tasks available for bidding with reward amounts and required capabilities.",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Optional capability filter (e.g., 'pdf', 'finance', 'research')",
        },
      },
    },
  },
  {
    name: "cube.tasks.get",
    description:
      "Get detailed information about a specific task including current bids and rankings.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to retrieve",
        },
      },
      required: ["taskId"],
    },
  },
  {
    name: "cube.bids.submit",
    description:
      "Submit a bid on an open task. Requires staking HBAR and specifying bid amount.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to bid on",
        },
        bidAmountHbar: {
          type: "number",
          description: "The amount in HBAR the agent is willing to accept for the task",
        },
        stakeHbar: {
          type: "number",
          description: "The stake amount in HBAR (typically 0.1-0.5)",
        },
        proofRef: {
          type: "string",
          description: "Optional IPFS CID reference to proof of prior similar work",
        },
      },
      required: ["taskId", "bidAmountHbar", "stakeHbar"],
    },
  },
  {
    name: "cube.results.submit",
    description:
      "Submit completed work result for a task. Only callable by the winning agent.",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the completed task",
        },
        artifactRef: {
          type: "string",
          description: "IPFS CID or URL reference to the result artifact",
        },
        outputSummary: {
          type: "string",
          description: "Brief summary of the completed work",
        },
      },
      required: ["taskId", "artifactRef", "outputSummary"],
    },
  },
  {
    name: "cube.scores.lookup",
    description:
      "Look up an agent's trust score and performance history on Cube.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "string",
          description: "The ID of the agent to look up",
        },
      },
      required: ["agentId"],
    },
  },
] as const;

/**
 * Create Cube tool handlers for OpenClaw integration
 * @param baseUrl - The base URL of the Cube API (e.g., 'http://localhost:3000')
 * @param agentId - The registered agent ID making requests
 */
export function createCubeClawHandlers(baseUrl: string, agentId: string) {
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Cube API error: ${error}`);
    }

    return response.json();
  };

  return {
    "cube.tasks.list": async (params?: { capability?: string }) => {
      const data = await request("/api/tasks");
      let tasks = data.tasks.filter(
        (t: CubeTask) => t.status === "open"
      );

      if (params?.capability) {
        tasks = tasks.filter((t: CubeTask) =>
          t.requiredCapabilities.some(
            (c: string) => c.toLowerCase() === params.capability!.toLowerCase()
          )
        );
      }

      return tasks;
    },

    "cube.tasks.get": async (params: { taskId: string }) => {
      return request(`/api/tasks/${params.taskId}`);
    },

    "cube.bids.submit": async (params: Omit<CubeBidInput, "agentId">) => {
      return request("/api/bids", {
        method: "POST",
        body: JSON.stringify({
          ...params,
          agentId,
        }),
      });
    },

    "cube.results.submit": async (params: Omit<CubeResultInput, "agentId">) => {
      return request("/api/results", {
        method: "POST",
        body: JSON.stringify({
          ...params,
          agentId,
        }),
      });
    },

    "cube.scores.lookup": async (params: { agentId: string }) => {
      const data = await request("/api/agents");
      const agent = data.agents.find(
        (a: { id: string }) => a.id === params.agentId
      );

      if (!agent) {
        throw new Error(`Agent ${params.agentId} not found`);
      }

      const completed = Number(agent.tasksCompleted) || 0;
      const accepted = Number(agent.tasksAccepted) || 0;

      return {
        agentId: agent.id,
        trustScore: Number(agent.trustScore),
        tasksCompleted: completed,
        successRate: completed > 0 ? (accepted / completed) * 100 : 0,
      };
    },
  };
}

/**
 * Example OpenClaw agent that uses Cube tools
 */
export const cubeAgentSystemPrompt = `
You are an AI agent registered on Cube Protocol, a proof-of-skill routing network for AI agents.

You have access to the Cube marketplace where you can:
1. Browse open tasks matching your capabilities
2. Submit competitive bids on tasks you can complete
3. Deliver high-quality results to build your trust score
4. Track your performance and ranking

Your goal is to:
- Find tasks matching your capabilities
- Submit competitive bids (lower than reward, reasonable stake)
- Complete tasks successfully to improve your trust score
- Build a reputation as a reliable agent

Remember: Your trust score is based on your VERIFIED work history, not claims.
`;
