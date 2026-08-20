import { useEffect, useMemo, useRef, useState } from 'react'
import { formatEther, isAddress, parseEther } from 'viem'
import {
  connectWallet,
  getAuthorizedAccount,
  getMandate,
  getMandateRequests,
  getRegistryLimits,
  loadRecentMandates,
  SubmittedButUnconfirmedError,
  writeVault,
  type ActionRequest,
  type Address,
  type Mandate,
} from './lib/genlayer'
import {
  CONTRACT_ADDRESS,
  EXPLORER_BASE,
  LAST_MANDATE_KEY,
} from './lib/config'

type Tab = 'vault' | 'create' | 'agent'

const short = (v: string) => v ? `${v.slice(0, 6)}...${v.slice(-4)}` : '—'

const toBig = (v: unknown) => {
  try { return BigInt(String(v ?? 0)) } catch { return 0n }
}

const gen = (v: unknown) => {
  try {
    return `${Number(formatEther(toBig(v))).toLocaleString(undefined, { maximumFractionDigits: 4 })} GEN`
  } catch { return '0 GEN' }
}

const unixDate = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toLocaleString() : '—'
}

const recipientsOf = (m: Mandate | null) => {
  if (!m?.recipients) return []
  if (Array.isArray(m.recipients)) return m.recipients
  return Object.entries(m.recipients).map(([address, label]) => ({
    address,
    label: String(label),
  }))
}

type NumericField =
  | 'budget'
  | 'cap'
  | 'maxActions'
  | 'expiryDays'
  | 'fundAmount'
  | 'actionAmount'

type FieldErrors = Partial<Record<NumericField, string>>

function errorCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined

  const value = error as {
    code?: unknown
    cause?: unknown
  }

  if (typeof value.code === 'number') return value.code
  return errorCode(value.cause)
}

function rawErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message

  if (error && typeof error === 'object') {
    const value = error as {
      shortMessage?: unknown
      details?: unknown
      message?: unknown
    }

    if (typeof value.shortMessage === 'string') return value.shortMessage
    if (typeof value.details === 'string') return value.details
    if (typeof value.message === 'string') return value.message
  }

  return String(error)
}

function friendlyError(error: unknown) {
  const message = rawErrorMessage(error)
  const lower = message.toLowerCase()

  if (
    errorCode(error) === 4001 ||
    lower.includes('user rejected') ||
    lower.includes('user denied') ||
    lower.includes('rejected the request')
  ) {
    return 'Transaction cancelled in MetaMask.'
  }

  const rollback = message.match(/\[rollback\]\s*([^\n]+)/i)
  if (rollback?.[1]) return rollback[1].trim()

  const userError = message.match(/UserError[:\s]+([^\n]+)/i)
  if (userError?.[1]) return userError[1].trim()

  const reverted = message.match(/(?:execution reverted|reverted)[:\s]+([^\n]+)/i)
  if (reverted?.[1]) return reverted[1].trim()

  if (lower.includes('429') || lower.includes('rate limit')) {
    return 'StudioNet is rate-limiting requests. Wait a few seconds, then refresh state.'
  }

  if (
    lower.includes('failed to fetch') ||
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('502') ||
    lower.includes('503')
  ) {
    return 'StudioNet RPC is temporarily unavailable. Wait a few seconds and try again.'
  }

  if (lower.includes('contract execution failed')) {
    return 'The contract rejected this action. Refresh state and check the mandate rules before retrying.'
  }

  return message.length > 220
    ? `${message.slice(0, 220)}…`
    : message
}

const failedCheckLabel = (value: unknown) => {
  switch (Number(value)) {
    case 1: return 'Scope'
    case 2: return 'Purpose'
    case 3: return 'Recipient coherence'
    default: return '—'
  }
}

export default function App() {
  const [account, setAccount] = useState<Address | null>(null)
  const [tab, setTab] = useState<Tab>('vault')
  const [mandates, setMandates] = useState<Mandate[]>([])
  const [listMode, setListMode] = useState<'active' | 'history'>('active')

  const [selectedId, setSelectedId] = useState(
    Number(localStorage.getItem(LAST_MANDATE_KEY) || 0),
  )

  const [selected, setSelected] = useState<Mandate | null>(null)
  const [limits, setLimits] = useState<any>(null)

  const [requests, setRequests] = useState<ActionRequest[]>([])
  const [requestsMandateId, setRequestsMandateId] = useState(0)
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [requestsError, setRequestsError] = useState('')

  const [busy, setBusy] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [txHash, setTxHash] = useState('')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const [agent, setAgent] = useState('')
  const [mandateText, setMandateText] = useState(
    'Purchase cloud infrastructure and GPU compute required to operate the project.',
  )
  const [recipient, setRecipient] = useState('')
  const [recipientLabel, setRecipientLabel] = useState(
    'Cloud infrastructure provider',
  )
  const [budget, setBudget] = useState('10')
  const [cap, setCap] = useState('3')
  const [maxActions, setMaxActions] = useState('4')
  const [expiryDays, setExpiryDays] = useState('7')

  const [fundAmount, setFundAmount] = useState('10')
  const [actionRecipient, setActionRecipient] = useState('')
  const [actionAmount, setActionAmount] = useState('0.5')
  const [actionDescription, setActionDescription] = useState(
    'Purchase GPU compute for project infrastructure.',
  )

  const lock = useRef(false)
  const selectedReadSeq = useRef(0)
  const fullRefreshSeq = useRef(0)
  const lastRefreshAt = useRef(0)

  function clearFieldError(field: NumericField) {
    setFieldErrors((prev) => {
      if (!prev[field]) return prev

      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  const role = useMemo(() => {
    if (!account || !selected) return 'OBSERVER'

    if (
      account.toLowerCase() ===
      selected.principal?.toLowerCase()
    ) {
      return 'PRINCIPAL'
    }

    if (
      account.toLowerCase() ===
      selected.agent?.toLowerCase()
    ) {
      return 'AGENT'
    }

    return 'OBSERVER'
  }, [account, selected])

  const available = selected
    ? toBig(selected.funded) - toBig(selected.spent)
    : 0n

  const activeMandates = useMemo(
    () =>
      mandates.filter(
        (m) =>
          String(m.status).toUpperCase() ===
          'ACTIVE',
      ),
    [mandates],
  )

  const historyMandates = useMemo(
    () =>
      mandates.filter(
        (m) =>
          String(m.status).toUpperCase() !==
          'ACTIVE',
      ),
    [mandates],
  )

  const visibleMandates =
    listMode === 'active'
      ? activeMandates
      : historyMandates

  function changeListMode(
    mode: 'active' | 'history',
  ) {
    setListMode(mode)

    const target =
      mode === 'active'
        ? activeMandates
        : historyMandates

    const selectedVisible =
      target.some(
        (m) => m.id === selectedId,
      )

    if (
      !selectedVisible &&
      target[0]
    ) {
      setSelectedId(target[0].id)
    }
  }

  useEffect(() => {
    void (async () => {
      const a = await getAuthorizedAccount()

      if (a) {
        setAccount(a)
      }

      await refreshAll(false)
    })()
  }, [])

  useEffect(() => {
    if (!window.ethereum?.on) {
      return
    }

    const handler = (
      accounts: string[],
    ) => {
      setAccount(
        accounts[0]
          ? accounts[0] as Address
          : null,
      )

      setError('')
      setNotice('')
      setTxHash('')

      // Account change does not require another request-history read.
      if (selectedId) {
        void refreshSelected(
          selectedId,
          true,
          false,
        )
      }
    }

    window.ethereum.on(
      'accountsChanged',
      handler,
    )

    return () =>
      window.ethereum?.removeListener?.(
        'accountsChanged',
        handler,
      )
  }, [selectedId])

  useEffect(() => {
    if (!selectedId) {
      return
    }

    localStorage.setItem(
      LAST_MANDATE_KEY,
      String(selectedId),
    )

    void refreshSelected(
      selectedId,
      true,
    )
  }, [selectedId])

  useEffect(() => {
    if (
      !notice ||
      error ||
      busy
    ) {
      return
    }

    if (
      notice.includes(
        'submitted, but StudioNet RPC monitoring could not confirm it',
      )
    ) {
      return
    }

    const timer =
      window.setTimeout(() => {
        setNotice('')
        setTxHash('')
      }, 6000)

    return () =>
      window.clearTimeout(timer)
  }, [notice, error, busy])

  async function guarded(
    label: string,
    fn: () => Promise<void>,
  ) {
    if (lock.current) {
      return
    }

    lock.current = true

    setBusy(label)
    setError('')
    setNotice('')
    setTxHash('')

    try {
      await fn()
    } catch (e) {
      if (
        e instanceof
        SubmittedButUnconfirmedError
      ) {
        setTxHash(e.hash)
        setNotice(e.message)
      } else {
        console.error(label, e)
        setError(friendlyError(e))
      }
    } finally {
      lock.current = false
      setBusy('')
    }
  }

  async function refreshAll(
    show = true,
  ) {
    const now = Date.now()

    if (refreshing) {
      return
    }

    // Prevent rapid manual refresh bursts against StudioNet.
    if (
      show &&
      now - lastRefreshAt.current <
        5000
    ) {
      setNotice(
        'State was refreshed recently. Please wait a few seconds.',
      )
      return
    }

    if (show) {
      lastRefreshAt.current = now
    }

    const seq =
      ++fullRefreshSeq.current

    setRefreshing(true)

    try {
      // Sequential instead of Promise.all to reduce concurrent RPC pressure.
      const items =
        await loadRecentMandates(
          CONTRACT_ADDRESS,
          12,
        )

      if (
        seq !==
        fullRefreshSeq.current
      ) {
        return
      }

      const lim =
        await getRegistryLimits(
          CONTRACT_ADDRESS,
        )

      if (
        seq !==
        fullRefreshSeq.current
      ) {
        return
      }

      setMandates(items)
      setLimits(lim)
      setInitialLoaded(true)

      let wanted = selectedId

      if (
        !wanted ||
        !items.some(
          (m) => m.id === wanted,
        )
      ) {
        const preferred =
          listMode === 'active'
            ? items.find(
                (m) =>
                  String(
                    m.status,
                  ).toUpperCase() ===
                  'ACTIVE',
              )
            : items.find(
                (m) =>
                  String(
                    m.status,
                  ).toUpperCase() !==
                  'ACTIVE',
              )

        wanted =
          preferred?.id ??
          items[0]?.id ??
          0
      }

      if (wanted) {
        const mandate =
          items.find(
            (m) =>
              m.id === wanted,
          ) ?? null

        setSelectedId(wanted)
        setSelected(mandate)

        if (mandate) {
          const rs =
            recipientsOf(mandate)

          if (rs[0]) {
            setActionRecipient(
              rs[0].address,
            )
          }
        }
      } else {
        setSelected(null)
      }

      if (show) {
        setError('')
        setNotice(
          'State refreshed.',
        )
      }
    } catch (e) {
      if (
        seq !==
        fullRefreshSeq.current
      ) {
        return
      }

      setError(
        friendlyError(e),
      )
    } finally {
      if (
        seq ===
        fullRefreshSeq.current
      ) {
        setRefreshing(false)
      }
    }
  }

  async function refreshSelected(
    id = selectedId,
    quiet = false,
    withHistory = true,
  ) {
    if (!id) {
      return
    }

    const seq =
      ++selectedReadSeq.current

    setRequestsLoading(true)
    setRequestsError('')

    try {
      const m =
        await getMandate(
          CONTRACT_ADDRESS,
          id,
        )

      // Ignore a response belonging to an older selection.
      if (
        seq !==
        selectedReadSeq.current
      ) {
        return
      }

      setSelected(m)

      if (m) {
        setMandates((prev) => {
          const rest =
            prev.filter(
              (x) =>
                x.id !== id,
            )

          return [
            m,
            ...rest,
          ].sort(
            (a, b) =>
              b.id - a.id,
          )
        })

        const rs =
          recipientsOf(m)

        if (rs[0]) {
          setActionRecipient(
            rs[0].address,
          )
        }

        if (withHistory) {
          // Fetch history only for the currently selected mandate.
          // This is deliberately sequential and uses the existing
          // StudioNet retry/read path.
          const history =
            await getMandateRequests(
              CONTRACT_ADDRESS,
              id,
            )

          if (
            seq !==
            selectedReadSeq.current
          ) {
            return
          }

          setRequests(history)
          setRequestsMandateId(id)
        }
      } else {
        setRequests([])
        setRequestsMandateId(id)
      }

      if (!quiet) {
        setError('')
        setNotice(
          `Mandate #${id} refreshed.`,
        )
      }
    } catch (e) {
      if (
        seq !==
        selectedReadSeq.current
      ) {
        return
      }

      const message =
        friendlyError(e)

      setRequestsError(message)

      if (!quiet) {
        setError(message)
      }
    } finally {
      if (
        seq ===
        selectedReadSeq.current
      ) {
        setRequestsLoading(false)
      }
    }
  }

  async function connect() {
    await guarded(
      'Connecting wallet',
      async () => {
        const a =
          await connectWallet()

        setAccount(a)
        setNotice(
          `Connected ${short(a)}`,
        )
      },
    )
  }

  async function runWrite(
    label: string,
    functionName: string,
    args: unknown[] = [],
    value = 0n,
    finalized = false,
  ) {
    if (!account) {
      setError(
        'Connect MetaMask first.',
      )
      return
    }

    await guarded(
      label,
      async () => {
        await writeVault({
          account,
          address:
            CONTRACT_ADDRESS,
          functionName,
          args,
          value,
          finalized,
          onHash: setTxHash,
        })

        setNotice(
          `${functionName} accepted. Refreshing state…`,
        )

        await new Promise(
          (r) =>
            setTimeout(
              r,
              1600,
            ),
        )

        await refreshAll(false)

        // Only request_action needs the selected mandate's
        // request history re-read immediately.
        if (
          functionName ===
            'request_action' &&
          selectedId
        ) {
          await refreshSelected(
            selectedId,
            true,
          )
        }

        setNotice(
          `${functionName} confirmed on-chain.`,
        )
      },
    )
  }

  async function createMandate() {
    if (!account) {
      return setError(
        'Connect the Principal wallet first.',
      )
    }

    if (!isAddress(agent)) {
      return setError(
        'Agent wallet is invalid.',
      )
    }

    if (!isAddress(recipient)) {
      return setError(
        'Trusted recipient is invalid.',
      )
    }

    if (
      !mandateText.trim() ||
      !recipientLabel.trim()
    ) {
      return setError(
        'Mandate and recipient label are required.',
      )
    }

    const nextErrors:
      FieldErrors = {}

    let total = 0n
    let actionCap = 0n

    try {
      total =
        parseEther(budget)

      if (total <= 0n) {
        nextErrors.budget =
          'Enter a positive total budget.'
      }
    } catch {
      nextErrors.budget =
        'Enter a valid GEN amount.'
    }

    try {
      actionCap =
        parseEther(cap)

      if (actionCap <= 0n) {
        nextErrors.cap =
          'Enter a positive per-action cap.'
      } else if (
        total > 0n &&
        actionCap > total
      ) {
        nextErrors.cap =
          'Cap cannot exceed the total budget.'
      }
    } catch {
      nextErrors.cap =
        'Enter a valid GEN amount.'
    }

    const actions =
      Number(maxActions)

    const days =
      Number(expiryDays)

    if (
      !Number.isInteger(
        actions,
      ) ||
      actions < 1 ||
      actions > 50
    ) {
      nextErrors.maxActions =
        'Enter a whole number from 1 to 50.'
    }

    if (
      !Number.isFinite(days) ||
      days <= 0
    ) {
      nextErrors.expiryDays =
        'Enter a positive number of days.'
    }

    setFieldErrors(
      (prev) => ({
        ...prev,
        budget:
          nextErrors.budget,
        cap:
          nextErrors.cap,
        maxActions:
          nextErrors.maxActions,
        expiryDays:
          nextErrors.expiryDays,
      }),
    )

    if (
      Object.keys(
        nextErrors,
      ).length > 0
    ) {
      return setError(
        'Fix the highlighted mandate fields.',
      )
    }

    const expiresAt =
      Math.floor(
        Date.now() / 1000,
      ) +
      Math.floor(
        days * 86400,
      )

    const recipientsJson =
      JSON.stringify([
        {
          address: recipient,
          label:
            recipientLabel.trim(),
        },
      ])

    const before =
      mandates[0]?.id ?? 0

    await runWrite(
      'Creating mandate',
      'create_mandate',
      [
        agent as Address,
        mandateText.trim(),
        recipientsJson,
        total,
        actionCap,
        BigInt(actions),
        BigInt(expiresAt),
      ],
      0n,
      true,
    )

    await refreshAll(false)

    const newest =
      mandates[0]?.id ??
      before

    if (newest) {
      setSelectedId(newest)
    }

    setTab('vault')
  }

  function fundMandate() {
    if (!selected) {
      return setError(
        'Select a mandate first.',
      )
    }

    let value: bigint

    try {
      value =
        parseEther(
          fundAmount,
        )

      if (value <= 0n) {
        throw new Error()
      }

      clearFieldError(
        'fundAmount',
      )
    } catch {
      setFieldErrors(
        (prev) => ({
          ...prev,
          fundAmount:
            'Enter a positive GEN amount.',
        }),
      )

      return setError(
        'Fix the highlighted funding amount.',
      )
    }

    void runWrite(
      'Funding mandate',
      'fund_mandate',
      [
        BigInt(
          selected.id,
        ),
      ],
      value,
      true,
    )
  }

  function requestAction() {
    if (!selected) {
      return setError(
        'Select a mandate first.',
      )
    }

    if (
      !isAddress(
        actionRecipient,
      )
    ) {
      return setError(
        'Recipient address is invalid.',
      )
    }

    let value: bigint

    try {
      value =
        parseEther(
          actionAmount,
        )

      if (value <= 0n) {
        throw new Error()
      }

      clearFieldError(
        'actionAmount',
      )
    } catch {
      setFieldErrors(
        (prev) => ({
          ...prev,
          actionAmount:
            'Enter a positive GEN amount.',
        }),
      )

      return setError(
        'Fix the highlighted action amount.',
      )
    }

    if (
      !actionDescription.trim()
    ) {
      return setError(
        'Action description is required.',
      )
    }

    void runWrite(
      'Consensus reviewing action',
      'request_action',
      [
        BigInt(selected.id),
        actionRecipient as Address,
        value,
        actionDescription.trim(),
      ],
      0n,
      true,
    )
  }

  function renderRequestHistory() {
    if (!selected) {
      return null
    }

    const historyReady =
      requestsMandateId ===
      selected.id

    return (
      <section className="card request-history">
        <div className="section-title">
          <div>
            <span>
              CONSENSUS RECORD
            </span>
            <h3>
              Request history
            </h3>
          </div>

          <b>
            {historyReady
              ? requests.length
              : '…'}{' '}
            requests
          </b>
        </div>

        <p className="history-note">
          Decision is
          consensus-bound.
          Reason and failed
          check are advisory
          metadata stored
          on-chain from the
          leader output.
        </p>

        {requestsError && (
          <p className="history-error">
            {requestsError}
          </p>
        )}

        {requestsLoading &&
        !historyReady ? (
          <p className="muted history-empty">
            Loading request
            history…
          </p>
        ) : !historyReady ||
          requests.length ===
            0 ? (
          <p className="muted history-empty">
            No resolved
            requests for this
            mandate yet.
          </p>
        ) : (
          <div className="request-list">
            {requests.map(
              (request) => {
                const denied =
                  String(
                    request.decision,
                  ).toUpperCase() ===
                  'DENIED'

                const authorized =
                  String(
                    request.decision,
                  ).toUpperCase() ===
                  'AUTHORIZED'

                return (
                  <article
                    className={`request-row ${
                      denied
                        ? 'denied'
                        : authorized
                          ? 'authorized'
                          : ''
                    }`}
                    key={
                      request.id
                    }
                  >
                    <div className="request-head">
                      <div>
                        <strong>
                          Request #
                          {
                            request.id
                          }
                        </strong>

                        <span
                          className={`decision-badge ${
                            denied
                              ? 'denied'
                              : 'authorized'
                          }`}
                        >
                          {request.decision ||
                            request.status}
                        </span>

                        <span className="request-status">
                          {
                            request.status
                          }
                        </span>
                      </div>

                      <strong className="request-amount">
                        {gen(
                          request.amount,
                        )}
                      </strong>
                    </div>

                    <div className="request-recipient">
                      <span>
                        {request.recipient_label ||
                          'Trusted recipient'}
                      </span>

                      <small>
                        {short(
                          request.recipient,
                        )}
                      </small>
                    </div>

                    <p className="request-description">
                      {
                        request.description
                      }
                    </p>

                    <div className="request-reason">
                      <span>
                        Advisory
                        explanation
                      </span>

                      <p>
                        {request.reason ||
                          'No explanation stored.'}
                      </p>
                    </div>

                    {denied &&
                      Number(
                        request.failed_check,
                      ) > 0 && (
                        <div className="failed-check">
                          Failed check:{' '}
                          <b>
                            {Number(
                              request.failed_check,
                            )}{' '}
                            ·{' '}
                            {failedCheckLabel(
                              request.failed_check,
                            )}
                          </b>
                        </div>
                      )}

                    <small className="resolved-at">
                      Resolved{' '}
                      {String(
                        request.resolved_at ||
                          '—',
                      )}
                    </small>
                  </article>
                )
              },
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">
            GENLAYER · STUDIONET
            · MULTI-TENANT
          </div>

          <h1>AgentVault</h1>

          <p className="tagline">
            Consensus-gated
            spending mandates
            for autonomous
            agents.
          </p>
        </div>

        <div className="header-actions">
          <a
            className="explorer"
            href={`${EXPLORER_BASE}/address/${CONTRACT_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
          >
            Contract ↗
          </a>

          <button
            className="wallet"
            onClick={connect}
            disabled={!!busy}
          >
            {account
              ? short(account)
              : 'Connect Wallet'}
          </button>
        </div>
      </header>

      <section className="stats">
        <article>
          <span>Contract</span>
          <strong>
            {short(
              CONTRACT_ADDRESS,
            )}
          </strong>
        </article>

        <article>
          <span>
            Loaded mandates
          </span>
          <strong>
            {initialLoaded
              ? mandates.length
              : 'Loading…'}
          </strong>
        </article>

        <article>
          <span>
            Registry limit
          </span>

          <strong>
            {initialLoaded
              ? (
                  limits?.max_registry_mandates ??
                  limits?.MAX_REGISTRY_MANDATES ??
                  '—'
                )
              : 'Loading…'}
          </strong>
        </article>

        <article>
          <span>Your role</span>
          <strong>
            {initialLoaded
              ? role
              : 'Loading…'}
          </strong>
        </article>
      </section>

      <nav className="tabs">
        <button
          className={
            tab === 'vault'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('vault')
          }
        >
          Vault
        </button>

        <button
          className={
            tab === 'create'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('create')
          }
        >
          Create Mandate
        </button>

        <button
          className={
            tab === 'agent'
              ? 'active'
              : ''
          }
          onClick={() =>
            setTab('agent')
          }
        >
          Agent Request
        </button>
      </nav>

      {tab === 'create' && (
        <section className="card form-card">
          <div className="section-title">
            <div>
              <span>
                PRINCIPAL
              </span>
              <h2>
                Create spending
                mandate
              </h2>
            </div>
          </div>

          <label>
            Agent wallet
            <input
              placeholder="0x..."
              value={agent}
              onChange={(e) =>
                setAgent(
                  e.target.value,
                )
              }
            />
          </label>

          <label>
            Natural-language
            mandate
            <textarea
              rows={5}
              value={mandateText}
              onChange={(e) =>
                setMandateText(
                  e.target.value,
                )
              }
            />
          </label>

          <div className="grid two">
            <label>
              Trusted recipient
              <input
                placeholder="0x..."
                value={recipient}
                onChange={(e) =>
                  setRecipient(
                    e.target.value,
                  )
                }
              />
            </label>

            <label>
              Recipient label
              <input
                value={
                  recipientLabel
                }
                onChange={(e) =>
                  setRecipientLabel(
                    e.target.value,
                  )
                }
              />
            </label>
          </div>

          <div className="grid four">
            <label>
              Total budget (GEN)
              <input
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={budget}
                onChange={(e) => {
                  setBudget(
                    e.target.value,
                  )
                  clearFieldError(
                    'budget',
                  )
                }}
              />

              {fieldErrors.budget && (
                <small className="field-error">
                  {
                    fieldErrors.budget
                  }
                </small>
              )}
            </label>

            <label>
              Per-action cap (GEN)
              <input
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={cap}
                onChange={(e) => {
                  setCap(
                    e.target.value,
                  )
                  clearFieldError(
                    'cap',
                  )
                }}
              />

              {fieldErrors.cap && (
                <small className="field-error">
                  {fieldErrors.cap}
                </small>
              )}
            </label>

            <label>
              Max actions
              <input
                type="number"
                min="1"
                max="50"
                step="1"
                inputMode="numeric"
                value={maxActions}
                onChange={(e) => {
                  setMaxActions(
                    e.target.value,
                  )
                  clearFieldError(
                    'maxActions',
                  )
                }}
              />

              {fieldErrors.maxActions && (
                <small className="field-error">
                  {
                    fieldErrors.maxActions
                  }
                </small>
              )}
            </label>

            <label>
              Expires in days
              <input
                type="number"
                min="0.25"
                step="0.25"
                inputMode="decimal"
                value={expiryDays}
                onChange={(e) => {
                  setExpiryDays(
                    e.target.value,
                  )
                  clearFieldError(
                    'expiryDays',
                  )
                }}
              />

              {fieldErrors.expiryDays && (
                <small className="field-error">
                  {
                    fieldErrors.expiryDays
                  }
                </small>
              )}
            </label>
          </div>

          <button
            className="primary"
            onClick={
              createMandate
            }
            disabled={!!busy}
          >
            {busy ===
            'Creating mandate'
              ? 'Creating…'
              : 'Create Mandate'}
          </button>
        </section>
      )}

      {tab === 'agent' && (
        <div className="agent-layout">
          <section className="card form-card">
            <div className="section-title">
              <div>
                <span>AGENT</span>
                <h2>
                  Request a
                  spending action
                </h2>
              </div>

              <b>
                Mandate #
                {selected?.id ??
                  '—'}
              </b>
            </div>

            <label>
              Recipient
              <input
                value={
                  actionRecipient
                }
                onChange={(e) =>
                  setActionRecipient(
                    e.target.value,
                  )
                }
                placeholder="0x..."
              />
            </label>

            <label>
              Amount (GEN)
              <input
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={actionAmount}
                onChange={(e) => {
                  setActionAmount(
                    e.target.value,
                  )
                  clearFieldError(
                    'actionAmount',
                  )
                }}
              />

              {fieldErrors.actionAmount && (
                <small className="field-error">
                  {
                    fieldErrors.actionAmount
                  }
                </small>
              )}
            </label>

            <label>
              Action description
              <textarea
                rows={4}
                value={
                  actionDescription
                }
                onChange={(e) =>
                  setActionDescription(
                    e.target.value,
                  )
                }
              />
            </label>

            <div className="hint">
              GenLayer consensus
              checks scope,
              purpose and
              recipient coherence.
              Deterministic limits
              still enforce
              allowlist, budget,
              cap, expiry and
              action count.
            </div>

            <button
              className="primary"
              onClick={
                requestAction
              }
              disabled={
                !!busy ||
                !selected
              }
            >
              {busy ===
              'Consensus reviewing action'
                ? 'Consensus reviewing…'
                : 'Request Action'}
            </button>
          </section>

          {renderRequestHistory()}
        </div>
      )}

      {tab === 'vault' && (
        <div className="vault-layout">
          <aside className="card list-card">
            <div className="section-title">
              <div>
                <span>
                  REGISTRY
                </span>

                <h3>
                  {listMode ===
                  'active'
                    ? 'Active mandates'
                    : 'History'}
                </h3>
              </div>

              <button
                className="icon"
                onClick={() =>
                  refreshAll()
                }
                disabled={
                  refreshing
                }
                title={
                  refreshing
                    ? 'Refreshing…'
                    : 'Refresh state'
                }
              >
                {refreshing
                  ? '…'
                  : '↻'}
              </button>
            </div>

            <div className="registry-tabs">
              <button
                className={
                  listMode ===
                  'active'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  changeListMode(
                    'active',
                  )
                }
              >
                Active{' '}
                <b>
                  {initialLoaded
                    ? activeMandates.length
                    : '…'}
                </b>
              </button>

              <button
                className={
                  listMode ===
                  'history'
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  changeListMode(
                    'history',
                  )
                }
              >
                History{' '}
                <b>
                  {initialLoaded
                    ? historyMandates.length
                    : '…'}
                </b>
              </button>
            </div>

            {!initialLoaded ? (
              <p className="muted registry-empty">
                Loading on-chain
                state…
              </p>
            ) : visibleMandates.length ===
              0 ? (
              <p className="muted registry-empty">
                {listMode ===
                'active'
                  ? 'No active mandates.'
                  : 'No completed mandates yet.'}
              </p>
            ) : (
              visibleMandates.map(
                (m) => (
                  <button
                    key={m.id}
                    className={`mandate-row ${
                      selectedId ===
                      m.id
                        ? 'selected'
                        : ''
                    }`}
                    onClick={() =>
                      setSelectedId(
                        m.id,
                      )
                    }
                  >
                    <div>
                      <strong>
                        #{m.id}
                      </strong>

                      <span
                        className={`pill ${String(
                          m.status,
                        ).toLowerCase()}`}
                      >
                        {m.status}
                      </span>
                    </div>

                    <p>
                      {
                        m.mandate_text
                      }
                    </p>

                    <small>
                      {short(m.agent)}
                    </small>
                  </button>
                ),
              )
            )}
          </aside>

          <section className="detail">
            {selected ? (
              <>
                <article className="card hero">
                  <div>
                    <div className="status-line">
                      <span
                        className={`pill ${String(
                          selected.status,
                        ).toLowerCase()}`}
                      >
                        {
                          selected.status
                        }
                      </span>

                      <span>
                        Mandate #
                        {selected.id}
                      </span>
                    </div>

                    <h2>
                      {
                        selected.mandate_text
                      }
                    </h2>

                    <p className="muted">
                      Expires{' '}
                      {unixDate(
                        selected.expires_at,
                      )}
                    </p>
                  </div>

                  <div className="money">
                    <span>
                      Available funded
                    </span>

                    <strong>
                      {gen(available)}
                    </strong>
                  </div>
                </article>

                <section className="grid four metrics">
                  <article className="card">
                    <span>
                      Budget
                    </span>

                    <strong>
                      {gen(
                        selected.total_budget,
                      )}
                    </strong>
                  </article>

                  <article className="card">
                    <span>
                      Funded
                    </span>

                    <strong>
                      {gen(
                        selected.funded,
                      )}
                    </strong>
                  </article>

                  <article className="card">
                    <span>
                      Spent
                    </span>

                    <strong>
                      {gen(
                        selected.spent,
                      )}
                    </strong>
                  </article>

                  <article className="card">
                    <span>
                      Actions
                    </span>

                    <strong>
                      {String(
                        selected.actions_used ??
                          0,
                      )}{' '}
                      /{' '}
                      {String(
                        selected.max_actions ??
                          0,
                      )}
                    </strong>
                  </article>
                </section>

                <section className="grid two">
                  <article className="card">
                    <div className="section-title">
                      <div>
                        <span>
                          AUTHORITY
                        </span>

                        <h3>
                          Mandate
                          configuration
                        </h3>
                      </div>
                    </div>

                    <dl>
                      <div>
                        <dt>
                          Principal
                        </dt>
                        <dd>
                          {
                            selected.principal
                          }
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Agent
                        </dt>
                        <dd>
                          {
                            selected.agent
                          }
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Per-action
                          cap
                        </dt>
                        <dd>
                          {gen(
                            selected.per_action_cap,
                          )}
                        </dd>
                      </div>

                      <div>
                        <dt>
                          Status
                        </dt>
                        <dd>
                          {
                            selected.status
                          }
                        </dd>
                      </div>
                    </dl>

                    <div className="recipients">
                      <h4>
                        Trusted
                        recipients
                      </h4>

                      {recipientsOf(
                        selected,
                      ).map((r) => (
                        <div
                          key={
                            r.address
                          }
                        >
                          <b>
                            {r.label}
                          </b>

                          <small>
                            {
                              r.address
                            }
                          </small>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="card actions-card">
                    <div className="section-title">
                      <div>
                        <span>
                          ACTIONS
                        </span>

                        <h3>
                          Principal
                          controls
                        </h3>
                      </div>
                    </div>

                    <label>
                      Fund amount
                      (GEN)

                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        inputMode="decimal"
                        value={
                          fundAmount
                        }
                        onChange={(e) => {
                          setFundAmount(
                            e.target.value,
                          )

                          clearFieldError(
                            'fundAmount',
                          )
                        }}
                      />

                      {fieldErrors.fundAmount && (
                        <small className="field-error">
                          {
                            fieldErrors.fundAmount
                          }
                        </small>
                      )}
                    </label>

                    <button
                      className="primary"
                      onClick={
                        fundMandate
                      }
                      disabled={
                        !!busy ||
                        role !==
                          'PRINCIPAL' ||
                        selected.status !==
                          'ACTIVE'
                      }
                    >
                      Fund Mandate
                    </button>

                    <button
                      className="secondary"
                      onClick={() =>
                        setTab(
                          'agent',
                        )
                      }
                      disabled={!!busy}
                    >
                      Open Agent
                      Request
                    </button>

                    <button
                      className="danger"
                      onClick={() =>
                        runWrite(
                          'Revoking mandate',
                          'revoke_mandate',
                          [
                            BigInt(
                              selected.id,
                            ),
                          ],
                          0n,
                          true,
                        )
                      }
                      disabled={
                        !!busy ||
                        role !==
                          'PRINCIPAL' ||
                        selected.status !==
                          'ACTIVE'
                      }
                    >
                      Revoke Mandate
                    </button>

                    <button
                      className="secondary"
                      onClick={() =>
                        runWrite(
                          'Withdrawing unused GEN',
                          'withdraw_unused',
                          [
                            BigInt(
                              selected.id,
                            ),
                          ],
                          0n,
                          true,
                        )
                      }
                      disabled={
                        !!busy ||
                        role !==
                          'PRINCIPAL'
                      }
                    >
                      Withdraw Unused
                      GEN
                    </button>

                    {role !==
                      'PRINCIPAL' && (
                      <p className="muted">
                        Connect the
                        Principal
                        wallet to
                        fund, revoke
                        or withdraw.
                      </p>
                    )}
                  </article>
                </section>

                {renderRequestHistory()}
              </>
            ) : !initialLoaded ? (
              <article className="card empty">
                <h2>
                  Loading on-chain
                  state…
                </h2>

                <p>
                  Waiting for
                  StudioNet RPC.
                  Existing mandates
                  remain on-chain.
                </p>
              </article>
            ) : (
              <article className="card empty">
                <h2>
                  Select a mandate
                </h2>

                <p>
                  Refresh the
                  registry or
                  create a new
                  mandate.
                </p>
              </article>
            )}
          </section>
        </div>
      )}

      {(busy ||
        notice ||
        error ||
        txHash) && (
        <aside
          className={`toast ${
            error
              ? 'error'
              : ''
          }`}
        >
          {busy && (
            <strong>
              {busy}…
            </strong>
          )}

          {notice && (
            <span>
              {notice}
            </span>
          )}

          {error && (
            <span>
              {error}
            </span>
          )}

          {txHash && (
            <a
              href={`${EXPLORER_BASE}/transactions/${txHash}`}
              target="_blank"
              rel="noreferrer"
            >
              Transaction{' '}
              {short(txHash)} ↗
            </a>
          )}
        </aside>
      )}
    </main>
  )
}
