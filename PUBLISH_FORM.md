# AgentVault — Publish Copy

## One-liner

Give an AI agent a spending mandate in plain English, and let GenLayer validators decide whether each payment actually fits it.

## Description

A principal writes a spending mandate in plain English, names the agent wallet, lists the allowed recipients with a label for each, and sets a total budget, a per-action cap, a maximum number of actions and an expiry. The principal funds the mandate with their own GEN.

When the agent proposes a payment, the contract runs every deterministic check first - agent identity, recipient allowlist, per-action cap, remaining budget, action count, expiry. Only then do GenLayer validators answer one question: does this described action fall within the mandate the principal wrote?

AUTHORIZED transfers native GEN in the same transaction. DENIED transfers nothing but still consumes an action slot, so a rejected request cannot simply be reworded and retried. The model never chooses an amount; every amount comes from the mandate's own deterministic arithmetic. The principal can revoke and withdraw whatever is unspent.

## How to try it

1. You need a little StudioNet GEN. Connect MetaMask at https://agent-vault-lake.vercel.app/ and switch to GenLayer StudioNet when prompted.
2. Create your own mandate. Use your own wallet as the principal and any second address you control as the agent. Write a purpose in plain English, add one allowed recipient and label it, and set a small budget, per-action cap and action limit.
3. Fund the mandate with a small amount of your own GEN.
4. Switch to the agent wallet and request an action that fits the mandate. Expect AUTHORIZED and a native GEN transfer.
5. Request a second action whose stated purpose is outside the mandate. Expect DENIED, no transfer, and the action counter still increasing.
6. Switch back to the principal wallet and use Withdraw unused to recover the GEN you did not spend.

## Expected verification outcome

Two requests to the same agent and the same recipient, differing only in the stated purpose, resolve to different verdicts: AUTHORIZED moves native GEN to the recipient, DENIED moves nothing. Both consume an action slot. Mandate state shows spent, remaining and actions used, and Withdraw unused returns the unspent balance to the principal. Every amount is set by the mandate, never by the model.

## Suggested category

AI agents / autonomous agent controls

## Suggested focus tags

- natural-language authorization
- onchain spending limits
