import type { PageToolboxRuntimeBindingV1, PageToolPlanV1 } from '..'
import {
  createPageToolboxControlResult,
  PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE,
  PageToolboxShadowControl,
} from '..'

function binding(generation = 1, exactOrigin = 'https://alpha.example'): PageToolboxRuntimeBindingV1 {
  return {
    moduleId: 'dev.oneweb.page-toolbox',
    exactOrigin,
    tabId: generation,
    frameId: 0,
    navigationId: `document:${generation}`,
    generation,
  }
}

const password: PageToolPlanV1 = {
  toolId: 'password-visibility',
  settings: { gesture: 'double-click' },
}

function createSurface(plans: readonly PageToolPlanV1[] = []) {
  let root: ShadowRoot | null = null
  const original = HTMLElement.prototype.attachShadow
  const attach = vi.spyOn(HTMLElement.prototype, 'attachShadow').mockImplementation(function (
    this: HTMLElement,
    options,
  ) {
    root = original.call(this, options)
    return root
  })
  const onToggle = vi.fn(() => 'shadow:1:action')
  const surface = new PageToolboxShadowControl({ document, binding: binding(), plans, onToggle })
  attach.mockRestore()
  if (!root)
    throw new Error('expected closed ShadowRoot')
  return { onToggle, root: root as ShadowRoot, surface }
}

function controlResult(
  actionId: string,
  toolId: 'free-page-edit' | 'password-visibility' | 'selection-copy-release',
  enabled: boolean,
  result: { ok: true, changed: boolean } | { ok: false, reason: 'permission-missing' },
) {
  return createPageToolboxControlResult('02'.repeat(24), binding(), actionId, toolId, enabled, result)
}

describe('page Toolbox closed Shadow control surface', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head><title>private title</title></head><body><input type="password" value="secret-value"></body>'
  })

  it('renders only fixed safe copy inside a closed, focusable host', () => {
    const { root, surface } = createSurface([password])
    expect(surface.hostNode.shadowRoot).toBeNull()
    expect(surface.hostNode.hasAttribute(PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE)).toBe(true)
    expect(surface.hostNode.tabIndex).toBe(0)
    expect(root.textContent).toContain('Page Toolbox')
    expect(root.textContent).toContain('密码可见性')
    expect(root.textContent).not.toContain('private title')
    expect(root.textContent).not.toContain('secret-value')
    expect(root.querySelector('button')?.getAttribute('aria-expanded')).toBe('false')
    root.querySelector('button')?.click()
    expect(root.querySelector('button')?.getAttribute('aria-expanded')).toBe('true')
    expect((root.querySelector('.panel') as HTMLElement).hidden).toBe(false)
    surface.dispose()
  })

  it('allows one finite toggle, disables peers while pending and accepts only its terminal result', () => {
    const { onToggle, root, surface } = createSurface()
    const passwordInput = root.querySelector<HTMLInputElement>('[data-tool-id="password-visibility"]')!
    passwordInput.checked = true
    passwordInput.dispatchEvent(new Event('change', { bubbles: true }))
    expect(onToggle).toHaveBeenCalledWith('password-visibility', true)
    expect(surface.phase).toBe('pending')
    expect([...root.querySelectorAll<HTMLInputElement>('input')].every(input => input.disabled)).toBe(true)
    expect(surface.requestToggle('free-page-edit', true)).toBe(false)
    expect(onToggle).toHaveBeenCalledOnce()

    expect(surface.acceptResult(controlResult(
      'shadow:1:forged',
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))).toBe(false)
    expect(surface.acceptResult(controlResult(
      'shadow:1:action',
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))).toBe(true)
    expect(surface.activeToolIds).toEqual(['password-visibility'])
    expect(passwordInput.checked).toBe(true)
    expect(passwordInput.disabled).toBe(false)
    expect(surface.acceptResult(controlResult(
      'shadow:1:action',
      'password-visibility',
      true,
      { ok: true, changed: true },
    ))).toBe(false)
    surface.dispose()
  })

  it('rolls a rejected toggle back to synchronized state and allows one explicit retry', () => {
    const { onToggle, root, surface } = createSurface([password])
    const input = root.querySelector<HTMLInputElement>('[data-tool-id="password-visibility"]')!
    input.checked = false
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(surface.acceptResult(controlResult(
      'shadow:1:action',
      'password-visibility',
      false,
      { ok: false, reason: 'permission-missing' },
    ))).toBe(true)
    expect(surface.phase).toBe('error')
    expect(input.checked).toBe(true)
    expect(root.querySelector('[role="status"]')?.textContent).toContain('权限已撤销')
    onToggle.mockReturnValueOnce('shadow:1:retry')
    expect(surface.requestToggle('free-page-edit', true)).toBe(true)
    expect(surface.phase).toBe('pending')
    surface.dispose()
  })

  it('rejects cross-generation plan updates and keeps two documents isolated', () => {
    const peerFrame = document.createElement('iframe')
    document.body.append(peerFrame)
    const alpha = createSurface()
    const betaDocument = peerFrame.contentDocument!
    let betaRoot: ShadowRoot | null = null
    const original = betaDocument.defaultView!.HTMLElement.prototype.attachShadow
    const attach = vi.spyOn(betaDocument.defaultView!.HTMLElement.prototype, 'attachShadow')
      .mockImplementation(function (this: HTMLElement, options) {
        betaRoot = original.call(this, options)
        return betaRoot
      })
    const beta = new PageToolboxShadowControl({
      document: betaDocument,
      binding: { ...binding(2, 'https://beta.example'), tabId: 2 },
      plans: [password],
      onToggle: () => 'shadow:2:action',
    })
    attach.mockRestore()

    expect(alpha.surface.update([password], binding(2))).toBe(false)
    expect(alpha.surface.activeToolIds).toEqual([])
    alpha.surface.dispose()
    expect(beta.phase).toBe('active')
    expect(betaRoot).not.toBeNull()
    expect(beta.hostNode.isConnected).toBe(true)
    beta.dispose()
  })

  it('cleans listeners before the owned host and never removes a page-moved or replacement node', () => {
    const { root, surface } = createSurface()
    const launcher = root.querySelector<HTMLButtonElement>('button')!
    const host = surface.hostNode
    expect(surface.resourceCount).toBe(5)
    expect(surface.dispose()).toBe(true)
    expect(host.isConnected).toBe(false)
    launcher.click()
    expect(launcher.getAttribute('aria-expanded')).toBe('false')

    const moved = createSurface()
    const pageOwner = document.createElement('aside')
    document.body.append(pageOwner)
    pageOwner.append(moved.surface.hostNode)
    const replacement = document.createElement('div')
    replacement.setAttribute(PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE, 'page-owned')
    document.documentElement.append(replacement)
    expect(moved.surface.dispose()).toBe(true)
    expect(moved.surface.hostNode.parentNode).toBe(pageOwner)
    expect(replacement.isConnected).toBe(true)
  })

  it('rolls back its owned host and prior listeners when construction partially fails', () => {
    const original = HTMLInputElement.prototype.addEventListener
    let calls = 0
    const add = vi.spyOn(HTMLInputElement.prototype, 'addEventListener').mockImplementation(function (
      this: HTMLInputElement,
      ...args
    ) {
      calls += 1
      if (calls === 2)
        throw new Error('simulated listener failure')
      return original.apply(this, args)
    })
    expect(() => new PageToolboxShadowControl({
      document,
      binding: binding(),
      plans: [],
      onToggle: () => 'shadow:1:never',
    })).toThrow('simulated listener failure')
    add.mockRestore()
    expect(document.querySelector(`[${PAGE_TOOLBOX_SHADOW_HOST_ATTRIBUTE}]`)).toBeNull()
  })
})
