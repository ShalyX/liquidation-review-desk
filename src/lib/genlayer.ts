import { getReceiptFailureMessage, isFailedReceipt } from "./receipt";

const env = import.meta.env;
const ENDPOINT = String(env.VITE_GENLAYER_ENDPOINT || "https://studio.genlayer.com/api").trim();
const CONFIGURED_ADDRESS = String(env.VITE_CONTRACT_ADDRESS || "").trim();
const LEGACY_READ_ADDRESSES = ["0x0Eb39598774744dFf564E1781c10b6eEe85aB853"];
export const STUDIONET_CHAIN_ID = "61999";
export const STUDIONET_CHAIN_HEX = "0xf22f";

type Provider = { request(args: { method: string; params?: unknown[] }): Promise<unknown>; on?(event: string, cb: (...args: unknown[]) => void): void; removeListener?(event: string, cb: (...args: unknown[]) => void): void; isRabby?: boolean; providers?: Provider[] };
declare global { interface Window { ethereum?: Provider } }
type GenClient = { writeContract(input: Record<string, unknown>): Promise<string>; readContract(input: Record<string, unknown>): Promise<unknown>; waitForTransactionReceipt(input: Record<string, unknown>): Promise<any> };

export type ReviewRecord = {
  assessment_id: string; submitter: string; tx_hash: string; log_index: bigint | number;
  block_number: bigint | number; tx_timestamp: string; borrower: string; liquidator: string;
  collateral_asset: string; debt_asset: string; debt_to_cover: string; collateral_amount: string;
  receive_a_token: boolean; claim: string; evidence_url: string; outcome: string; basis: string;
  confidence: string; rationale: string; transaction_digest: string; logs_digest: string;
  rpc_digest: string; evidence_digest: string;
  created_at: bigint | number;
};

export function injectedProvider(): Provider | null {
  const root = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!root) return null;
  const providers = root.providers ?? [];
  return providers.find((p) => p.isRabby) ?? (root.isRabby ? root : providers[0] ?? root);
}
export function configuredAddress(): string {
  return CONFIGURED_ADDRESS;
}
export function validAddress(address: string) { return /^0x[0-9a-fA-F]{40}$/.test(address.trim()); }

export async function connectedAccount(): Promise<string | null> {
  const wallet = injectedProvider();
  if (!wallet) return null;
  const accounts = await wallet.request({ method: "eth_accounts" });
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
}

export async function connectWallet(): Promise<string> {
  const wallet = injectedProvider();
  if (!wallet) throw new Error("No EVM wallet is available in this browser.");
  const accounts = await wallet.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string") throw new Error("The wallet did not return an account.");
  const chain = await wallet.request({ method: "eth_chainId" });
  if (typeof chain !== "string" || BigInt(chain).toString() !== STUDIONET_CHAIN_ID) {
    throw new Error("Switch your wallet to GenLayer StudioNet, then reconnect.");
  }
  return accounts[0];
}

async function client(account?: string): Promise<GenClient> {
  const [{ createClient }, { studionet }] = await Promise.all([import("genlayer-js"), import("genlayer-js/chains")]);
  return createClient({
    chain: studionet,
    ...(account ? { account: account as `0x${string}`, provider: injectedProvider() as never } : {}),
    endpoint: ENDPOINT,
  }) as unknown as GenClient;
}

const address = () => {
  const candidate = configuredAddress();
  if (!validAddress(candidate)) throw new Error("The StudioNet contract address is not configured yet.");
  return candidate;
};

export async function readReview(id: string): Promise<ReviewRecord> {
  const api = await client();
  const activeAddress = address();
  try {
    return await api.readContract({ address: activeAddress, functionName: "get_assessment", args: [id] }) as ReviewRecord;
  } catch (activeError) {
    for (const legacyAddress of LEGACY_READ_ADDRESSES) {
      if (legacyAddress.toLowerCase() === activeAddress.toLowerCase()) continue;
      try {
        return await api.readContract({ address: legacyAddress, functionName: "get_assessment", args: [id] }) as ReviewRecord;
      } catch {
        // Preserve the active contract error if no known deployment has this record.
      }
    }
    throw activeError;
  }
}

export async function submitReview(input: { account: string; id: string; txHash: string; logIndex: number; claim: string; evidenceUrl: string; onSubmitted?: (hash: string) => void }): Promise<{ hash: string; record: ReviewRecord }> {
  const api = await client(input.account);
  const hash = await api.writeContract({
    address: address(), functionName: "review_liquidation",
    args: [input.id, input.txHash, BigInt(input.logIndex), input.claim, input.evidenceUrl], value: 0n,
  });
  input.onSubmitted?.(hash);
  const receipt = await api.waitForTransactionReceipt({ hash, status: "FINALIZED", interval: 5000, retries: 120 });
  if (isFailedReceipt(receipt)) throw Object.assign(new Error(getReceiptFailureMessage(receipt) ?? "Transaction finalized with an execution error."), { transactionHash: hash });
  const record = await readReview(input.id);
  if (record.tx_hash?.toLowerCase() !== input.txHash.toLowerCase() || Number(record.log_index) !== input.logIndex) throw new Error("Finalized transaction readback does not match the submitted case.");
  return { hash, record };
}
