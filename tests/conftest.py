"""
Shared fixtures for the AgentVault Direct Mode suite.

Every test here runs `contracts/AgentVault.py` on a real GenVM build through
`genlayer-test`'s Direct Mode. The contract is loaded as-is — nothing is stubbed
or re-implemented — so the suite cannot drift from the file that is deployed.

Two notes on what the harness supplies and what it cannot:

* `chain_warp` sets the contract's clock. `direct_vm.warp()` alone is not
  enough: in genlayer-test 0.29.2 it moves the timestamp the VM reports but does
  **not** refresh `gl.message_raw["datetime"]`, which is the value this contract
  actually reads. The helper writes that key directly.
* Native GEN movement is **not** observable here. The payout goes out through
  `emit_transfer` on an `@gl.evm.contract_interface`, and Direct Mode's wasi mock
  does not capture the outgoing message. Everything up to the transfer — the
  deterministic gates, the budget arithmetic, `spent`, `actions_used`, the status
  transition — is checked; the transfer itself is evidenced on StudioNet in
  TESTING.md instead of being asserted here.
"""

import json
import os
import pathlib
import sys

import pytest

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Overridable so the mutation harness can point this same suite at a mutant.
CONTRACT = pathlib.Path(
    os.environ.get("AGENTVAULT_CONTRACT") or ROOT / "contracts" / "AgentVault.py"
)

# The GenVM build the suite runs on, pinned so a laptop and a CI runner execute
# the same runtime. Left unpinned, gltest uses whatever is cached locally and
# otherwise downloads the newest release.
GENVM_VERSION = os.environ.get("GENVM_VERSION", "v0.2.12")

AUTHORIZED = json.dumps({
    "decision": "AUTHORIZED", "failed_check": 0, "reason": "within scope",
})
DENIED = json.dumps({
    "decision": "DENIED", "failed_check": 2, "reason": "outside the mandate",
})

ANY_PROMPT = r"."

# A fixed instant the whole suite starts from.
START = "2026-06-01T12:00:00.000000Z"


def hex_of(address) -> str:
    """Normalise whatever gltest hands back into the 0x-hex the contract wants."""
    if isinstance(address, (bytes, bytearray)):
        return "0x" + bytes(address).hex()
    for attribute in ("as_hex", "hex"):
        value = getattr(address, attribute, None)
        if value is not None:
            return value() if callable(value) else value
    return str(address)


def iso(year, month, day, hour=0, minute=0, second=0) -> str:
    return (f"{year:04d}-{month:02d}-{day:02d}"
            f"T{hour:02d}:{minute:02d}:{second:02d}.000000Z")


@pytest.fixture
def contract(direct_vm, direct_deploy):
    return direct_deploy(CONTRACT, sdk_version=GENVM_VERSION)


@pytest.fixture
def chain_warp(contract):
    """Move the clock the contract actually reads.

    `direct_vm.warp()` does not refresh `gl.message_raw["datetime"]` in
    genlayer-test 0.29.2, and that key is what `_chain_iso()` returns — so the
    helper writes it directly. Without this, no deadline or expiry path in this
    contract is reachable from a test.
    """
    def _warp(stamp: str) -> str:
        gl_module = sys.modules.get("genlayer.gl")
        if gl_module is not None and getattr(gl_module, "message_raw", None):
            gl_module.message_raw["datetime"] = stamp
        return stamp

    _warp(START)
    return _warp


@pytest.fixture
def principal(direct_owner):
    return direct_owner


@pytest.fixture
def agent(direct_alice):
    return direct_alice


@pytest.fixture
def recipient(direct_bob):
    return direct_bob


@pytest.fixture
def outsider(direct_charlie):
    return direct_charlie


# ---------------------------------------------------------------------------
# Scenario helpers
# ---------------------------------------------------------------------------

FAR_EXPIRY = 2_000_000_000  # 2033


def recipients(*pairs) -> str:
    """[(address, label), ...] -> the JSON string the contract expects."""
    return json.dumps([
        {"address": hex_of(address), "label": label}
        for address, label in pairs
    ])


def make_mandate(vm, contract, principal, agent, recipient,
                 *, label="GPU and compute hosting provider",
                 text="Purchase cloud infrastructure for Project Atlas.",
                 budget=100, cap=30, max_actions=4, expires=FAR_EXPIRY):
    vm.sender = principal
    contract.create_mandate(
        hex_of(agent), text, recipients((recipient, label)),
        budget, cap, max_actions, expires,
    )
    return 1


def fund(vm, contract, principal, mandate_id, amount):
    vm.sender = principal
    vm.value = amount
    try:
        contract.fund_mandate(mandate_id)
    finally:
        vm.value = 0


def mandate_state(contract, mandate_id=1) -> dict:
    return json.loads(contract.get_mandate(mandate_id))


def request_state(contract, mandate_id=1, request_id=1) -> dict:
    """`get_request` wraps its payload as {"found": bool, "request": {...}}."""
    payload = json.loads(contract.get_request(mandate_id, request_id))
    assert payload["found"] is True
    return payload["request"]
