# Changelog

## 1.1.0 — Verified, not asserted

`contracts/AgentVault.py` is **unchanged**. The deployed contract at
`0xb3d76B5517a14A846e9FF8b73a48e582A034de25` is still the file in this
repository, and no redeploy is part of this release. Everything below is
evidence, frontend, and documentation.

### A test suite that has teeth

61 tests run `contracts/AgentVault.py` inside a real GenVM build through
`genlayer-test` Direct Mode. Nothing is stubbed and no contract logic is
re-implemented in the tests, so the suite cannot drift away from the deployed
file. The GenVM version is pinned so a laptop and a CI runner execute the same
runtime.

A passing suite proves nothing on its own, so `tests/mutation_check.py` makes 22
single edits to the contract — each a plausible mistake that breaks a property
the suite claims to defend — and runs the whole suite against each one.
**22 of 22 are killed.**

Four survived the first run and are documented rather than quietly fixed,
because they show what a green suite can hide:

- **M09** — with the agent check deleted, the request carried on to the model,
  found no armed answer, and raised there. The test expected *any* exception, so
  it passed while the gate was gone. It now arms an answer first and matches the
  gate's own message.
- **M06** — with the budget check deleted, a budget of zero was still refused by
  `per_action_cap > total_budget`. Three cases sharing one `raises(Exception)`
  are now three parametrized cases, each matching its own message.
- **M22** — every malformed timestamp in the list had a second defect the
  numeric checks caught, so the length guard was never the thing holding. A
  truncated-but-parsable stamp now exercises it alone.
- **M17** — the request-time agent-pays-itself check is unreachable through the
  public surface, because creation already refuses such a mandate. It is still
  the guard that answers *first*, and the new test matches its message rather
  than accepting the allowlist error that replaces it.

### Frontend

- **Removed both `client.connect('studionet')` calls.** That SDK helper installs
  the GenLayer MetaMask Snap as well as switching the network — reading
  genlayer-js 1.1.8 makes it explicit: `wallet_getSnaps`, then
  `wallet_requestSnaps`. Signing never needs that Snap; writes go out through
  `eth_sendTransaction` on the injected provider. A reviewer without the Snap,
  or one who declined the prompt, was blocked from every write in the app for no
  functional reason. `src/lib/chain.ts` now does the network half only.
- **The network switch is now explicit, and that is a correctness fix.**
  `assertChainMatch` in genlayer-js 1.1.8 opens with
  `if (chainConfig.isStudio) return;`, and `studionet.isStudio` is `true` — so
  the SDK does not verify the wallet's network before `eth_sendTransaction` on
  StudioNet. A wallet left on another chain would have been asked to sign
  against it.
- **Same-origin RPC.** `vite.config.ts` (development) and `vercel.json`
  (production) proxy `/api/rpc` to Studio. Studio answers a rate-limited request
  without CORS headers, so the direct cross-origin call surfaced in the browser
  as an opaque `Failed to fetch` instead of the 429 it actually was.
- **Every form field now starts empty.** The create-mandate form shipped with a
  budget, a cap, an action limit, an expiry, a recipient label and — worst of
  the set — a pre-written mandate already filled in. That reads as a demo rather
  than a tool, and the mandate is the one field that must never be pre-written:
  it is the principal's own statement of what the agent may buy, and a default
  invites accepting text nobody chose. Guidance moved to placeholders, which are
  not values and are never submitted. `createMandate`, `fundMandate` and
  `requestAction` already reject every empty field before a transaction is
  built, so an empty form costs no gas.
- **The post-write state reload can no longer be skipped.** `refreshAll` bailed
  out whenever another read was already in flight — including the reload that
  runs after a write. When that happened the UI announced
  `confirmed on-chain` over state read *before* the transaction. A post-write
  reload now waits for the in-flight read and then does its own. (The manual
  refresh button still drops out, which is correct: state is being reloaded
  anyway.)

### Documentation

- `SECURITY.md` — the two-layer separation, what the contract enforces, what the
  prompt fences do and what they do not buy, and five limitations accepted by
  design, including the one that matters most: only `decision` is
  consensus-bound, so a dishonest leader can force a denial but cannot
  manufacture an authorization.
- `tests/README.md` — what Direct Mode actually runs, what comes from the
  harness instead of GenVM, and the mutation results including the four
  survivors.
- `.env.example` — `VITE_STUDIO_RPC` is now documented as *leave unset*. Setting
  it to an absolute URL restores the cross-origin call the proxy exists to
  avoid.
- `.github/workflows/ci.yml` — the suite and the linter on every push.

### Removed

`PRE_PUBLISH_PATCH_NOTES.md`, `PUBLISH_FORM.md` and `DEPLOYMENT.txt` were
internal working notes. The contract address they carried is in `README.md` and
`SECURITY.md`; nothing else in them was public-facing.

## 1.0.0

Initial StudioNet deployment: consensus-gated spending mandates, the React
frontend, and `TESTING.md`.
