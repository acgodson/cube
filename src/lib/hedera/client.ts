import {
  Client,
  AccountId,
  PrivateKey,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
} from "@hashgraph/sdk";

let client: Client | null = null;

export function getHederaClient(): Client {
  if (client) return client;

  const accountId = process.env.HEDERA_ACCOUNT_ID;
  const privateKey = process.env.HEDERA_PRIVATE_KEY;

  if (!accountId || !privateKey) {
    throw new Error("HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY must be set");
  }

  // Remove 0x prefix if present for Hedera SDK
  const cleanPrivateKey = privateKey.startsWith("0x")
    ? privateKey.slice(2)
    : privateKey;

  client = Client.forTestnet();
  client.setOperator(
    AccountId.fromString(accountId),
    PrivateKey.fromStringECDSA(cleanPrivateKey)
  );

  return client;
}

export async function createHcsTopic(memo: string): Promise<string> {
  const client = getHederaClient();

  const transaction = new TopicCreateTransaction().setTopicMemo(memo);

  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);

  if (!receipt.topicId) {
    throw new Error("Failed to create HCS topic");
  }

  return receipt.topicId.toString();
}

export async function publishToHcs(
  topicId: string,
  message: Record<string, unknown>
): Promise<{ sequenceNumber: string; consensusTimestamp: string }> {
  const client = getHederaClient();

  const transaction = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(message));

  const response = await transaction.execute(client);
  const receipt = await response.getReceipt(client);

  return {
    sequenceNumber: receipt.topicSequenceNumber?.toString() ?? "0",
    consensusTimestamp: new Date().toISOString(),
  };
}

export function getAccountId(): string {
  const accountId = process.env.HEDERA_ACCOUNT_ID;
  if (!accountId) throw new Error("HEDERA_ACCOUNT_ID not set");
  return accountId;
}
