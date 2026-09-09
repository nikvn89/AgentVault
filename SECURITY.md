# Security model and known limitations

AgentVault moves native GEN on the strength of a verdict produced by AI
validators. This document states what the contract actually guarantees, what it
does not, and which weaknesses are known and open. It is written for a reviewer
who wants to check the claims rather than take them.

The deterministic half of every claim below is covered by
[`tests/`](tests/README.md) — 61 tests that run the deployed contract on a real
GenVM build, and a mutation matrix that confirms they fail when the property
they defend is broken.

Deployed contract:
`0xb3d76B5517a14A846e9FF8b73a48e582A034de25`
([explorer](https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25))

---

## 1. The separation the design rests on

| Layer | Decides | Trusted to |
|---|---|---|
| **Contract, before the model** | who may spend, how much, how often, to whom, until when | nothing but its own state. Every one of these is settled before a prompt is built |
| **GenLayer validators** | whether the *described purpose* falls inside the mandate the principal wrote | read the mandate, the recipient's role and the request as data, and return one verdict |
| **Contract, after the model** | whether GEN moves, and how much | pure arithmetic on the mandate. The amount was fixed by the agent's own request and bounded by the cap and the funded balance before consensus ran |

What that separation buys: **the model never chooses an amount, never chooses a
recipient, and never extends a budget.** It answers one scoping question, and
the contract does everything consequential around it.

## 2. What the contract enforces

Each item is covered by a named test.

- The agent cannot be the principal, and cannot be listed as a recipient of its
  own mandate. `request_action` carries the recipient check a second time, and
  that copy is the one that answers first.
- Only the registered agent may request; only the principal may fund, revoke or
  withdraw.
- A recipient not on the mandate's allowlist is refused before consensus, so a
  request to an unknown address never reaches — or pays for — a model call.
- Amount must be positive, within the per-action cap, within the remaining
  budget, and within the **funded** balance. A mandate can never spend another
  mandate's funds.
- A revoked or expired mandate accepts nothing. Expiry is derived from the
  chain clock at read time, not from a stored flag.
- Funding cannot exceed the mandate budget; a per-action cap cannot exceed the
  total budget; a zero or negative budget, cap or action limit is refused.
- Registry limits hold: 10 active mandates per principal, 50 in the registry, 20
  recipients per mandate, 50 actions per mandate, and length caps of 2000 / 200
  / 600 characters on mandate text, recipient label and description.
- A **DENIED** request still consumes an action slot. This is deliberate — see
  §4.
- State is written **before** `emit_transfer`, in both `request_action` and
  `withdraw_unused`. There is no window in which a transfer is out and the
  accounting is not yet updated.
- The clock is `gl.message_raw["datetime"]`, converted by pure arithmetic. No
  `time.time()`, no `datetime.now()`, no host library. A malformed stamp fails
  closed rather than defaulting.

## 3. Prompt injection — what is done, and what is left

The agent writes the request description. That text reaches a model, so it is
the injection surface.

What the contract does about it:

- All three interpolated fields — mandate text, recipient label, description —
  pass through `_fence_strip`, which removes every fence tag
  (`<UNTRUSTED_REQUEST>`, `<PRINCIPAL_MANDATE>`, `<TRUSTED_RECIPIENT>` and their
  closers) before interpolation. An agent cannot close the untrusted section
  early and continue as if it were the principal.
- The prompt names the untrusted section explicitly and instructs the model
  never to follow instructions inside it.
- Ambiguity resolves to `DENIED`, stated three times in the prompt.
- The verdict is a small fixed shape. A malformed or non-dict answer becomes
  `DENIED`, not an authorization.

**What that does not buy.** Validators run the same shape of prompt over the
same text as the leader, so a description crafted to steer the model can steer
both — a deterministic re-run is not an injection defence. The real bound is
structural: even a fully successful injection can only produce `AUTHORIZED` for
a recipient the principal allowlisted, at an amount the agent already had the
authority to spend, within a cap, a remaining budget, a funded balance and an
action count the model never sees and cannot change. The blast radius of a
successful injection is exactly the blast radius of an honest mistake by the
agent.

## 4. Known limitations — accepted by design

- **Only `decision` is consensus-bound.** `validator_fn` compares the leader's
  `decision` against its own and nothing else; `failed_check` and `reason` come
  from the leader alone and are stored as displayed metadata. The contract
  requires `decision == "AUTHORIZED"` **and** `failed_check == 0` **and** a
  non-empty `reason` before any GEN moves. So a dishonest leader can force a
  *denial* that the validators would not have agreed to — by returning
  `AUTHORIZED` with a non-zero `failed_check` — but cannot manufacture an
  authorization the validators disagree with. The failure direction is closed;
  the cost of a dishonest leader is a burned action slot, not a payment.
- **A DENIED request consumes an action slot.** Without that, an agent could
  re-describe the same spend indefinitely until a verdict came back favourable.
  The action counter is what bounds those attempts, so it has to advance on
  refusal too. The cost is real: a genuinely misworded request costs the
  principal a slot.
- **Semantic judgment is judgment, and it does not always settle.**
  `request_action` runs `gl.vm.run_nondet_unsafe`, and the validator re-runs the
  evaluation independently. When the leader's verdict and the validator's
  disagree there is no consensus and the **entire transaction reverts**,
  recording nothing and consuming nothing. That is the design failing closed,
  but it means a reviewer may need to resubmit, and each attempt is a fresh
  independent judgment rather than a retry of the same one.
- **Mandate terms are immutable.** There is no public method that changes the
  agent, the recipient set, the budget, the cap, the action limit or the
  expiry after creation. Different terms mean a new mandate. This is why the
  request-time agent-pays-itself check cannot be reached through the public
  surface, and why it is documented as defence in depth rather than claimed as
  an active guard.
- **The contract judges words, not the world.** An `AUTHORIZED` verdict means
  the submitted *description* was accepted as fitting the recorded mandate. It
  does not verify who controls the agent wallet, who the recipient really is,
  or that anything was delivered. Funds are not tracked after they leave.
- **StudioNet deployment.** GEN here is test currency and the RPC is
  rate-limited. Nothing in this repository should be read as an audit.

## 5. Frontend

`src/` has no automated tests; the checks in [`TESTING.md`](TESTING.md) were run
by hand against the deployed contract. Two frontend behaviours are worth naming
because they are security-adjacent:

- The app never calls `client.connect('studionet')`. That SDK helper installs
  the GenLayer MetaMask Snap as well as switching the network, and a declined
  install used to block every write. `src/lib/chain.ts` does the network half
  only, through `wallet_switchEthereumChain` / `wallet_addEthereumChain`. This
  is also a correctness fix, not only a convenience one: `assertChainMatch` in
  genlayer-js 1.1.8 opens with `if (chainConfig.isStudio) return;`, so the SDK
  does **not** verify the wallet's network before `eth_sendTransaction` on
  StudioNet. Without an explicit switch a wallet left on another chain would be
  asked to sign against it.
- The UI reloads on-chain state before it says a transaction is confirmed, and
  a post-write reload waits for any in-flight read instead of dropping out.
  Saying "confirmed on-chain" over state read before the transaction is the
  kind of false statement that is worse than no statement at all.

## 6. Reporting

Open an issue on this repository. There is no bug bounty and no funds at risk:
this is a StudioNet deployment.
