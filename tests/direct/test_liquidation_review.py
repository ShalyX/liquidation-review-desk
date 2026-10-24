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
