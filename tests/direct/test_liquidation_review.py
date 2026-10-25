import json
from pathlib import Path

import pytest

CONTRACT = "contracts/liquidation_review.py"
FIXTURE = json.loads((Path(__file__).resolve().parents[1] / "fixtures" / "aave-batched-liquidation.json").read_text())
TX = FIXTURE["transaction"]
LOGS = FIXTURE["logs"]
TX_HASH = TX["hash"]


def deploy(direct_deploy):
    return direct_deploy(CONTRACT, sdk_version="v0.2.16")


def test_real_batched_transaction_selects_each_exact_liquidation_event(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    tx = json.dumps(TX)
    logs = json.dumps(LOGS)
    first = contract._parse_source_facts(tx, logs, TX_HASH, 2295)
    second = contract._parse_source_facts(tx, logs, TX_HASH, 2306)
    assert first["block_number"] == 26196204
    assert first["liquidation"]["borrower"] == "0x46b1589e796c1102f68e2889a3315e42e600a901"
    assert first["liquidation"]["debt_to_cover"] == "1067361"
    assert second["liquidation"]["borrower"] == "0x3b552c96251544c9ef12374143b2f92b2b56136a"
    assert second["liquidation"]["debt_to_cover"] == "861242"
    assert first["liquidation"]["log_index"] != second["liquidation"]["log_index"]


def test_cli_hex_integer_normalizes_to_the_same_transaction_hash(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    assert contract._validate_tx_hash(int(TX_HASH, 16)) == TX_HASH


def test_independent_routescan_receipt_matches_the_selected_aave_event(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    receipt_logs = [{
        "address": item["address"]["hash"],
        "topics": item["topics"],
        "data": item["data"],
        "logIndex": hex(int(item["index"])),
    } for item in LOGS["items"]]
    receipt = {
        "transactionHash": TX_HASH,
        "status": "0x1",
        "blockNumber": hex(int(TX["block_number"])),
        "logs": receipt_logs,
    }
    direct_vm.mock_web(r".*eth\.blockscout\.com/api/v2/transactions/" + TX_HASH + r"/logs$", {
        "status": 200, "body": json.dumps(LOGS),
    })
    direct_vm.mock_web(r".*eth\.blockscout\.com/api/v2/transactions/" + TX_HASH + r"$", {
        "status": 200, "body": json.dumps(TX),
    })
    direct_vm.mock_web(r".*api\.routescan\.io/v2/network/mainnet/evm/1/etherscan/api.*", {
        "status": 200, "body": json.dumps({"jsonrpc": "2.0", "id": 1, "result": receipt}),
    })

    result = contract._fetch_source_case(TX_HASH, 2295)
    assert result["case"]["block_number"] == int(TX["block_number"])
    assert result["case"]["liquidation"]["log_index"] == 2295
    assert result["case"]["liquidation"]["borrower"] == "0x46b1589e796c1102f68e2889a3315e42e600a901"
    assert result["rpc_digest"]


def test_source_fact_digests_ignore_provider_formatting_and_confirmation_drift(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    parsed = contract._parse_source_facts(json.dumps(TX), json.dumps(LOGS), TX_HASH, 2295)
    first = contract._source_fact_digests(parsed, parsed)
    updated = {**parsed, "confirmations": parsed["confirmations"] + 1}
    second = contract._source_fact_digests(updated, updated)
    assert first == second


def test_large_blockscout_payload_is_not_truncated_before_json_parsing(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    # Regression case: a live multi-event liquidation returned 109,393 bytes.
    tx = {**TX, "expanded_metadata": "x" * 20000}
    logs = {**LOGS, "expanded_metadata": "y" * 100000}
    tx_body = contract._bounded_body(json.dumps(tx))
    logs_body = contract._bounded_body(json.dumps(logs))
    assert len(tx_body) > 18000
    assert len(logs_body) > 100000
    parsed = contract._parse_source_facts(tx_body, logs_body, TX_HASH, 2295)
    assert parsed["block_number"] == 26196204


@pytest.mark.parametrize("mutator", [
    lambda tx, logs: ({**tx, "status": "error"}, logs),
    lambda tx, logs: ({**tx, "hash": "0x" + "0" * 64}, logs),
    lambda tx, logs: (tx, {"items": [{**logs["items"][0], "address": {"hash": "0x" + "1" * 40}}]}),
    lambda tx, logs: (tx, {"items": [{**logs["items"][0], "topics": ["0x" + "1" * 64, *logs["items"][0]["topics"][1:]]}]}),
    lambda tx, logs: (tx, {"items": [{**logs["items"][0], "data": "0x1234"}]}),
])
def test_source_failures_and_mismatches_fail_closed(direct_vm, direct_deploy, direct_alice, mutator):
    contract = deploy(direct_deploy)
    tx, logs = mutator(TX, LOGS)
    with pytest.raises(Exception):
        contract._parse_source_facts(json.dumps(tx), json.dumps(logs), TX_HASH, 2295)


def test_wrong_log_index_is_not_silently_replaced_by_another_event(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    with pytest.raises(Exception):
        contract._parse_source_facts(json.dumps(TX), json.dumps(LOGS), TX_HASH, 2300)


@pytest.mark.parametrize("url", [
    "http://example.com/evidence",
    "https://localhost/private",
    "https://127.0.0.1/private",
    "https://10.0.0.4/private",
    "https://service.local/private",
    "https://user:pass@example.com/private",
    "https://example.com:8443/private",
])
def test_private_or_ambiguous_evidence_urls_are_rejected(direct_vm, direct_deploy, direct_alice, url):
    contract = deploy(direct_deploy)
    with pytest.raises(Exception):
        contract._validate_evidence_url(url)


def test_public_https_evidence_url_is_accepted(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    assert contract._validate_evidence_url("https://aave.com/faq?section=liquidations") == "https://aave.com/faq?section=liquidations"


@pytest.mark.parametrize("value", [
    {"outcome": "made_up", "basis": "supporting_context", "confidence": "high", "rationale": "x"},
    {"outcome": "unclear", "basis": "insufficient_context", "confidence": "high", "rationale": "x"},
    {"outcome": "concern_found", "basis": "supporting_context", "confidence": "high", "rationale": ""},
    {"outcome": "no_concern_identified", "basis": "supporting_context", "confidence": "high", "rationale": "x", "extra": "material"},
    {"outcome": "concern_found", "basis": "supporting_context", "confidence": "high",
     "rationale": "The value is below the stated threshold and contradicts the concern."},
    {"outcome": "concern_found", "basis": "supporting_context", "confidence": "high",
     "rationale": "Exact comparison: the ratio is about 1.05584 (5.584%), which is not above 1.06; this calculation actually contradicts that concern."},
    {"outcome": "no_concern_identified", "basis": "supporting_context", "confidence": "high",
     "rationale": "The evidence supports the concern and exceeds the threshold."},
    {"outcome": "no_concern_identified", "basis": "contradicting_context", "confidence": "high",
     "rationale": "The ratio is above the 1.05 threshold, so the snapshot supports investigating the concern."},
])
def test_review_result_parser_rejects_invalid_or_overconfident_outputs(direct_vm, direct_deploy, direct_alice, value):
    contract = deploy(direct_deploy)
    with pytest.raises(Exception):
        contract._parse_review_result(value)


def test_equivalence_compares_every_consequential_source_and_decision_field(direct_vm, direct_deploy, direct_alice):
    contract = deploy(direct_deploy)
    leader = {"outcome": "concern_found", "basis": "supporting_context", "confidence": "high",
              "transaction_digest": "a", "logs_digest": "b", "rpc_digest": "c", "evidence_digest": "d"}
    assert contract._reviews_equivalent(leader, dict(leader))
    for key, changed in (("outcome", "unclear"), ("basis", "insufficient_context"),
                         ("confidence", "low"), ("transaction_digest", "x"), ("logs_digest", "y"),
                         ("rpc_digest", "z"), ("evidence_digest", "e")):
        validator = dict(leader)
        validator[key] = changed
        assert not contract._reviews_equivalent(leader, validator)
