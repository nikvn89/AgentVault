# AgentVault

**Consensus-gated spending mandates for autonomous agents on GenLayer.**

AgentVault is a multi-tenant GenLayer dApp that lets a human principal delegate a limited native-GEN spending authority to an autonomous agent.

Instead of giving an agent unrestricted control of funds, the principal defines a natural-language mandate, trusted recipients, a total budget, a per-action cap, an action limit, and an expiry. Every proposed spend must first pass deterministic contract checks and then GenLayer AI-validator consensus before funds can move.

## Live Contract

- Network: **GenLayer StudioNet**
- Contract: `0xb3d76B5517a14A846e9FF8b73a48e582A034de25`
- Explorer: `https://explorer-studio.genlayer.com/address/0xb3d76B5517a14A846e9FF8b73a48e582A034de25`
- Contract source: `contracts/AgentVault.py`

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

Validator equivalence binds on the normalized `decision`.

## Why GenLayer

The core authorization decision is subjective and language-dependent.

A deterministic smart contract can enforce:

```text
amount <= per_action_cap
recipient in allowlist
now < expires_at
actions_used < max_actions
amount <= funded - spent
```

But it cannot safely determine:

```text
"Does this purchase actually serve the delegated purpose?"
```

That semantic authorization boundary is where GenLayer consensus is required.

## Atomic execution model

`request_action()` resolves in one transaction.

```text
Agent request
   |
   +--> deterministic checks fail
   |       -> transaction reverts
   |
   +--> semantic consensus = DENIED
   |       -> request stored as DENIED
   |       -> actions_used += 1
   |       -> no GEN transferred
   |
   +--> semantic consensus = AUTHORIZED
           -> request stored as EXECUTED
           -> actions_used += 1
           -> spent += amount
           -> native GEN transferred
```

There is no persistent `PENDING` or intermediate authorization state.

## Multi-tenant architecture

One `AgentVaultContract` serves multiple Principals and Agents.

Persistent registry state:

```text
mandates_json
requests_json
principal_mandates_json
agent_mandates_json
```

Current contract limits:

```text
Max active mandates per Principal: 10
Max mandates in registry:          50
Max recipients per mandate:        20
Max actions per mandate:           50
Mandate text:                    2000 chars
Recipient label:                  200 chars
Action description:               600 chars
```

Per-mandate isolation is enforced using:

```text
available_funded = funded - spent
```

An action cannot use the global contract balance as authority to consume funds belonging to another mandate.

## Core contract methods

### Writes

```text
create_mandate(...)
fund_mandate(mandate_id)
request_action(mandate_id, recipient, amount, description)
revoke_mandate(mandate_id)
withdraw_unused(mandate_id)
```

### Views

```text
get_mandate(mandate_id)
get_request(mandate_id, request_id)
get_mandate_requests(mandate_id)
get_principal_mandates(principal)
get_agent_mandates(agent)
get_mandate_count()
get_registry_limits()
get_chain_time()
```

## Frontend

The React/Vite frontend supports the full workflow:

```text
Principal
  -> Create Mandate
  -> Fund Mandate

Agent
  -> Request Action
  -> GenLayer consensus

AUTHORIZED
  -> GEN sent to trusted recipient

DENIED
  -> no payout

Principal
  -> Revoke
  -> Withdraw unused GEN
```

The UI also displays:

- connected wallet and current role;
- recent mandates;
- budget, funded, spent, and available funded GEN;
- action usage;
- trusted recipients;
- mandate status;
- Explorer transaction links;
- resilient StudioNet RPC state refresh.

## Verified end-to-end test

The deployed contract and frontend were tested with three browser-wallet accounts.

```text
Principal:
0x6276095faea15108740445ff277fda8c304657f4

Agent:
0x037f58E33c1Ec8fdA272361E0aAC1e31054a1CDE

Trusted recipient:
0xb363A98c6DCD93A87178038f5F10172A7c741c7D
```

Test mandate:

```text
Purchase cloud infrastructure and GPU compute required
to deploy and operate Project Atlas.
```

Configuration:

```text
Budget:         10 GEN
Funded:          5 GEN
Per-action cap:  3 GEN
Max actions:     4
```

### AUTHORIZED path

Agent requested:

```text
Recipient: trusted GPU/compute provider
Amount:    0.5 GEN
Purpose:   Purchase GPU compute for Project Atlas deployment infrastructure.
```

Result:

```text
AUTHORIZED
Spent:             0.5 GEN
Available funded:  4.5 GEN
Actions used:      1 / 4
```

The trusted recipient received the native GEN payout.

### DENIED path

Agent then requested:

```text
Amount: 0.5 GEN
Purpose:
Purchase personal gaming equipment for the agent's private use,
unrelated to Project Atlas.
```

Consensus result:

```text
DENIED
failed_check: 1
Reason:
The request to buy personal gaming equipment is outside the mandate
to purchase cloud infrastructure and GPU compute for Project Atlas.
```

Accounting remained:

```text
Spent:             0.5 GEN
Available funded:  4.5 GEN
Actions used:      2 / 4
```

The denied request consumed one resolved action slot but transferred no GEN.

### Revoke and withdrawal

The Principal revoked the mandate and withdrew the remaining unused balance.

Final state:

```text
Status:             REVOKED
Funded:              0.5 GEN
Spent:               0.5 GEN
Available funded:      0 GEN
Actions used:        2 / 4
```

The unused `4.5 GEN` was returned to the Principal.

See [`TESTING.md`](./TESTING.md) for the reproducible test sequence.

## Project structure

```text
AgentVault/
├── contracts/
│   └── AgentVault.py
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── styles.css
│   ├── vite-env.d.ts
│   └── lib/
│       ├── config.ts
│       └── genlayer.ts
├── README.md
├── TESTING.md
├── DEPLOYMENT.txt
├── package.json
├── tsconfig.json
└── index.html
```

## Run locally

Requirements:

- Node.js
- npm
- MetaMask or compatible browser wallet

Install:

```bash
npm install
```

Run:

```bash
npm run dev
```

Open the Vite local URL shown in the terminal.

## Build for production

```bash
npm run build
```

The app is ready for standard Vite deployment on Vercel.

## Vercel

Import the GitHub repository into Vercel.

Recommended settings:

```text
Framework Preset: Vite
Build Command:     npm run build
Output Directory:  dist
Install Command:   npm install
```

No contract redeployment is required. The frontend is configured to use the deployed StudioNet AgentVault contract.

## Security properties

- Agent cannot be Principal.
- Agent cannot pay itself.
- Recipient must be explicitly allowlisted by the Principal.
- Funding is isolated per mandate.
- Funding cannot exceed the mandate budget.
- Only the registered Agent can request actions.
- Only the Principal can fund, revoke, and withdraw.
- Denied actions transfer no GEN.
- Authorized settlement updates state before the native transfer.
- A revoked, expired, exhausted, or fully spent mandate cannot continue authorizing actions.
- Unused funds remain recoverable by the Principal after the mandate becomes inactive.
- Prompt fence stripping reduces instruction-injection risk from untrusted request text.
- Registry and per-Principal limits bound state growth for the hackathon deployment.

## Tech stack

- GenLayer Intelligent Contracts / GenVM
- Python
- GenLayerJS
- React
- TypeScript
- Vite
- viem
- MetaMask
- Vercel

## Status

**End-to-end tested on StudioNet.**

Verified:

```text
Create mandate     PASS
Fund mandate       PASS
AUTHORIZED action  PASS
Native GEN payout  PASS
DENIED action      PASS
Fund isolation     PASS
Revoke             PASS
Withdraw unused    PASS
Frontend roles     PASS
Frontend RPC retry PASS
```
