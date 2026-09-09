# Contract tests — real GenVM, not a stub

61 tests over `contracts/AgentVault.py`, plus a mutation matrix that checks the
tests actually fail when the contract is wrong.

```bash
pip install "genlayer-test==0.29.2" "pytest>=8,<9"
python3 -m pytest tests/ -q          # the suite             (~2s)
python3 tests/mutation_check.py      # 22 mutants, 22 killed (~2 min)
```

Python 3.12+ (3.11 cannot import the SDK). The first run downloads GenVM
`v0.2.12` to `~/.cache/gltest-direct/`; after that everything is local — no
network, no wallet, no StudioNet, no rate limit. The version is pinned in
`conftest.py` so a laptop and a CI runner execute the same runtime; left
unpinned, `gltest` resolves "latest" and a clean runner downloads a different
build from the one the suite was written against.

## What is actually being run

`genlayer-test`'s Direct Mode executes the contract inside a real GenVM build.
This is not a Python stand-in for the runtime and no contract logic is copied
into the tests: `contracts/AgentVault.py` is loaded as-is, so the suite cannot
drift away from the file that is deployed.

Two things come from the harness rather than from GenVM, and both are stated
rather than faked:

- **`mock_llm`** supplies the verdict. The suite never invents a consensus
  outcome. It states one, then tests what the contract does with it — and
  separately drives the contract's own `validator_fn` through `run_validator`,
  including the case where the validator's model answers differently from the
  leader's.
- **`chain_warp`** writes `gl.message_raw["datetime"]` directly. `direct_vm.warp()`
  moves the timestamp the VM reports but does **not** refresh that key in
  genlayer-test 0.29.2, and that key is the clock this contract reads. Without
  the helper no expiry path in the contract is reachable from a test.

One thing is **not** observable here and is not asserted: the native GEN
movement itself. The payout leaves through `emit_transfer` on a
`@gl.evm.contract_interface`, and Direct Mode's wasi mock does not capture the
outgoing message. Everything up to the transfer — the deterministic gates, the
budget arithmetic, `spent`, `actions_used`, the status transition — is checked
here; the transfer is evidenced on StudioNet in [`../TESTING.md`](../TESTING.md)
instead of being claimed here.

## Files

| File | Covers |
|---|---|
| `conftest.py` | loads the real contract; gives a test control of the clock, the sender and the model answer |
| `test_clock.py` | the consensus clock: 1212 dates fuzzed against `calendar.timegm`, leap-day and epoch boundaries, and every malformed-stamp path |
| `test_gates.py` | the deterministic gates that run **before** any model: who may spend, how much, how often, to whom, until when |
| `test_consensus.py` | what the contract does with a verdict — and what it refuses to let a verdict do |
| `test_lifecycle.py` | creation limits, funding, revocation, withdrawal, views |
| `mutation_check.py` | 22 mutants; a green suite that misses one is reported as a gap |

Every test in `test_gates.py` but one runs with **no model answer armed**. That
is deliberate: if one of those gates stopped working the request would reach
`exec_prompt` and fail there instead, which shows up as a failure rather than a
silent pass. The exception is the caller gate, where reaching `exec_prompt` is
exactly what a broken gate would do — see below.

## Mutation results

22 of 22 mutants killed. Each is a single edit to the contract that breaks a
property the suite claims to protect — the agent allowed to be the principal,
the recipient allowlist ignored, the per-action cap ignored, a refused request
no longer consuming an action slot, the clock treating every year as a leap
year, the validator agreeing with anything.

Four survived the first run, and they are worth naming because they show what a
green suite can hide.

- **M09** (anyone may act as the agent) survived because the test guarding it
  expected *any* exception. With the caller check removed the request simply
  carried on to the model, found no armed answer, and raised there — the test
  passed for entirely the wrong reason. It now arms an `AUTHORIZED` answer
  first and matches `"Registered agent only"`, which leaves nothing but the gate
  to stop the request.
- **M06** (a zero or negative budget is accepted) survived for a sibling
  reason: the single test looped over three bad parameter sets under one
  `raises(Exception)`, and a budget of zero, once the budget check was deleted,
  was still refused by `per_action_cap > total_budget`. The three cases are now
  parametrized and each matches its own message.
- **M22** (a malformed chain datetime is accepted) survived because every
  malformed stamp in the list had a *second* defect the numeric checks caught,
  so the length guard was never the thing holding. `test_a_truncated_timestamp_is_refused_on_length_alone`
  supplies `"2026-06-01T12:00:0"`, which parses field by field without
  complaint and is rejected on length alone.
- **M17** (the agent may pay itself at request time) survived because that guard
  is defence in depth — creation already refuses an agent-as-recipient mandate,
  so no allowlisted address can be the agent. It is still the guard that answers
  *first*: delete it and the request falls through to the allowlist check, which
  refuses the same call for an unrelated reason. The new test matches
  `"Agent cannot pay itself"`, which is the only thing that tells the two apart.

## What this suite does not cover

The frontend. `src/` has no automated tests; the checks recorded in
[`../TESTING.md`](../TESTING.md) were run by hand against the deployed contract.
