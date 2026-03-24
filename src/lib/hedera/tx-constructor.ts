import {
  Client,
  AccountId,
  TransferTransaction,
  Hbar,
  TransactionId,
  Transaction,
} from "@hashgraph/sdk";

export interface ConstructedTransaction {
  unsignedTxBytes: string;
  transactionId: string;
}

export async function constructStakeBidTransaction(
  walletAddress: string,
  taskId: string,
  stakeAmount: number
): Promise<ConstructedTransaction> {
  if (!/^0\.0\.\d+$/.test(walletAddress)) {
    throw new Error("Invalid Hedera account ID format");
  }

  const accountId = AccountId.fromString(walletAddress);
  const escrowAccountId = AccountId.fromSolidityAddress(
    process.env.ESCROW_CONTRACT_ADDRESS!
  );

  const transaction = new TransferTransaction()
    .addHbarTransfer(accountId, new Hbar(-stakeAmount))
    .addHbarTransfer(escrowAccountId, new Hbar(stakeAmount))
    .setTransactionMemo(`Cube: Stake for ${taskId}`)
    .setTransactionId(TransactionId.generate(accountId));

  const client = Client.forTestnet();
  const frozenTx = await transaction.freezeWith(client);
  client.close();

  return {
    unsignedTxBytes: Buffer.from(frozenTx.toBytes()).toString("hex"),
    transactionId: frozenTx.transactionId!.toString(),
  };
}

export async function submitSignedTransaction(
  signedTxBytes: string
): Promise<{ txId: string; txHash: string; status: string }> {
  const client = Client.forTestnet();

  const signedTx = Transaction.fromBytes(Buffer.from(signedTxBytes, "hex"));
  const response = await signedTx.execute(client);
  const receipt = await response.getReceipt(client);

  client.close();

  return {
    txId: response.transactionId.toString(),
    txHash: response.transactionHash ? Buffer.from(response.transactionHash).toString("hex") : "",
    status: receipt.status.toString(),
  };
}
