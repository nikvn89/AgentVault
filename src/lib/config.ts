export const CONTRACT_ADDRESS =
  (import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined) ??
  '0xb3d76B5517a14A846e9FF8b73a48e582A034de25'

export const STUDIO_RPC =
  import.meta.env.VITE_STUDIO_RPC ||
  'https://studio.genlayer.com/api'

export const EXPLORER_BASE =
  import.meta.env.VITE_EXPLORER_BASE ||
  'https://explorer-studio.genlayer.com'

export const LAST_MANDATE_KEY = 'agentvault:lastMandate'
