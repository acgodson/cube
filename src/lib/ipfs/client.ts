import { PinataSDK } from "pinata";
import type { SkillSnapshot } from "../types";

let pinata: PinataSDK | null = null;

function getPinataClient(): PinataSDK {
  if (pinata) return pinata;

  const jwt = process.env.PINATA_JWT;
  const gateway = process.env.PINATA_GATEWAY;

  if (!jwt || !gateway) {
    throw new Error("PINATA_JWT and PINATA_GATEWAY must be set");
  }

  pinata = new PinataSDK({
    pinataJwt: jwt,
    pinataGateway: gateway,
  });

  return pinata;
}

export async function uploadSkillSnapshot(
  snapshot: SkillSnapshot
): Promise<string> {
  const client = getPinataClient();

  const file = new File(
    [JSON.stringify(snapshot, null, 2)],
    `skill-snapshot-${snapshot.agentId}-${snapshot.taskId}.json`,
    { type: "application/json" }
  );

  const upload = await client.upload.public.file(file);
  return upload.cid;
}

export async function uploadTaskResult(
  taskId: string,
  agentId: string,
  result: Record<string, unknown>
): Promise<string> {
  const client = getPinataClient();

  const file = new File(
    [JSON.stringify(result, null, 2)],
    `task-result-${taskId}-${agentId}.json`,
    { type: "application/json" }
  );

  const upload = await client.upload.public.file(file);
  return upload.cid;
}

export function getIpfsUrl(cid: string): string {
  const gateway = process.env.PINATA_GATEWAY;
  if (!gateway) throw new Error("PINATA_GATEWAY not set");
  return `https://${gateway}/ipfs/${cid}`;
}
