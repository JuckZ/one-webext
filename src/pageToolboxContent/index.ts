import {
  type PageToolboxContentPort,
  PageToolboxContentRuntime,
  PageToolboxDomRuntime,
  PageToolboxShadowControl,
} from '~/modules/builtin/page-toolbox'

const runtimeKey = '__onewebPageToolboxRuntimeV3' as const
const scope = globalThis as typeof globalThis & {
  [runtimeKey]?: PageToolboxContentRuntime
}

if (!scope[runtimeKey] || scope[runtimeKey].status === 'destroyed') {
  let tools: PageToolboxDomRuntime | null = null
  let surface: PageToolboxShadowControl | null = null
  const runtime = new PageToolboxContentRuntime({
    connect: name => chrome.runtime.connect({ name }) as unknown as PageToolboxContentPort,
    onConnected(binding, plans) {
      surface?.dispose()
      tools?.dispose('tool-update')
      tools = new PageToolboxDomRuntime(document, binding, plans)
      surface = new PageToolboxShadowControl({
        document,
        binding,
        plans,
        onToggle: (toolId, enabled) => runtime.requestToolToggle(toolId, enabled),
      })
    },
    onTools(plans, binding) {
      if (!tools?.reconcile(plans))
        throw new Error('Page Toolbox tool plan reconciliation failed')
      if (!surface?.update(plans, binding))
        throw new Error('Page Toolbox Shadow control reconciliation failed')
    },
    onControlResult(result) {
      if (!surface?.acceptResult(result))
        throw new Error('Page Toolbox Shadow control result was rejected')
    },
    onDispose(reason) {
      surface?.dispose()
      surface = null
      tools?.dispose(reason)
      tools = null
    },
  })
  scope[runtimeKey] = runtime
  runtime.start()
}
