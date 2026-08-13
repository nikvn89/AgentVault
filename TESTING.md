# AgentVault — Testing Guide

This document records the end-to-end validation flow used against the deployed AgentVault contract.

## Deployment

```text
Network:
GenLayer StudioNet

Contract:
0xb3d76B5517a14A846e9FF8b73a48e582A034de25

Explorer:
https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25
```

## Test wallets

The final browser-wallet test used:

```text
Principal:
0x6276095faea15108740445ff277fda8c304657f4

Agent:
0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE

Trusted recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D
```

The Principal creates/funds/revokes/withdraws.  
The Agent can call `request_action`.  
The trusted recipient receives GEN only after an `AUTHORIZED` decision.

---

## Test 1 — Create mandate

Connect the **Principal** wallet.

Create:

```text
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
```

Expected:

```text
Status: ACTIVE
Budget: 10 GEN
Funded: 0 GEN
Spent: 0 GEN
Actions: 0 / 4
```

**Observed: PASS**

---

## Test 2 — Fund mandate

Remain connected as the **Principal**.

Fund:

```text
5 GEN
```

Expected:

```text
Budget:            10 GEN
Funded:             5 GEN
Spent:              0 GEN
Available funded:   5 GEN
Actions:             0 / 4
```

**Observed: PASS**

---

## Test 3 — AUTHORIZED semantic action

Switch to the **Agent** wallet:

```text
0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE
```

Submit:

```text
Recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

Amount:
0.5 GEN

Description:
Purchase GPU compute for Project Atlas deployment infrastructure.
```

Deterministic checks:

```text
Registered Agent:       PASS
Mandate ACTIVE:         PASS
Recipient allowlisted:  PASS
Recipient != Agent:     PASS
Amount > 0:             PASS
Amount <= 3 GEN cap:    PASS
Funded balance:         PASS
Action count:           PASS
```

Semantic expectation:

```text
Scope:               PASS
Purpose:             PASS
Recipient coherence: PASS
Decision:            AUTHORIZED
```

Expected accounting:

```text
Funded:             5 GEN
Spent:            0.5 GEN
Available funded: 4.5 GEN
Actions:          1 / 4
```

Expected settlement:

```text
0.5 GEN transferred to trusted recipient
```

**Observed: PASS**

---

## Test 4 — DENIED semantic action

Remain connected as the **Agent**.

Use the same allowlisted recipient and a valid amount so the deterministic layer passes.

Submit:

```text
Recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D

Amount:
0.5 GEN

Description:
Purchase personal gaming equipment for the agent's private use,
unrelated to Project Atlas.
```

Observed consensus output:

```json
{
  "decision": "DENIED",
  "failed_check": 1,
  "reason": "The request to buy personal gaming equipment is outside the mandate to purchase cloud infrastructure and GPU compute for Project Atlas."
}
```

Expected accounting:

```text
Funded:             5 GEN
Spent:            0.5 GEN
Available funded: 4.5 GEN
Actions:          2 / 4
```

Important property:

```text
DENIED consumes one resolved action slot.
DENIED transfers no GEN.
```

**Observed: PASS**

---

## Test 5 — Fund isolation

A separate mandate with no allocated funding was used to attempt spending while the AgentVault contract held GEN for another mandate.

Expected revert:

```text
Mandate has insufficient funded balance
```

This proves authorization uses:

```text
funded - spent
```

for the selected mandate rather than the global contract balance.

**Observed: PASS**

---

## Test 6 — Revoke

Switch back to the **Principal** wallet.

Call:

```text
revoke_mandate(mandate_id)
```

Expected:

```text
Status: REVOKED
```

Further Agent spending must no longer be authorized because the deterministic active-state check fails.

**Observed: PASS**

---

## Test 7 — Withdraw unused GEN

After revocation, call:

```text
withdraw_unused(mandate_id)
```

Before withdrawal:

```text
Funded:             5 GEN
Spent:            0.5 GEN
Unused:           4.5 GEN
```

Expected:

```text
4.5 GEN returned to Principal
```

Expected final accounting:

```text
Status:             REVOKED
Funded:              0.5 GEN
Spent:               0.5 GEN
Available funded:      0 GEN
Actions:             2 / 4
```

`funded` is intentionally reduced to `spent` after unused funds are withdrawn.

**Observed: PASS**

---

## Test 8 — Frontend role switching

Expected wallet roles:

```text
Principal wallet -> PRINCIPAL
Agent wallet     -> AGENT
Recipient wallet -> OBSERVER
```

**Observed: PASS**

---

## Test 9 — StudioNet RPC resilience

StudioNet occasionally returned transient:

```text
Failed to fetch
```

The frontend was updated so that:

- reads retry with backoff;
- mandate reads are sequential instead of burst-loaded;
- a partial registry read is not presented as complete state;
- once `writeContract` returns a transaction hash, the write is never resubmitted automatically;
- uncertain receipt monitoring tells the user to check Explorer before retrying;
- successful informational toasts auto-dismiss after approximately six seconds.

The contract state remained authoritative and recovered correctly on refresh.

**Observed: PASS**

---

## Expected invariant

For all mandates:

```text
sum(funded_i - spent_i) == AgentVault contract balance
```

Relevant balance-changing paths:

```text
fund_mandate:
funded += value
contract balance += value

AUTHORIZED request_action:
spent += amount
contract balance -= amount

withdraw_unused:
funded = spent
contract balance -= unused
```

A mandate can never spend another mandate's funded balance.

---

## Final result

```text
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
```

The deployed AgentVault contract and frontend completed the full intended workflow on GenLayer StudioNet.
