import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check, CircleAlert, Copy, ExternalLink, FileSearch, LoaderCircle, RotateCw, Search, ShieldCheck, Wallet, X } from "lucide-react";
import { configuredAddress, connectWallet, connectedAccount, readReview, submitReview, validAddress } from "./lib/genlayer";
import type { ReviewRecord } from "./lib/genlayer";
import { fetchLiquidations, formatAsset, SAMPLE_TX } from "./lib/source";
import type { LiquidationEvent, SourceCase } from "./lib/source";

type Phase = "idle" | "fetching" | "ready" | "submitting" | "finalized" | "error";
const short = (value: string, start = 10, end = 8) => value.length > start + end + 3 ? `${value.slice(0, start)}…${value.slice(-end)}` : value;
const dateLabel = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Timestamp unavailable" : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";
};
const assessmentId = () => `liq-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

function App() {
  const [route, setRoute] = useState(window.location.pathname);
  const [hash, setHash] = useState("");
  const [sourceCase, setSourceCase] = useState<SourceCase | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [claim, setClaim] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");
  const [wallet, setWallet] = useState<string | null>(null);
  const [review, setReview] = useState<ReviewRecord | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [txId, setTxId] = useState("");
  const [copyDone, setCopyDone] = useState(false);

  const selected = useMemo(() => sourceCase?.events.find((event) => event.logIndex === selectedIndex) ?? null, [sourceCase, selectedIndex]);
  const readyToSubmit = phase === "ready" && sourceCase?.rpcVerified && selected && claim.trim().length >= 24 && claim.trim().length <= 600 && (!evidenceUrl.trim() || /^https:\/\//i.test(evidenceUrl.trim()));
  const submitLabel = phase === "submitting" ? "Waiting for finality…"
    : phase === "finalized" ? "Review finalized"
    : !sourceCase ? "Inspect a transaction first"
    : !selected ? "Choose a liquidation event"
    : claim.trim().length < 24 ? "Add a specific review question"
    : !/^https:\/\//i.test(evidenceUrl.trim()) && evidenceUrl.trim() ? "Use an HTTPS context URL"
    : !wallet ? "Connect wallet to review"
    : "Review with GenLayer";

  useEffect(() => {
    const routeListener = () => setRoute(window.location.pathname);
    window.addEventListener("popstate", routeListener);
    void connectedAccount().then(setWallet).catch(() => setWallet(null));
    const provider = window.ethereum;
    const accountListener = (accounts: unknown) => setWallet(Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null);
    const chainListener = () => void connectedAccount().then(setWallet).catch(() => setWallet(null));
    provider?.on?.("accountsChanged", accountListener);
    provider?.on?.("chainChanged", chainListener);
    return () => {
      window.removeEventListener("popstate", routeListener);
      provider?.removeListener?.("accountsChanged", accountListener);
      provider?.removeListener?.("chainChanged", chainListener);
    };
  }, []);

  const loadReview = useCallback(async (id: string) => {
    setReviewLoading(true); setMessage("");
    try { setReview(await readReview(id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not read this review from StudioNet."); }
    finally { setReviewLoading(false); }
  }, []);

  useEffect(() => {
    const match = route.match(/^\/review\/([a-zA-Z0-9_-]+)\/?$/);
    if (match) { void loadReview(match[1]); setTxId(""); }
    else { setReview(null); }
  }, [route, loadReview]);

  function navigate(path: string) {
    window.history.pushState({}, "", path);
    setRoute(path);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function inspectTransaction(value = hash) {
    setPhase("fetching"); setMessage(""); setSourceCase(null); setSelectedIndex(null);
    try {
      const fetched = await fetchLiquidations(value);
      setSourceCase(fetched); setHash(fetched.txHash); setSelectedIndex(fetched.events[0]?.logIndex ?? null); setPhase("ready");
      if (!fetched.rpcVerified) setMessage("The explorer returned the liquidation, but the independent Ethereum RPC did not confirm every event. Retry before submitting.");
    } catch (error) {
      setPhase("error"); setMessage(error instanceof Error ? error.message : "Could not inspect this transaction.");
    }
  }

  async function onConnect() {
    try { setWallet(await connectWallet()); setMessage(""); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Wallet connection failed."); }
  }

  async function onSubmit() {
    if (!readyToSubmit || !sourceCase || !selected) return;
    let signer = wallet;
    if (!signer) {
      try { signer = await connectWallet(); setWallet(signer); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Wallet connection failed."); return; }
    }
    if (!validAddress(configuredAddress())) { setMessage("The review service is unavailable right now. Please try again later."); return; }
    const id = assessmentId();
    setPhase("submitting"); setMessage("Waiting for wallet approval…"); setTxId("");
    try {
      const result = await submitReview({
        account: signer, id, txHash: sourceCase.txHash, logIndex: selected.logIndex,
        claim: claim.trim(), evidenceUrl: evidenceUrl.trim(),
        onSubmitted: (submittedHash) => { setTxId(submittedHash); setMessage("Consensus review submitted. Waiting for StudioNet finality and execution result…"); },
      });
      setReview(result.record); setPhase("finalized"); setMessage("Finalized and read back from the deployed contract.");
      sessionStorage.removeItem("liqreview-pending");
      navigate(`/review/${encodeURIComponent(id)}`);
    } catch (error) {
      const maybeTx = (error as Error & { transactionHash?: string }).transactionHash;
      if (maybeTx) setTxId(maybeTx);
      setPhase("error"); setMessage(error instanceof Error ? error.message : "The review could not be completed.");
    }
  }

  async function copy(value: string) {
    await navigator.clipboard.writeText(value); setCopyDone(true); window.setTimeout(() => setCopyDone(false), 1600);
  }

  const isReviewRoute = /^\/review\//.test(route);
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }} aria-label="Liquidation Review Desk home">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span>LIQUIDATION<br /><b>REVIEW DESK</b></span>
        </a>
        <nav aria-label="Main navigation"><a href="#how-it-works">Method</a><a href="#evidence-notes">Evidence notes</a></nav>
        <div className="top-actions">
          <span className="network-indicator"><i />Ethereum mainnet · StudioNet</span>
          <button className="wallet-button" onClick={onConnect}><Wallet size={15} />{wallet ? short(wallet, 6, 4) : "Connect wallet"}</button>
        </div>
      </header>

      <main>
        {isReviewRoute ? (
          <ReviewPage review={review} loading={reviewLoading} message={message} txId={txId} onBack={() => navigate("/")} onRefresh={() => { const id = route.split("/").pop(); if (id) void loadReview(decodeURIComponent(id)); }} onCopy={copy} copyDone={copyDone} />
        ) : (
          <>
            <section className="hero" aria-labelledby="hero-title">
              <div className="hero-copy">
                <p className="eyebrow"><span>INDEPENDENT CASE REVIEW</span><span className="eyebrow-line" /></p>
                <h1 id="hero-title">Review an Aave V3<br /><em>liquidation with evidence.</em></h1>
                <p className="hero-sub">Check the transaction and exact liquidation event against Ethereum sources. Add the concern and public context you want reviewed; GenLayer records an independent assessment.</p>
                <a className="text-link" href="#new-review">Start a review <ArrowDownRight size={15} /></a>
              </div>
              <aside className="hero-stamp" aria-label="Review boundary">
                <div className="stamp-top"><span>CASE SCOPE</span><span>01 / 01</span></div>
                <div className="stamp-rule" />
                <strong>After the event.<br />Before a conclusion.</strong>
                <p>Protocol math stays deterministic. Consensus reviews only the disputed context.</p>
                <div className="stamp-foot"><span>Ethereum · Aave V3</span><span>● LIVE SOURCES</span></div>
              </aside>
            </section>

            <div className="section-heading" id="new-review">
              <div><span className="section-no">01</span><h2>Start a review</h2></div>
              <p>Paste an Ethereum transaction hash. If it contains multiple Aave liquidations, select the event you want reviewed.</p>
            </div>

            <section className="workspace">
              <div className="case-form panel">
                <div className="panel-title"><span>TRANSACTION SOURCE</span><span className="tag tag-neutral">Ethereum mainnet</span></div>
                <form onSubmit={(e) => { e.preventDefault(); void inspectTransaction(); }}>
                  <label htmlFor="tx-hash">Transaction hash</label>
                  <div className="input-row">
                    <div className="input-wrap"><Search size={16} /><input id="tx-hash" value={hash} onChange={(e) => { setHash(e.target.value); setSourceCase(null); setSelectedIndex(null); setPhase("idle"); setMessage(""); }} placeholder="Paste a 32-byte Ethereum transaction hash" spellCheck={false} autoComplete="off" disabled={phase === "fetching" || phase === "submitting"} /></div>
                    <button className="button button-dark" disabled={phase === "fetching" || !hash.trim()} type="submit">{phase === "fetching" ? <><LoaderCircle className="spin" size={15} />Fetching</> : <><FileSearch size={15} />Inspect</>}</button>
                  </div>
                </form>
                <button className="sample-link" type="button" disabled={phase === "fetching" || phase === "submitting"} onClick={() => { setHash(SAMPLE_TX); void inspectTransaction(SAMPLE_TX); }}><span>Use a real sample</span><span>Ethereum · 2 liquidation events <ArrowRight size={13} /></span></button>

                {sourceCase && <div className="source-summary" aria-live="polite">
                  <div className="source-summary-head"><div><span className="source-kicker">SOURCE RECORD FOUND</span><strong>{sourceCase.events.length} liquidation {sourceCase.events.length === 1 ? "event" : "events"} in this transaction</strong></div><a href={sourceCase.transactionUrl} target="_blank" rel="noreferrer" aria-label="Open transaction in Blockscout"><ExternalLink size={15} /></a></div>
                  <div className="source-checks"><span className="check-ok"><Check size={13} />Blockscout transaction data</span><span className={sourceCase.rpcVerified ? "check-ok" : "check-warn"}>{sourceCase.rpcVerified ? <Check size={13} /> : <CircleAlert size={13} />}Independent RPC {sourceCase.rpcVerified ? "matches" : "not confirmed"}</span></div>
                  <div className="source-meta"><span>BLOCK <b>{sourceCase.blockNumber.toString()}</b></span><span>MINED <b>{dateLabel(sourceCase.timestamp)}</b></span><span>CONFIRMATIONS <b>{sourceCase.confirmations.toLocaleString()}</b></span></div>
                  <div className="event-list" role="radiogroup" aria-label="Select the liquidation event to review">
                    {sourceCase.events.map((event, i) => <EventChoice key={event.logIndex} event={event} number={i + 1} selected={selectedIndex === event.logIndex} onClick={() => setSelectedIndex(event.logIndex)} />)}
                  </div>
                </div>}

                <div className="form-divider" />
                <div className="panel-title"><span>YOUR REVIEW QUESTION</span><span className="tag tag-warm">Keep it specific</span></div>
                <label htmlFor="concern">What should be looked at?</label>
                <textarea id="concern" value={claim} onChange={(e) => setClaim(e.target.value)} maxLength={600} placeholder="Describe the specific execution concern. For example: the collateral received appears inconsistent with the protocol's published liquidation parameters at this block." rows={4} />
                <div className="field-foot"><span>Do not enter personal information. The case is public and permanent.</span><span>{claim.length}/600</span></div>
                <label htmlFor="evidence-url" className="evidence-label">Public context URL <span>OPTIONAL</span></label>
                <input className="plain-input" id="evidence-url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://…" spellCheck={false} />
                <p className="field-help">Use a public market, protocol, or governance source relevant to your concern. The contract fetches it again; page instructions are treated as untrusted.</p>

                {message && <div className={`notice ${phase === "error" || (sourceCase && !sourceCase.rpcVerified) ? "notice-warn" : ""}`} role="status"><CircleAlert size={16} /><span>{message}{txId && <><br /><a href={`https://explorer-studio.genlayer.com/tx/${txId}`} target="_blank" rel="noreferrer">Inspect GenLayer transaction {short(txId)}</a></>}</span><button aria-label="Dismiss message" onClick={() => setMessage("")}><X size={15} /></button></div>}

                <button className="button button-primary submit-button" type="button" disabled={!readyToSubmit} onClick={() => wallet ? void onSubmit() : void onConnect()}>
                  {phase === "submitting" ? <><LoaderCircle className="spin" size={16} />{submitLabel}</> : phase === "finalized" ? <><Check size={16} />{submitLabel}</> : readyToSubmit && wallet ? <><Activity size={16} />{submitLabel}</> : readyToSubmit ? <><Wallet size={16} />{submitLabel}</> : <><ArrowRight size={16} />{submitLabel}</>}
                </button>
                <p className="submit-note">Use a public source for claims beyond on-chain facts; without context the result may stay inconclusive. StudioNet assessment data is permanent and public.</p>
              </div>

              <aside className="case-aside">
                <div className="aside-top"><span>WHAT THE RECORD PROVES</span><ShieldCheck size={17} /></div>
                <div className="aside-rule" />
                <ul className="proof-list">
                  <li><span className="proof-index">A</span><span><b>Transaction</b><small>Explorer data checked against an independent Ethereum receipt.</small></span></li>
                  <li><span className="proof-index">B</span><span><b>Selected Aave event</b><small>Pool, event signature, log index, and decoded fields.</small></span></li>
                  <li><span className="proof-index">C</span><span><b>Context review</b><small>Validators assess the cited concern, not just the event.</small></span></li>
                </ul>
                <div className="aside-caution"><strong><CircleAlert size={15} />A review is not a remedy.</strong><p>It cannot undo a liquidation, recover assets, or establish legal wrongdoing. Missing evidence stays inconclusive.</p></div>
                <div className="aside-bottom"><span>PUBLIC · SOURCE FIRST</span><span>GENLAYER / STUDIONET</span></div>
              </aside>
            </section>

            <section className="how-section" id="how-it-works">
              <div className="how-intro"><p className="eyebrow"><span>METHOD</span><span className="eyebrow-line" /></p><h2>Facts first.<br /><em>Judgment second.</em></h2><p>Liquidation eligibility and event data are protocol facts. Whether the context supports a particular concern is the part that benefits from independent review.</p></div>
              <div className="steps">
                <article><span>01</span><div><h3>Read the event</h3><p>Fetch the transaction and its Aave V3 liquidation logs from Ethereum mainnet. A batched transaction stays split into individual events.</p></div></article>
                <article><span>02</span><div><h3>Compare two sources</h3><p>The desk checks explorer transaction and log data against an Ethereum receipt. GenLayer independently fetches and compares the case again.</p></div></article>
                <article><span>03</span><div><h3>Record a bounded review</h3><p>Validators assess the selected concern against the cited context. Finalized results are read back from the contract before they appear here.</p></div></article>
              </div>
            </section>

            <section className="notes-section" id="evidence-notes">
              <div className="notes-mark">!</div><div><span className="eyebrow-inline">EVIDENCE BOUNDARY</span><h2>A chain event is evidence of what happened on-chain.</h2><p>It does not, by itself, prove that a liquidation was fair or unfair. This desk is a research tool for a second look; Aave’s protocol rules, historical oracle state, market depth, and other relevant context still matter.</p></div>
              <a href="https://aave.com/faq" target="_blank" rel="noreferrer" className="text-link">Aave liquidation guide <ArrowUpRight size={15} /></a>
            </section>

          </>
        )}
      </main>

      <footer className="footer"><div className="footer-brand"><span className="brand-mark" aria-hidden="true"><i /></span>LIQUIDATION REVIEW DESK</div><span>Ethereum evidence · GenLayer consensus</span><a href="https://github.com/ShalyX/liquidation-review-desk" target="_blank" rel="noreferrer">Open-source project <ArrowUpRight size={13} /></a></footer>
    </div>
  );
}

function EventChoice({ event, number, selected, onClick }: { event: LiquidationEvent; number: number; selected: boolean; onClick: () => void }) {
  return <button type="button" role="radio" aria-checked={selected} className={`event-choice ${selected ? "selected" : ""}`} onClick={onClick}>
    <span className="event-radio">{selected && <i />}</span><span className="event-main"><span className="event-kicker">EVENT {String(number).padStart(2, "0")} · LOG {event.logIndex}</span><b>{short(event.borrower, 8, 6)}</b><small>Borrower · {short(event.liquidator, 8, 6)} liquidator</small></span>
    <span className="event-amount"><b>{formatAsset(event.debtToCover, event.debtAsset)}</b><small>Debt repaid</small></span><ArrowRight className="event-arrow" size={15} />
  </button>;
}

function ReviewPage({ review, loading, message, txId, onBack, onRefresh, onCopy, copyDone }: { review: ReviewRecord | null; loading: boolean; message: string; txId: string; onBack: () => void; onRefresh: () => void; onCopy: (value: string) => void; copyDone: boolean }) {
  const outcomeLabel: Record<string, string> = { concern_found: "Concern supported", no_concern_identified: "No concern identified", unclear: "Inconclusive", source_failure: "Source unavailable" };
  return <section className="review-page">
    <button className="back-link" onClick={onBack}>← BACK TO REVIEW DESK</button>
    <p className="eyebrow"><span>PUBLIC CASE RECORD</span><span className="eyebrow-line" /></p>
    {loading ? <div className="loading-state"><LoaderCircle className="spin" size={24} /><p>Reading finalized case from StudioNet…</p></div> : review ? <>
      <div className="review-title-row"><div><h1>{review.assessment_id}</h1><p>Finalized review record · values read from the deployed contract</p></div><button className="icon-button" onClick={onRefresh} aria-label="Refresh contract readback"><RotateCw size={16} /></button></div>
      <div className="review-grid"><article className="review-result panel"><div className="panel-title"><span>CONSENSUS REVIEW</span><span className={`tag ${review.outcome === "concern_found" ? "tag-warm" : review.outcome === "source_failure" ? "tag-neutral" : "tag-green"}`}>{outcomeLabel[review.outcome] ?? review.outcome}</span></div><h2>{review.rationale}</h2><div className="review-badges"><span>{review.confidence} confidence</span><span>{review.basis.replaceAll("_", " ")}</span></div><p className="review-caveat">This is an evidence triage result. It does not declare the liquidation fair or unfair, establish wrongdoing, or trigger a remedy.</p><h3>Submitter’s concern</h3><p>{review.claim}</p></article>
        <aside className="review-facts panel"><div className="panel-title"><span>VERIFIED EVENT FACTS</span><Check size={15} /></div><Fact label="Ethereum transaction" value={short(review.tx_hash, 14, 8)} href={`https://eth.blockscout.com/tx/${review.tx_hash}`} /><Fact label="Event log" value={`#${String(review.log_index)}`} /><Fact label="Block" value={String(review.block_number)} /><Fact label="Timestamp" value={dateLabel(review.tx_timestamp)} /><Fact label="Borrower" value={short(review.borrower, 12, 8)} /><Fact label="Liquidator" value={short(review.liquidator, 12, 8)} /><Fact label="Collateral / debt" value={`${short(review.collateral_asset, 7, 4)} / ${short(review.debt_asset, 7, 4)}`} /><Fact label="Aave pool event" value="LiquidationCall" /></aside></div>
      <div className="chain-record"><div><span className="eyebrow-inline">STUDIONET RECORD</span><b>Consensus finalized · contract readback verified</b><small>Created {new Date(Number(review.created_at) * 1000).toLocaleString()}</small></div><button className="button button-outline" onClick={() => onCopy(window.location.href)}>{copyDone ? <Check size={14} /> : <Copy size={14} />}{copyDone ? "Copied link" : "Copy public link"}</button><a href={`https://explorer-studio.genlayer.com/address/${review.contract_address || configuredAddress()}`} target="_blank" rel="noreferrer">Contract <ExternalLink size={13} /></a></div>
      {review.evidence_url && <p className="evidence-link-row">Context source: <a href={review.evidence_url} target="_blank" rel="noreferrer">{review.evidence_url}</a></p>}
      <div className="digest-row">Source commitments <code>Explorer transaction · {review.transaction_digest}</code><code>Explorer logs · {review.logs_digest}</code><code>Ethereum RPC receipt · {review.rpc_digest}</code><code>Context evidence · {review.evidence_digest || "none supplied"}</code></div>
    </> : <div className="load-error"><CircleAlert size={24} /><h2>Could not read this case.</h2><p>{message || "The contract address may be missing, or this case has not been finalized yet."}</p>{txId && <a href={`https://explorer-studio.genlayer.com/tx/${txId}`} target="_blank" rel="noreferrer">Check the GenLayer transaction</a>}<button className="button button-outline" onClick={onRefresh}><RotateCw size={14} />Try again</button></div>}
  </section>;
}

function Fact({ label, value, href }: { label: string; value: string; href?: string }) {
  return <div className="fact"><span>{label}</span>{href ? <a href={href} target="_blank" rel="noreferrer">{value}<ExternalLink size={12} /></a> : <b>{value}</b>}</div>;
}

export default App;
