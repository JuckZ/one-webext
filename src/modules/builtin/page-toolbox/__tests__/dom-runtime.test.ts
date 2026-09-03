import type { PageToolboxRuntimeBindingV1, PageToolPlanV1 } from '..'
import { PageToolboxDomRuntime } from '..'

function binding(generation = 1, exactOrigin = 'https://alpha.example'): PageToolboxRuntimeBindingV1 {
  return {
    moduleId: 'dev.oneweb.page-toolbox',
    exactOrigin,
    tabId: 7,
    frameId: 0,
    navigationId: `document:${generation}`,
    generation,
  }
}

function password(gesture: 'double-click' | 'triple-click' = 'double-click'): PageToolPlanV1 {
  return { toolId: 'password-visibility', settings: { gesture } }
}

function edit(mode: 'rich-text' | 'plain-text' = 'rich-text'): PageToolPlanV1 {
  return { toolId: 'free-page-edit', settings: { mode } }
}

function release(overrides: Partial<{ selection: boolean, copy: boolean, contextMenu: boolean }> = {}): PageToolPlanV1 {
  return { toolId: 'selection-copy-release', settings: { selection: true, copy: true, contextMenu: true, ...overrides } }
}

function click(input: HTMLInputElement, detail: number) {
  input.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
}

describe('page Toolbox packaged DOM runtime', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = '<head></head><body></body>'
  })

  it('toggles qualified dynamic password inputs without reading values and restores owned types', () => {
    document.body.innerHTML = '<input id="password" type="password" value="local-secret"><input id="disabled" type="password" disabled>'
    const runtime = new PageToolboxDomRuntime(document, binding(), [password()])
    const input = document.querySelector<HTMLInputElement>('#password')!
    const disabled = document.querySelector<HTMLInputElement>('#disabled')!
    click(input, 1)
    expect(input.type).toBe('password')
    click(input, 2)
    expect(input.type).toBe('text')
    expect(input.value).toBe('local-secret')
    click(disabled, 2)
    expect(disabled.type).toBe('password')

    const dynamic = document.createElement('input')
    dynamic.type = 'password'
    document.body.append(dynamic)
    click(dynamic, 2)
    expect(dynamic.type).toBe('text')
    expect(runtime.activeToolIds).toEqual(['password-visibility'])
    runtime.dispose('navigation')
    expect(input.type).toBe('password')
    expect(dynamic.type).toBe('password')
    expect(runtime.resourceCount).toBe(0)
  })

  it('updates the password gesture and never overwrites a later page-owned type', async () => {
    document.body.innerHTML = '<input id="password" type="password">'
    const input = document.querySelector<HTMLInputElement>('#password')!
    const runtime = new PageToolboxDomRuntime(document, binding(), [password()])
    expect(runtime.reconcile([password('triple-click')])).toBe(true)
    click(input, 2)
    expect(input.type).toBe('password')
    click(input, 3)
    expect(input.type).toBe('text')
    input.type = 'email'
    await Promise.resolve()
    runtime.dispose('disabled')
    expect(input.type).toBe('email')
  })

  it('owns exact contenteditable values across updates and body replacement', async () => {
    document.body.setAttribute('contenteditable', 'false')
    const originalBody = document.body
    const runtime = new PageToolboxDomRuntime(document, binding(), [edit()])
    expect(originalBody.getAttribute('contenteditable')).toBe('true')
    runtime.reconcile([edit('plain-text')])
    expect(originalBody.getAttribute('contenteditable')).toBe('plaintext-only')

    const replacement = document.createElement('body')
    replacement.textContent = 'untrusted page text'
    originalBody.replaceWith(replacement)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(replacement.getAttribute('contenteditable')).toBe('plaintext-only')
    runtime.dispose('worker-restart')
    expect(originalBody.getAttribute('contenteditable')).toBe('false')
    expect(replacement.hasAttribute('contenteditable')).toBe(false)
    expect(replacement.textContent).toBe('untrusted page text')
  })

  it('does not restore contenteditable after a page or newer generation takes ownership', async () => {
    const first = new PageToolboxDomRuntime(document, binding(1), [edit()])
    const second = new PageToolboxDomRuntime(document, binding(2), [edit('plain-text')])
    first.dispose('tool-update')
    expect(document.body.getAttribute('contenteditable')).toBe('plaintext-only')
    second.dispose('navigation')
    expect(document.body.hasAttribute('contenteditable')).toBe(false)

    const third = new PageToolboxDomRuntime(document, binding(3), [edit()])
    document.body.setAttribute('contenteditable', 'false')
    await Promise.resolve()
    third.dispose('navigation')
    expect(document.body.getAttribute('contenteditable')).toBe('false')
  })

  it('releases only fixed selection/copy blockers and removes all owned resources', () => {
    document.body.innerHTML = '<p id="text">copy me</p>'
    let blocked = 0
    const blocker = (event: Event) => {
      blocked += 1
      event.preventDefault()
    }
    document.body.addEventListener('copy', blocker)
    const runtime = new PageToolboxDomRuntime(document, binding(), [release()])
    const text = document.querySelector('#text')!
    const allowed = new Event('copy', { bubbles: true, cancelable: true })
    text.dispatchEvent(allowed)
    expect(blocked).toBe(0)
    expect(allowed.defaultPrevented).toBe(false)
    expect([...document.querySelectorAll('style')].some(style => style.textContent?.includes('user-select'))).toBe(true)

    runtime.reconcile([release({ selection: false, copy: false, contextMenu: false })])
    const blockedAgain = new Event('copy', { bubbles: true, cancelable: true })
    text.dispatchEvent(blockedAgain)
    expect(blocked).toBe(1)
    expect(blockedAgain.defaultPrevented).toBe(true)
    runtime.dispose('origin-revoked')
    expect([...document.querySelectorAll('style')].some(style => style.textContent?.includes('user-select'))).toBe(false)
  })

  it('isolates origins, tools and terminal generations while rejecting malformed plans', () => {
    const alpha = new PageToolboxDomRuntime(document, binding(1, 'https://alpha.example'), [password(), edit()])
    expect(alpha.activeToolIds).toEqual(['free-page-edit', 'password-visibility'])
    expect(alpha.reconcile([{ toolId: 'unknown', settings: {} }])).toBe(false)
    expect(alpha.activeToolIds).toEqual(['free-page-edit', 'password-visibility'])
    expect(alpha.dispose('port-loss')).toBe(true)
    expect(alpha.dispose('port-loss')).toBe(false)
    expect(alpha.reconcile([release()])).toBe(false)

    const beta = new PageToolboxDomRuntime(document, binding(2, 'https://beta.example'), [release()])
    expect(beta.activeToolIds).toEqual(['selection-copy-release'])
    beta.dispose('extension-update')
  })

  it('contains one document tool failure while a second origin and peer tools stay live', () => {
    const alphaFrame = document.createElement('iframe')
    const betaFrame = document.createElement('iframe')
    document.body.append(alphaFrame, betaFrame)
    const alphaDocument = alphaFrame.contentDocument!
    const betaDocument = betaFrame.contentDocument!
    alphaDocument.body.innerHTML = '<input id="password" type="password" value="alpha-secret">'
    betaDocument.body.innerHTML = '<input id="password" type="password" value="beta-secret">'

    const alpha = new PageToolboxDomRuntime(alphaDocument, binding(11, 'https://alpha.example'), [
      password(),
      edit(),
      release(),
    ])
    const beta = new PageToolboxDomRuntime(betaDocument, {
      ...binding(12, 'https://beta.example'),
      tabId: 8,
    }, [
      edit('plain-text'),
      release({ copy: false }),
    ])
    expect(alphaDocument.body.getAttribute('contenteditable')).toBe('true')
    expect(betaDocument.body.getAttribute('contenteditable')).toBe('plaintext-only')
    const betaResources = beta.resourceCount

    const alphaInput = alphaDocument.querySelector<HTMLInputElement>('#password')!
    alphaInput.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }))
    expect(alphaInput.type).toBe('text')
    expect(betaDocument.querySelector<HTMLInputElement>('#password')!.type).toBe('password')

    const alphaStyle = [...alphaDocument.querySelectorAll('style')]
      .find(style => style.textContent?.includes('user-select'))!
    alphaStyle.textContent = 'page-owned-style'
    expect(alpha.reconcile([
      password('triple-click'),
      edit('plain-text'),
      release({ selection: false }),
    ])).toBe(true)
    expect(alpha.activeToolIds).toEqual(['free-page-edit', 'password-visibility'])
    expect(alphaStyle.textContent).toBe('page-owned-style')
    expect(beta.activeToolIds).toEqual(['free-page-edit', 'selection-copy-release'])
    expect(beta.resourceCount).toBe(betaResources)
    expect(betaDocument.body.getAttribute('contenteditable')).toBe('plaintext-only')

    alpha.dispose('port-loss')
    expect(alphaInput.type).toBe('password')
    expect(alphaDocument.body.hasAttribute('contenteditable')).toBe(false)
    expect(alphaStyle.textContent).toBe('page-owned-style')
    expect(betaDocument.body.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(beta.activeToolIds).toEqual(['free-page-edit', 'selection-copy-release'])

    beta.dispose('worker-restart')
    expect(betaDocument.body.hasAttribute('contenteditable')).toBe(false)
    expect([...betaDocument.querySelectorAll('style')].some(style => style.textContent?.includes('user-select')))
      .toBe(false)
  })
})
