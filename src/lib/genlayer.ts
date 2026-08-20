import { createClient } from 'genlayer-js'
import { studionet } from 'genlayer-js/chains'
import { ExecutionResult, TransactionStatus } from 'genlayer-js/types'

import { STUDIO_RPC } from './config'

export type Address = `0x${string}`

export type ActionRequest = {
  id: number
  mandate_id: number
  agent: string
  recipient: string
  recipient_label: string
  amount: string | number
  description: string
  status: string
  decision: string
  failed_check: number
  reason: string
  resolved_at: string | number
  [key: string]: unknown
}

export type Mandate = {
  id: number
  principal: string
  agent: string
  mandate_text: string
  recipients?: Record<string, string> | Array<{ address: string; label: string }>
  total_budget: string | number
  funded: string | number
  spent: string | number
  per_action_cap: string | number
  max_actions: string | number
  actions_used: string | number
  expires_at: string | number
  status: string
  request_count?: string | number
  [key: string]: unknown
}

export class SubmittedButUnconfirmedError extends Error {
  hash: Address

  constructor(hash: Address, message: string) {
    super(message)
    this.name = 'SubmittedButUnconfirmedError'
    this.hash = hash
  }
}

const chain = {
  ...studionet,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: {
      http: [STUDIO_RPC],
    },
  },
}

const makeReadClient = () =>
  createClient({
    chain,
  } as any)

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

function errorText(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

function isTransientRpcError(error: unknown) {
  const message = errorText(error).toLowerCase()

  return (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('rpc') ||
    message.includes('503') ||
    message.includes('502')
  )
}

async function retry<T>(
  fn: () => Promise<T>,
  attempts = 7,
  baseDelayMs = 800,
): Promise<T> {
  let lastError: unknown

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isTransientRpcError(error) || i === attempts - 1) {
        throw error
      }

      const backoff = Math.min(baseDelayMs * 2 ** i, 8000)
      const jitter = Math.floor(Math.random() * 250)
      await sleep(backoff + jitter)
    }
  }

  throw lastError
}

function parseJson(value: unknown): any {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

export async function getAuthorizedAccount(): Promise<Address | null> {
  if (!window.ethereum) return null

  const accounts = (await window.ethereum.request({
    method: 'eth_accounts',
  })) as string[]

  return accounts[0] ? (accounts[0] as Address) : null
}

export async function connectWallet(): Promise<Address> {
  if (!window.ethereum) {
    throw new Error('MetaMask was not found.')
  }

  const accounts = (await window.ethereum.request({
    method: 'eth_requestAccounts',
  })) as string[]

  if (!accounts[0]) {
    throw new Error('No wallet account was returned.')
  }

  const account = accounts[0] as Address

  const client = createClient({
    chain,
    account,
    provider: window.ethereum,
  } as any)

  // Current GenLayerJS expects the target network name explicitly.
  await client.connect('studionet')

  return account
}

function createWriteClient(account: Address) {
  if (!window.ethereum) {
    throw new Error('MetaMask was not found.')
  }

  return createClient({
    chain,
    account,
    provider: window.ethereum,
  } as any)
}

async function readRaw(
  address: Address,
  functionName: string,
  args: unknown[] = [],
) {
  return retry(async () => {
    // Re-create the stateless read client for every retry. This avoids
    // carrying a broken transport instance across transient StudioNet failures.
    const client = makeReadClient()

    return client.readContract({
      address,
      functionName,
      args: args as any[],
      stateStatus: 'accepted',
    } as any)
  })
}

export async function getMandateCount(
  address: Address,
): Promise<number> {
  const raw = parseJson(
    await readRaw(address, 'get_mandate_count'),
  )

  if (typeof raw === 'number') return raw
  if (typeof raw === 'bigint') return Number(raw)
  if (typeof raw === 'string') return Number(raw) || 0

  return Number(
    raw?.count ??
      raw?.mandate_count ??
      raw?.total ??
      0,
  ) || 0
}

export async function getMandate(
  address: Address,
  id: number,
): Promise<Mandate | null> {
  const raw = parseJson(
    await readRaw(
      address,
      'get_mandate',
      [BigInt(id)],
    ),
  )

  if (!raw || raw.found === false) {
    return null
  }

  const mandate = raw.mandate ?? raw

  return {
    ...mandate,
    id: Number(
      mandate.id ??
        mandate.mandate_id ??
        id,
    ),
  } as Mandate
}

export async function getRegistryLimits(
  address: Address,
) {
  return parseJson(
    await readRaw(address, 'get_registry_limits'),
  )
}

function normalizeActionRequest(
  raw: any,
  fallbackId: number,
  mandateId: number,
): ActionRequest {
  return {
    ...raw,
    id: Number(raw?.id ?? fallbackId),
    mandate_id: Number(raw?.mandate_id ?? mandateId),
    agent: String(raw?.agent ?? ''),
    recipient: String(raw?.recipient ?? ''),
    recipient_label: String(raw?.recipient_label ?? ''),
    amount: raw?.amount ?? 0,
    description: String(raw?.description ?? ''),
    status: String(raw?.status ?? ''),
    decision: String(raw?.decision ?? ''),
    failed_check: Number(raw?.failed_check ?? 0),
    reason: String(raw?.reason ?? ''),
    resolved_at: raw?.resolved_at ?? '',
  }
}

export async function getMandateRequests(
  address: Address,
  mandateId: number,
): Promise<ActionRequest[]> {
  const raw = parseJson(
    await readRaw(
      address,
      'get_mandate_requests',
      [BigInt(mandateId)],
    ),
  )

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return []
  }

  return Object.entries(raw)
    .map(([requestId, request]) =>
      normalizeActionRequest(
        request,
        Number(requestId) || 0,
        mandateId,
      ),
    )
    .filter((request) => request.id > 0)
    .sort((a, b) => b.id - a.id)
}

export async function loadRecentMandates(
  address: Address,
  limit = 12,
) {
  const count = await getMandateCount(address)

  if (count <= 0) return []

  const firstId = Math.max(
    1,
    count - limit + 1,
  )

  const mandates: Mandate[] = []

  // Deliberately sequential. StudioNet is more reliable when the frontend
  // does not burst many contract reads at the same time.
  for (let id = count; id >= firstId; id -= 1) {
    const mandate = await getMandate(address, id)

    // A registry id that exists according to get_mandate_count must load.
    // Throw instead of returning a partial list, so the UI keeps its last
    // complete state rather than changing "3 mandates" to "1 mandate".
    if (!mandate) {
      throw new Error(
        `Mandate #${id} could not be read from accepted state.`,
      )
    }

    mandates.push(mandate)

    if (id > firstId) {
      await sleep(180)
    }
  }

  return mandates
}

async function waitForReceiptResilient(
  hash: Address,
  finalized = false,
) {
  let lastError: unknown

  for (let round = 0; round < 7; round += 1) {
    try {
      const client = makeReadClient()

      return await client.waitForTransactionReceipt({
        hash,
        status: finalized
          ? TransactionStatus.FINALIZED
          : TransactionStatus.ACCEPTED,
        fullTransaction: false,
        retries: round < 2 ? 30 : 18,
      } as any)
    } catch (error) {
      lastError = error

      if (
        !isTransientRpcError(error) ||
        round === 6
      ) {
        throw error
      }

      await sleep(
        Math.min(
          1400 * 2 ** round,
          10000,
        ),
      )
    }
  }

  throw lastError
}

export async function writeVault(params: {
  account: Address
  address: Address
  functionName: string
  args?: unknown[]
  value?: bigint
  finalized?: boolean
  onHash?: (hash: Address) => void
}) {
  const client = createWriteClient(
    params.account,
  )

  // Do this BEFORE writeContract. If switching/connecting fails, no tx hash
  // exists and the UI can safely report a normal error.
  await client.connect('studionet')

  let hash: Address

  try {
    hash = (await client.writeContract({
      address: params.address,
      functionName: params.functionName,
      args: (params.args ?? []) as any[],
      value: params.value ?? 0n,
    })) as Address
  } catch (error) {
    // No hash was returned => the transaction was not submitted.
    throw error
  }

  // From this point onward, never retry writeContract.
  params.onHash?.(hash)

  try {
    const receipt =
      await waitForReceiptResilient(
        hash,
        params.finalized,
      )

    if (
      receipt.txExecutionResultName &&
      receipt.txExecutionResultName ===
        ExecutionResult.FINISHED_WITH_ERROR
    ) {
      throw new Error(
        `${params.functionName} reached consensus but contract execution failed.`,
      )
    }

    return hash
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        'contract execution failed',
      )
    ) {
      throw error
    }

    throw new SubmittedButUnconfirmedError(
      hash,
      `Transaction ${hash} was submitted, but StudioNet RPC monitoring could not confirm it. Do not submit the same action again until you check Explorer.`,
    )
  }
}
