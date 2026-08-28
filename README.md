# AgentVault

**Consensus-gated spending mandates for autonomous agents on GenLayer.**

AgentVault is a multi-tenant GenLayer dApp that lets a human principal delegate a limited native-GEN spending authority to an autonomous agent.

Instead of giving an agent unrestricted control of funds, the principal defines a natural-language mandate, trusted recipients, a total budget, a per-action cap, an action limit, and an expiry. Every proposed spend must first pass deterministic contract checks and then GenLayer AI-validator consensus before funds can move.

## Live Contract

- Network: **GenLayer StudioNet**
- Contract: `0xb3d76B5517a14A846e9FF8b73a48e582A034de25`
- Explorer: `https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25`
- Contract source: `contracts/AgentVault.py`
- Live dApp: `https://agent-vault-lake.vercel.app/`

## Problem

Autonomous agents increasingly need to pay for infrastructure, APIs, services, data, and other resources.

Giving an agent unrestricted wallet access is unsafe. Traditional smart contracts can enforce numeric limits, allowlists, and expiry, but they cannot reliably answer a semantic question such as:

> Does this proposed purchase actually fall within the purpose the principal delegated?

For example, a contract can verify that a 0.5 GEN payment is below a 3 GEN cap, but deterministic code alone cannot decide whether buying personal gaming equipment is consistent with a mandate to purchase cloud infrastructure for Project Atlas.

## Solution

AgentVault combines two layers.

### Deterministic enforcement

The contract enforces:

- registered Principal and Agent roles;
- trusted-recipient allowlists;
- total mandate budget;
- actually funded balance per mandate;
- per-action spending cap;
- maximum action count;
- mandate expiry;
- revocation;
- isolated accounting between tenants;
- unused-fund withdrawal;
- state updates before native GEN transfers.

A mandate can never spend another mandate's funded balance.

### GenLayer consensus

For every valid `request_action`, GenLayer validators evaluate three semantic checks:

1. **Scope** — is the proposed action within the class of activity permitted by the mandate?
2. **Purpose** — does the stated purpose directly serve the objective defined by the mandate?
3. **Recipient coherence** — is the action consistent with the Principal-authored role of the selected recipient?

Ambiguity resolves to `DENIED`.

The consensus result is normalized to:

```json
{
  "decision": "AUTHORIZED | DENIED",
  "failed_check": 0,
  "reason": "short explanation"
}
```


## How to try it

**You need a little StudioNet GEN. You fund only your own mandate, and the Principal can recover any unspent balance with `withdraw_unused`.**

1. Connect MetaMask at `https://agent-vault-lake.vercel.app/` using GenLayer StudioNet.
2. Create your own mandate. Use your connected wallet as the Principal and a second address you control as the Agent. Write a narrow purpose in plain English, add one trusted recipient with a clear role label, then set a small total budget, per-action cap, maximum action count, and expiry.
3. Fund that mandate with a small amount of your own StudioNet GEN.
4. Switch to the Agent wallet and request a payment that clearly fits the mandate. Expect `AUTHORIZED`; if every deterministic check also passes, native GEN is transferred to the trusted recipient.
5. Submit another request whose stated purpose is clearly outside the mandate. Expect `DENIED`; no GEN is transferred, but the resolved request still consumes an action slot.
6. Switch back to the Principal wallet. Revoke when finished if desired, then use `withdraw_unused` to recover the GEN that remains unspent.

### Mandate immutability

The mandate text, Agent, trusted-recipient set, budget, per-action cap, action limit, and expiry are fixed when the mandate is created. If different terms are needed, create a new mandate. The Principal can revoke an existing mandate and withdraw its unused funded balance.

## Honest limitation

AgentVault evaluates one thing: whether a proposed spending action, **as described in words**, falls within the natural-language mandate that the Principal recorded onchain.

It does not verify who controls an Agent wallet in the real world, verify the real-world identity of a recipient, confirm that goods or services were actually delivered, or track funds after they leave the mandate.

Budget, per-action cap, action count, expiry, recipient allowlisting, funded balance, and transfer amount are deterministic contract rules. **The model never chooses the amount.** An `AUTHORIZED` result means only that the contract accepted the submitted description as fitting the recorded mandate after deterministic pre-checks.
