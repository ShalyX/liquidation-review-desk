export const SAMPLE_TX = "0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008";
export const AAVE_V3_ETH_POOL = "0x87870bca3f3fd6335c3f4ce8392d69350b4fa4e2";
export const LIQUIDATION_TOPIC = "0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286";
const BLOCKSCOUT = "https://eth.blockscout.com/api/v2";
const PUBLIC_RPC = "https://ethereum-rpc.publicnode.com";

export type LiquidationEvent = {
  logIndex: number;
  pool: string;
  collateralAsset: string;
  debtAsset: string;
  borrower: string;
  debtToCover: bigint;
  collateralAmount: bigint;
  liquidator: string;
  receiveAToken: boolean;
};

export type SourceCase = {
  txHash: string;
  blockNumber: bigint;
  timestamp: string;
  confirmations: number;
  transactionStatus: string;
  transactionUrl: string;
  events: LiquidationEvent[];
  blockscoutVerified: boolean;
  rpcVerified: boolean;
};

type BlockscoutLog = {
  address?: { hash?: string };
  topics?: string[];
  data?: string;
  index?: number;
};

const normalizeHash = (value: string) => value.trim().toLowerCase();
const addressFromWord = (word: string) => {
  const hex = word.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("Malformed indexed address in Aave event.");
  return `0x${hex.slice(-40)}`;
};

function parseEvent(log: BlockscoutLog): LiquidationEvent | null {
  const topics = log.topics ?? [];
  if ((log.address?.hash ?? "").toLowerCase() !== AAVE_V3_ETH_POOL || topics[0]?.toLowerCase() !== LIQUIDATION_TOPIC) return null;
  if (topics.length < 4 || typeof log.data !== "string") throw new Error("Aave liquidation event has incomplete fields.");
  const data = log.data.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{256}$/.test(data)) throw new Error("Aave liquidation event has malformed data.");
  const receiveWord = BigInt(`0x${data.slice(192, 256)}`);
  if (receiveWord !== 0n && receiveWord !== 1n) throw new Error("Aave event contains an invalid receive-aToken flag.");
  return {
    logIndex: Number(log.index),
    pool: AAVE_V3_ETH_POOL,
    collateralAsset: addressFromWord(topics[1]),
    debtAsset: addressFromWord(topics[2]),
    borrower: addressFromWord(topics[3]),
    debtToCover: BigInt(`0x${data.slice(0, 64)}`),
    collateralAmount: BigInt(`0x${data.slice(64, 128)}`),
    liquidator: addressFromWord(data.slice(128, 192)),
    receiveAToken: receiveWord === 1n,
  };
}

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Source returned HTTP ${response.status}.`);
  return response.json();
}

async function verifyWithRpc(hash: string, selectedEvents: LiquidationEvent[], expectedBlock: bigint): Promise<boolean> {
  try {
    const [receiptResponse, chainResponse] = await Promise.all([
      fetch(PUBLIC_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        signal: AbortSignal.timeout(15_000),
      }),
      fetch(PUBLIC_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(15_000),
      }),
    ]);
    if (!receiptResponse.ok || !chainResponse.ok) return false;
    const [envelope, chainEnvelope] = await Promise.all([
      receiptResponse.json() as Promise<{ result?: { transactionHash?: string; status?: string; blockNumber?: string; logs?: Array<{ address?: string; topics?: string[]; data?: string; logIndex?: string }> }; error?: { message?: string } }>,
      chainResponse.json() as Promise<{ result?: string; error?: { message?: string } }>,
    ]);
    if (chainEnvelope.error || chainEnvelope.result?.toLowerCase() !== "0x1") return false;
    const receipt = envelope.result;
    if (!receipt || envelope.error || normalizeHash(receipt.transactionHash ?? "") !== hash || receipt.status !== "0x1" ||
        receipt.blockNumber === undefined || BigInt(receipt.blockNumber) !== expectedBlock) return false;
    const rpcEvents = (receipt.logs ?? []).flatMap((log) => {
      const parsed = parseEvent({ address: { hash: log.address }, topics: log.topics, data: log.data, index: Number(BigInt(log.logIndex ?? "0x0")) });
      return parsed ? [parsed] : [];
    }).sort((a, b) => a.logIndex - b.logIndex);
    return rpcEvents.length === selectedEvents.length && selectedEvents.every((event, index) => eventEqual(event, rpcEvents[index]));
  } catch {
    return false;
  }
}

export function eventEqual(a: LiquidationEvent, b: LiquidationEvent): boolean {
  return a.logIndex === b.logIndex && a.pool === b.pool && a.collateralAsset === b.collateralAsset &&
    a.debtAsset === b.debtAsset && a.borrower === b.borrower && a.debtToCover === b.debtToCover &&
    a.collateralAmount === b.collateralAmount && a.liquidator === b.liquidator && a.receiveAToken === b.receiveAToken;
}

export async function fetchLiquidations(rawHash: string): Promise<SourceCase> {
  const txHash = normalizeHash(rawHash);
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) throw new Error("Enter a 32-byte Ethereum transaction hash.");
  const [txData, logsData] = await Promise.all([
    getJson(`${BLOCKSCOUT}/transactions/${txHash}`),
    getJson(`${BLOCKSCOUT}/transactions/${txHash}/logs`),
  ]) as [Record<string, unknown>, { items?: BlockscoutLog[] }];
  if (normalizeHash(String(txData.hash ?? "")) !== txHash) throw new Error("Explorer response did not match the requested transaction.");
  if (String(txData.status ?? "").toLowerCase() !== "ok" || !txData.block_number) throw new Error("Transaction is not a successful, mined Ethereum transaction.");
  if (!Array.isArray(logsData.items)) throw new Error("Explorer did not return a transaction log list.");
  const events = logsData.items.flatMap((log) => {
    const parsed = parseEvent(log);
    return parsed ? [parsed] : [];
  }).sort((a, b) => a.logIndex - b.logIndex);
  if (!events.length) throw new Error("No canonical Aave V3 LiquidationCall event was found in this transaction.");
  const blockNumber = BigInt(String(txData.block_number));
  const rpcVerified = await verifyWithRpc(txHash, events, blockNumber);
  return {
    txHash,
    blockNumber,
    timestamp: String(txData.timestamp ?? ""),
    confirmations: Number(txData.confirmations ?? 0),
    transactionStatus: String(txData.status),
    transactionUrl: `https://eth.blockscout.com/tx/${txHash}`,
    events,
    blockscoutVerified: true,
    rpcVerified,
  };
}

export function formatUnits(value: bigint, decimals = 18): string {
  const whole = value / 10n ** BigInt(decimals);
  const fraction = (value % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

const TOKENS: Record<string, { symbol: string; decimals: number }> = {
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": { symbol: "USDC", decimals: 6 },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": { symbol: "USDT", decimals: 6 },
  "0x6b175474e89094c44da98b954eedeac495271d0f": { symbol: "DAI", decimals: 18 },
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": { symbol: "WETH", decimals: 18 },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": { symbol: "WBTC", decimals: 8 },
  "0x514910771af9ca656af840dff83e8264ecf986ca": { symbol: "LINK", decimals: 18 },
};

export function formatAsset(value: bigint, address: string): string {
  const token = TOKENS[address.toLowerCase()];
  return token ? `${formatUnits(value, token.decimals)} ${token.symbol}` : `${value.toString()} raw units · ${address.slice(0, 8)}…`;
}
