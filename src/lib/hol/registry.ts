import {
  Client,
  TopicMessageSubmitTransaction,
  TopicId,
} from "@hashgraph/sdk";

export interface HOLAgent {
  did: string;
  name: string;
  description: string;
  walletAddress: string;
  skills: string[];
  metadata: {
    platform: string;
    version: string;
    registeredAt: string;
  };
}

export function generateAgentDID(agentId: string): string {
  return `did:hol:agent:${agentId}`;
}

export async function registerAgentToHOL(
  agent: HOLAgent,
  topicId: string
): Promise<{ transactionId: string; consensusTimestamp: string }> {
  const client = Client.forTestnet().setOperator(
    process.env.HEDERA_ACCOUNT_ID!,
    process.env.HEDERA_PRIVATE_KEY!
  );

  const payload = {
    type: "agent_registration",
    version: "1.0",
    timestamp: new Date().toISOString(),
    agent,
  };

  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(payload));

  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);

  client.close();

  return {
    transactionId: response.transactionId.toString(),
    consensusTimestamp: receipt.topicRunningHash
      ? receipt.topicRunningHash.toString()
      : "",
  };
}
