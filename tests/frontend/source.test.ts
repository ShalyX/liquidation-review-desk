import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLiquidations, SAMPLE_TX } from "../../src/lib/source";
import fixture from "../fixtures/aave-batched-liquidation.json";

const asRpcReceipt = (options: { logs?: Array<Record<string, unknown>>; block?: string; status?: string; hash?: string } = {}) => ({
  transactionHash: options.hash ?? SAMPLE_TX,
  status: options.status ?? "0x1",
  blockNumber: options.block ?? "0x18fb8ec",
  logs: options.logs ?? fixture.logs.items.map((log: any) => ({
    address: log.address.hash,
    topics: log.topics,
    data: log.data,
    logIndex: `0x${Number(log.index).toString(16)}`,
  })),
});

function stubSources(receipt = asRpcReceipt(), chainId = "0x1") {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/logs")) return new Response(JSON.stringify(fixture.logs), { status: 200 });
    if (url.includes("/transactions/")) return new Response(JSON.stringify(fixture.transaction), { status: 200 });
    const request = JSON.parse(String(init?.body));
    if (request.method === "eth_chainId") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: chainId }), { status: 200 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: receipt }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Ethereum receipt verification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts the exact two-event sample only after RPC matches the explorer set and block", async () => {
    const fetchMock = stubSources();
    const result = await fetchLiquidations(SAMPLE_TX);
    expect(result.blockscoutVerified).toBe(true);
    expect(result.rpcVerified).toBe(true);
    expect(result.blockNumber).toBe(26196204n);
    expect(result.events.map((event) => event.logIndex)).toEqual([2295, 2306]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects an RPC receipt that omits one of the liquidation logs", async () => {
    const allEvents = asRpcReceipt().logs;
    const oneEvent = allEvents.filter((log) => Number(BigInt(String(log.logIndex))) === 2295);
    stubSources(asRpcReceipt({ logs: oneEvent }));
    const result = await fetchLiquidations(SAMPLE_TX);
    expect(result.rpcVerified).toBe(false);
  });

  it("rejects an RPC receipt from another block", async () => {
    stubSources(asRpcReceipt({ block: "0x18fb8ed" }));
    const result = await fetchLiquidations(SAMPLE_TX);
    expect(result.rpcVerified).toBe(false);
  });

  it("rejects reverted and wrong-hash receipts", async () => {
    stubSources(asRpcReceipt({ status: "0x0" }));
    expect((await fetchLiquidations(SAMPLE_TX)).rpcVerified).toBe(false);
    stubSources(asRpcReceipt({ hash: `0x${"0".repeat(64)}` }));
    expect((await fetchLiquidations(SAMPLE_TX)).rpcVerified).toBe(false);
  });

  it("rejects a receipt from an endpoint that is not Ethereum mainnet", async () => {
    stubSources(asRpcReceipt(), "0xf22f");
    expect((await fetchLiquidations(SAMPLE_TX)).rpcVerified).toBe(false);
  });
});
