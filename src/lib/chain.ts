/**
 * Network handling for StudioNet, without the Snap.
 *
 * `client.connect('studionet')` from genlayer-js does two unrelated things: it
 * adds and switches the MetaMask network, and it installs the GenLayer
 * MetaMask Snap. Reading the SDK (1.1.8, `dist/index.js`) makes the second part
 * explicit — `wallet_getSnaps`, then `wallet_requestSnaps` when the Snap is
 * absent. Signing a transaction never needs that Snap: writes go out through
 * `eth_sendTransaction` on the injected provider. So a reviewer without the
 * Snap, or one who declines the install prompt, was blocked from every write in
 * this app for no functional reason.
 *
 * `ensureStudioNet` keeps the useful half and drops the rest.
 *
 * The switch also has to happen here rather than being left to the SDK.
 * `assertChainMatch` in the same file opens with `if (chainConfig.isStudio)
 * return;`, and `studionet.isStudio` is `true` — so the SDK deliberately does
 * NOT verify the wallet's network before `eth_sendTransaction` on StudioNet. A
 * wallet left on mainnet would otherwise be asked to sign against the wrong
 * chain.
 */

import { studionet } from 'genlayer-js/chains'

import { CHAIN_ID, EXPLORER_BASE, STUDIO_RPC, STUDIO_WALLET_RPC } from './config'

const CHAIN_ID_HEX = `0x${CHAIN_ID.toString(16)}`

/** The chain the app talks to: same-origin RPC, proxied to Studio. */
export const proxiedChain = {
  ...studionet,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: { http: [STUDIO_RPC] },
  },
}

function errorCode(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return typeof code === 'number' ? code : Number(code)
  }
  return undefined
}

async function switchChain() {
  await window.ethereum!.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: CHAIN_ID_HEX }],
  })
}

async function addChain() {
  await window.ethereum!.request({
    method: 'wallet_addEthereumChain',
    params: [
      {
        chainId: CHAIN_ID_HEX,
        chainName: studionet.name || 'GenLayer Studio Network',
        // MetaMask needs an absolute URL it can reach itself; the app's own
        // same-origin proxy is not usable as a registered network endpoint.
        rpcUrls: [STUDIO_WALLET_RPC],
        nativeCurrency: studionet.nativeCurrency ?? {
          name: 'GEN Token',
          symbol: 'GEN',
          decimals: 18,
        },
        blockExplorerUrls: [EXPLORER_BASE],
      },
    ],
  })
}

/** Put the wallet on StudioNet. Never touches Snaps. */
export async function ensureStudioNet(): Promise<void> {
  if (!window.ethereum) {
    throw new Error('MetaMask was not detected in this browser.')
  }

  const current = await window.ethereum.request({ method: 'eth_chainId' })
  if (typeof current === 'string' && current.toLowerCase() === CHAIN_ID_HEX) {
    return
  }

  try {
    await switchChain()
    return
  } catch (error) {
    if (errorCode(error) === 4001) {
      throw new Error(
        'Network switch was rejected. Switch MetaMask to GenLayer Studio ' +
          'Network to continue.',
      )
    }
    if (errorCode(error) !== 4902) throw error
  }

  // 4902: the network is unknown to this wallet. Add it, then switch.
  try {
    await addChain()
    await switchChain()
  } catch (error) {
    if (errorCode(error) === 4001) {
      throw new Error(
        'Adding GenLayer Studio Network was rejected. Add chain ' +
          `${CHAIN_ID} in MetaMask to continue.`,
      )
    }
    throw error
  }
}
