import { ethers } from "ethers";

// CubeEscrow ABI (minimal interface for interaction)
const ESCROW_ABI = [
  "function createTask() external payable returns (uint256 taskId)",
  "function stakeBid(uint256 taskId) external payable",
  "function selectWinner(uint256 taskId, address winner) external",
  "function submitTask(uint256 taskId) external",
  "function releasePayout(uint256 taskId) external",
  "function refundBidStake(uint256 taskId, address agent) external",
  "function tasks(uint256) external view returns (address poster, address winner, uint256 reward, uint256 fee, uint8 state)",
  "function taskCount() external view returns (uint256)",
  "function feeBps() external view returns (uint256)",
  "function treasury() external view returns (address)",
  "event TaskCreated(uint256 indexed taskId, address indexed poster, uint256 reward, uint256 fee)",
  "event BidStaked(uint256 indexed taskId, address indexed agent, uint256 amount)",
  "event WinnerSelected(uint256 indexed taskId, address indexed agent)",
  "event TaskSubmitted(uint256 indexed taskId, address indexed agent)",
  "event PayoutReleased(uint256 indexed taskId, address indexed winner, uint256 reward, uint256 fee)",
  "event StakeRefunded(uint256 indexed taskId, address indexed agent, uint256 amount)",
];

export function getEscrowContract(
  contractAddress: string,
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(contractAddress, ESCROW_ABI, signerOrProvider);
}

export function getProvider(): ethers.JsonRpcProvider {
  const rpcUrl = process.env.HEDERA_RPC_URL;
  if (!rpcUrl) throw new Error("HEDERA_RPC_URL not set");
  return new ethers.JsonRpcProvider(rpcUrl);
}

export function getServerWallet(): ethers.Wallet {
  const privateKey = process.env.HEDERA_PRIVATE_KEY;
  if (!privateKey) throw new Error("HEDERA_PRIVATE_KEY not set");
  return new ethers.Wallet(privateKey, getProvider());
}

export async function createTaskOnChain(
  contractAddress: string,
  rewardHbar: number
): Promise<{ txHash: string; taskId: string }> {
  const wallet = getServerWallet();
  const contract = getEscrowContract(contractAddress, wallet);

  const value = ethers.parseEther(rewardHbar.toString());
  const tx = await contract.createTask({ value });
  const receipt = await tx.wait();

  // Parse TaskCreated event to get taskId
  const event = receipt.logs.find(
    (log: ethers.Log) =>
      log.topics[0] === ethers.id("TaskCreated(uint256,address,uint256,uint256)")
  );

  const taskId = event ? ethers.toBigInt(event.topics[1]).toString() : "0";

  return { txHash: receipt.hash, taskId };
}

export async function stakeBidOnChain(
  contractAddress: string,
  taskId: string,
  stakeHbar: number
): Promise<string> {
  const wallet = getServerWallet();
  const contract = getEscrowContract(contractAddress, wallet);

  const value = ethers.parseEther(stakeHbar.toString());
  const tx = await contract.stakeBid(taskId, { value });
  const receipt = await tx.wait();

  return receipt.hash;
}

export async function selectWinnerOnChain(
  contractAddress: string,
  taskId: string,
  winnerAddress: string
): Promise<string> {
  const wallet = getServerWallet();
  const contract = getEscrowContract(contractAddress, wallet);

  const tx = await contract.selectWinner(taskId, winnerAddress);
  const receipt = await tx.wait();

  return receipt.hash;
}

export async function submitTaskOnChain(
  contractAddress: string,
  taskId: string
): Promise<string> {
  const wallet = getServerWallet();
  const contract = getEscrowContract(contractAddress, wallet);

  const tx = await contract.submitTask(taskId);
  const receipt = await tx.wait();

  return receipt.hash;
}

export async function releasePayoutOnChain(
  contractAddress: string,
  taskId: string
): Promise<string> {
  const wallet = getServerWallet();
  const contract = getEscrowContract(contractAddress, wallet);

  const tx = await contract.releasePayout(taskId);
  const receipt = await tx.wait();

  return receipt.hash;
}

export { ESCROW_ABI };
