AgentVault — Testing Guide

Post-Steward Fix Verification Status

The deployed contract remains unchanged:

Network:
GenLayer StudioNet

Contract:
0xb3d76B5517a14A846e9FF8b73a48e582A034de25

Explorer:
https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25

Live:
https://agent-vault-lake.vercel.app/

The steward-fix patch changes frontend request-history visibility, displayed error messages, numeric-input UX, dependency pinning, and documentation only. It does not change the deployed spending logic and does not require contract redeployment.

The historical test results below are preserved because they were actually executed against the deployed contract before this frontend patch. They must not be interpreted as post-fix verification of the newly added UI/error-handling behavior.

DENIED request history UI       RE-VERIFY REQUIRED
AUTHORIZED request history UI   RE-VERIFY REQUIRED
MetaMask reject message         RE-VERIFY REQUIRED
Reload/history persistence      RE-VERIFY REQUIRED
Numeric field validation        RE-VERIFY REQUIRED
npm run build                   RE-VERIFY REQUIRED
Vercel production smoke test    RE-VERIFY REQUIRED

This document records the end-to-end validation flow used against the deployed AgentVault contract.

Deployment

Network:
GenLayer StudioNet

Contract:
0xb3d76B5517a14A846e9FF8b73a48e582A034de25

Explorer:
https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25

Test wallets

The final browser-wallet test used:

Principal:
0x6276095faea15108740445ff277fda8c304657f4

Agent:
0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE

Trusted recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

The Principal creates/funds/revokes/withdraws.
The Agent can call request_action.
The trusted recipient receives GEN only after an AUTHORIZED decision.

Test 1 — Create mandate

Connect the Principal wallet.

Create:

Agent:
0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE

Mandate:
Purchase cloud infrastructure and GPU compute required
to deploy and operate Project Atlas.

Trusted recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

Recipient label:
GPU and compute hosting provider

Total budget:
10 GEN

Per-action cap:
3 GEN

Max actions:
4

Expiry:
7 days

Expected:

Status: ACTIVE
Budget: 10 GEN
Funded: 0 GEN
Spent: 0 GEN
Actions: 0 / 4

Observed: PASS

Test 2 — Fund mandate

Remain connected as the Principal.

Fund:

5 GEN

Expected:

Budget:            10 GEN
Funded:             5 GEN
Spent:              0 GEN
Available funded:   5 GEN
Actions:             0 / 4

Observed: PASS

Test 3 — AUTHORIZED semantic action

Switch to the Agent wallet:

0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE

Submit:

Recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

Amount:
0.5 GEN

Description:
Purchase GPU compute for Project Atlas deployment infrastructure.

Deterministic checks:

Registered Agent:       PASS
Mandate ACTIVE:         PASS
Recipient allowlisted:  PASS
Recipient != Agent:     PASS
Amount > 0:             PASS
Amount <= 3 GEN cap:    PASS
Funded balance:         PASS
Action count:           PASS

Semantic expectation:

Scope:               PASS
Purpose:             PASS
Recipient coherence: PASS
Decision:            AUTHORIZED

Expected accounting:

Funded:             5 GEN
Spent:            0.5 GEN
Available funded: 4.5 GEN
Actions:          1 / 4

Expected settlement:

0.5 GEN transferred to trusted recipient

Observed: PASS

Test 4 — DENIED semantic action

Remain connected as the Agent.

Use the same allowlisted recipient and a valid amount so the deterministic layer passes.

Submit:

Recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

Amount:
0.5 GEN

Description:
Purchase personal gaming equipment for the agent's private use,
unrelated to Project Atlas.

Observed consensus output:

{
  "decision": "DENIED",
  "failed_check": 1,
  "reason": "The request to buy personal gaming equipment is outside the mandate to purchase cloud infrastructure and GPU compute for Project Atlas."
}

Expected accounting:

Funded:             5 GEN
Spent:            0.5 GEN
Available funded: 4.5 GEN
Actions:          2 / 4

Important property:

DENIED consumes one resolved action slot.
DENIED transfers no GEN.

Observed: PASS

Test 5 — Fund isolation

A separate mandate with no allocated funding was used to attempt spending while the AgentVault contract held GEN for another mandate.

Expected revert:

Mandate has insufficient funded balance

This proves authorization uses:

funded - spent

for the selected mandate rather than the global contract balance.

Observed: PASS

Test 6 — Revoke

Switch back to the Principal wallet.

Call:

revoke_mandate(mandate_id)

Expected:

Status: REVOKED

Further Agent spending must no longer be authorized because the deterministic active-state check fails.

Observed: PASS

Test 7 — Withdraw unused GEN

After revocation, call:

withdraw_unused(mandate_id)

Before withdrawal:

Funded:             5 GEN
Spent:            0.5 GEN
Unused:           4.5 GEN

Expected:

4.5 GEN returned to Principal

Expected final accounting:

Status:             REVOKED
Funded:              0.5 GEN
Spent:               0.5 GEN
Available funded:      0 GEN
Actions:             2 / 4

funded is intentionally reduced to spent after unused funds are withdrawn.

Observed: PASS

Test 8 — Frontend role switching

Expected wallet roles:

Principal wallet -> PRINCIPAL
Agent wallet     -> AGENT
Recipient wallet -> OBSERVER

Observed: PASS

Test 9 — StudioNet RPC resilience

StudioNet occasionally returned transient:

Failed to fetch

The frontend was updated so that:

reads retry with backoff;

mandate reads are sequential instead of burst-loaded;

a partial registry read is not presented as complete state;

once writeContract returns a transaction hash, the write is never resubmitted automatically;

uncertain receipt monitoring tells the user to check Explorer before retrying;

successful informational toasts auto-dismiss after approximately six seconds.

The contract state remained authoritative and recovered correctly on refresh.

Observed: PASS

Expected invariant

For all mandates:

sum(funded_i - spent_i) == AgentVault contract balance

Relevant balance-changing paths:

fund_mandate:
funded += value
contract balance += value

AUTHORIZED request_action:
spent += amount
contract balance -= amount

withdraw_unused:
funded = spent
contract balance -= unused

A mandate can never spend another mandate's funded balance.

Final result

Create mandate       PASS
Fund mandate         PASS
Authorized consensus PASS
Native GEN transfer  PASS
Denied consensus     PASS
No payout on DENIED  PASS
Fund isolation       PASS
Revoke               PASS
Withdraw unused      PASS
Role switching       PASS
RPC recovery         PASS

The deployed AgentVault contract and frontend completed the full intended workflow on GenLayer StudioNet.

Post-Steward Fix Regression Tests

These tests apply specifically to the steward-requested frontend/UI/error-handling changes.

Do not change a status to PASS until the case has actually been executed after the patch.

Regression A — DENIED request history

Status:

NOT YET RE-VERIFIED

Use an ACTIVE, funded mandate and connect the registered Agent.

Input:

Amount:
0.5 GEN

Description:
Purchase personal gaming equipment for the agent's private use,
unrelated to Project Atlas.

Expected contract result:

decision = DENIED
status = DENIED
spent does not increase
recipient receives no GEN
actions_used increases by 1

Expected frontend request-history row:

DENIED badge
status = DENIED
amount = 0.5 GEN
recipient label visible
description visible
reason visible
failed_check visible

For the known Project Atlas negative case, the expected advisory failed-check label is:

1 · Scope

The UI must read this history from:

get_mandate_requests(selected_mandate_id)

It must not infer the decision or explanation locally.

Regression B — AUTHORIZED request history

Status:

NOT YET RE-VERIFIED

Connect the registered Agent.

Input:

Amount:
0.5 GEN

Description:
Purchase GPU compute for Project Atlas deployment infrastructure.

Expected contract result:

decision = AUTHORIZED
status = EXECUTED
spent increases by 0.5 GEN
available funded decreases by 0.5 GEN
actions_used increases by 1
trusted recipient receives 0.5 GEN

Expected frontend request-history row:

AUTHORIZED badge
status = EXECUTED
amount = 0.5 GEN
recipient label visible
description visible
reason visible

decision is consensus-bound. reason and failed_check are advisory leader-provided metadata shown for transparency only.

Regression C — Friendly MetaMask rejection

Status:

NOT YET RE-VERIFIED

Start any write action and choose Reject in MetaMask.

Expected frontend message:

Transaction cancelled in MetaMask.

The UI must not display a raw JSON-RPC payload, long provider error object, or stack trace.

No transaction should be submitted.

Regression D — Reload selected mandate history

Status:

NOT YET RE-VERIFIED

After Regression A and B:

1. Refresh the browser / F5.
2. Reconnect the wallet if required.
3. Select the same mandate.

Expected:

Previously stored AUTHORIZED request remains visible
Previously stored DENIED request remains visible
reason remains visible
failed_check remains visible for DENIED
history is read from on-chain state

RPC behavior must remain:

selected mandate read
→ selected mandate request-history read

Do not introduce:

setInterval polling
all-mandate request-history bursts
automatic write resubmission

Regression E — Numeric input and inline validation

Status:

NOT YET RE-VERIFIED

Verify numeric behavior for:

Total budget
Per-action cap
Max actions
Expiry days
Fund amount
Action amount

Expected:

numeric mobile keyboard behavior through type="number" / inputMode;

invalid values show an error beside the relevant field;

one invalid numeric field does not force the user to guess which input is wrong.

Examples:

Budget:
invalid / empty

Expected inline message:

Enter a valid GEN amount.

Example:

Budget:
10

Per-action cap:
20

Expected inline message:

Cap cannot exceed the total budget.

Regression F — Dependency pinning and production build

Status:

NOT YET RE-VERIFIED

Run:

npm install
npm run build

Expected:

npm install succeeds
package-lock.json is updated for the pinned dependency versions
TypeScript compile succeeds
Vite production build succeeds
dist/ is generated

Only after observing this should the build result be changed to:

PASS

Vercel Production Regression

Run after the local regression checks are satisfactory.

Status:

NOT YET RE-VERIFIED

Consistency

Frontend must resolve to:

0xb3d76B5517a14A846e9FF8b73a48e582A034de25

If VITE_CONTRACT_ADDRESS exists in Vercel Environment Variables, it must equal that address.

If no environment override exists, the fallback in src/lib/config.ts must equal that address.

GitHub source, Vercel deployment, README, TESTING, DEPLOYMENT.txt, and Explorer link must all reference the same deployed AgentVault contract.

Production smoke test

Open:

https://agent-vault-lake.vercel.app/

Expected:

Connect wallet succeeds
Existing mandate loads
Request history loads for the selected mandate
AUTHORIZED / DENIED decision badges render
reason renders
failed_check renders for DENIED

Then run one controlled write.

Expected:

transaction is submitted once
consensus completes
state refresh succeeds
new request appears in the selected mandate history

Do not repeat the full historical test suite on production unless something appears inconsistent.

Advisory Metadata Disclosure

AgentVault stores:

decision
failed_check
reason

Security semantics:

decision
→ validator-consensus-bound
→ consequential
→ gates AUTHORIZED vs DENIED
→ gates native GEN transfer

failed_check
reason
→ leader-provided advisory metadata
→ stored on-chain for explanation / UX
→ not independently validator-consensus-bound
→ must not be used as authorization inputs

The Request History UI displays failed_check and reason for transparency only.

Final Resubmission Checklist

Before resubmission:

[ ] DENIED history regression actually run
[ ] AUTHORIZED history regression actually run
[ ] MetaMask rejection regression actually run
[ ] Reload/history persistence actually run
[ ] Numeric input validation checked
[ ] npm install PASS
[ ] npm run build PASS
[ ] package.json contains pinned versions
[ ] updated package-lock.json committed
[ ] GitHub contains updated frontend source
[ ] GitHub contains updated README.md
[ ] GitHub contains updated TESTING.md
[ ] AgentVault.py runtime logic remains unchanged
[ ] Vercel redeployed from the updated GitHub source
[ ] Vercel contract address matches deployed AgentVault
[ ] Vercel production smoke test PASS

Only mark new regression cases as PASS after actually observing the expected result.
