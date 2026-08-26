import type { Runtime } from 'webextension-polyfill'
import browser from 'webextension-polyfill'
import {
  bridgeEnvelope,
  type BridgeEnvelope,
  isExtensionMessage,
  isTrustedEmbedMessage,
  normalizeRepoContext,
  type PanelContextMessage,
  type PanelReadyMessage,
  type RepoContext,
  REPOLENS_ORIGIN,
} from '~/repolens/protocol'
import './sidebar.css'

const frame = document.querySelector<HTMLIFrameElement>('[data-testid="repolens-embed"]')!
const bridgeState = document.querySelector<HTMLElement>('.bridge-state')!
const repoLabel = document.querySelector<HTMLElement>('[data-testid="current-repo"]')!
const extensionOrigin = new URL(browser.runtime.getURL('/')).origin

let activeChallenge = ''
let sessionNonce = ''
let bridgeReady = false
let currentContext: RepoContext | null = null

frame.src = `${REPOLENS_ORIGIN}/embed?parentOrigin=${encodeURIComponent(extensionOrigin)}`

function setBridgeLabel(value: string, ready = bridgeReady) {
  bridgeReady = ready
  bridgeState.textContent = value
  bridgeState.dataset.ready = String(ready)
}

function createSessionNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function postToEmbed(type: 'BRIDGE_INIT' | 'CONTEXT_UPDATE' | 'REQUEST_DEEP_ANALYSIS', fields: Record<string, unknown> = {}) {
  frame.contentWindow?.postMessage(
    bridgeEnvelope(type, { sessionNonce, ...fields }),
    REPOLENS_ORIGIN,
  )
}

function sendCurrentContext() {
  if (!bridgeReady || !currentContext)
    return
  const { repo, url, pageType } = currentContext
  postToEmbed('CONTEXT_UPDATE', { context: { repo, url, pageType } })
}

async function requestAuthorizationCode() {
  try {
    const stored = await browser.storage.local.get('repolensPairingToken')
    const pairingToken = typeof stored.repolensPairingToken === 'string' ? stored.repolensPairingToken : ''
    const response = await fetch(`${REPOLENS_ORIGIN}/api/auth/extension-grants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(pairingToken ? { 'x-repolens-pairing-token': pairingToken } : {}),
      },
      body: JSON.stringify({ extensionOrigin }),
    })
    if (!response.ok)
      return undefined
    const data = await response.json() as { authorizationCode?: unknown }
    return typeof data.authorizationCode === 'string' ? data.authorizationCode : undefined
  }
  catch {
    return undefined
  }
}

async function handleEmbedMessage(event: MessageEvent) {
  if (!isTrustedEmbedMessage(event, REPOLENS_ORIGIN, frame.contentWindow))
    return
  const message: BridgeEnvelope = event.data

  if (message.type === 'BRIDGE_HELLO') {
    if (typeof message.challenge !== 'string' || message.challenge.length < 8 || message.challenge === activeChallenge)
      return
    activeChallenge = message.challenge
    sessionNonce = createSessionNonce()
    setBridgeLabel('正在验证一次性会话…', false)
    const authorizationCode = await requestAuthorizationCode()
    postToEmbed('BRIDGE_INIT', {
      challenge: message.challenge,
      ...(authorizationCode ? { authorizationCode } : {}),
    })
    return
  }

  if (!sessionNonce || message.sessionNonce !== sessionNonce)
    return

  if (message.type === 'BRIDGE_READY') {
    setBridgeLabel('安全桥接已连接', true)
    sendCurrentContext()
  }
  else if (message.type === 'CONTEXT_ACCEPTED') {
    setBridgeLabel(`已同步 ${message.repo || '当前仓库'}`)
  }
  else if (message.type === 'ANALYSIS_STATE' && message.state) {
    setBridgeLabel(`RepoLens · ${message.state}`)
  }
}

function acceptPanelContext(message: PanelContextMessage) {
  const context = normalizeRepoContext(message.context)
  if (!context)
    return
  currentContext = context
  repoLabel.textContent = context.repo
  sendCurrentContext()
}

function handleRuntimeMessage(message: unknown, _sender: Runtime.MessageSender) {
  if (isExtensionMessage(message) && message.type === 'PANEL_CONTEXT')
    acceptPanelContext(message)
  return undefined
}

window.addEventListener('message', handleEmbedMessage)
browser.runtime.onMessage.addListener(handleRuntimeMessage)

const request: PanelReadyMessage = {
  channel: 'repolens.extension',
  version: 1,
  type: 'PANEL_READY',
}

async function initialize() {
  const response = await browser.runtime.sendMessage(request).catch(() => null)
  if (isExtensionMessage(response) && response.type === 'PANEL_CONTEXT')
    acceptPanelContext(response)
}

void initialize()
