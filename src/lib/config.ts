export const CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  '0xb3d76B5517a14A846e9FF8b73a48e582A034de25'

// The app's own origin proxies this to Studio (vite.config.ts in development,
// vercel.json in production). Same-origin means a rate-limited 429/503 arrives
// as a readable status instead of an opaque "Failed to fetch" with no CORS
// headers attached.
export const STUDIO_RPC =
  (import.meta.env.VITE_STUDIO_RPC as string | undefined) || '/api/rpc'

// MetaMask registers a network by absolute URL and fetches it itself, so the
// same-origin proxy path cannot be used when adding the chain.
export const STUDIO_WALLET_RPC =
  (import.meta.env.VITE_STUDIO_WALLET_RPC as string | undefined) ||
  'https://studio.genlayer.com/api'

export const EXPLORER_BASE =
  import.meta.env.VITE_EXPLORER_BASE ||
  'https://explorer-studio.genlayer.com'

export const NETWORK_NAME = 'GenLayer StudioNet'
export const CHAIN_ID = 61999

export const LAST_MANDATE_KEY = 'agentvault:lastMandate'
