import type { PageToolboxManagementRequest } from '..'
import {
  createPageToolboxManagementResponse,
  PageToolboxClient,
  PageToolboxClientError,
} from '..'

const preparation = Object.freeze({
  token: 'a'.repeat(48),
  exactOrigin: 'https://alpha.example',
  originPattern: 'https://alpha.example/*',
  expiresAt: '2026-09-02T00:01:00.000Z',
})

describe('page Toolbox trusted management client', () => {
  it('uses only the fixed management operations and the prepared exact origin permission', async () => {
    const messages: PageToolboxManagementRequest[] = []
    const transport = {
      sendMessage: vi.fn(async (message: PageToolboxManagementRequest) => {
        messages.push(structuredClone(message))
        const result = message.type === 'PAGE_TOOLBOX_CONTROL_STATUS'
          ? {
              ok: true as const,
              operation: 'control-status' as const,
              snapshot: {
                schemaVersion: 1 as const,
                revision: 0,
                pageTitle: 'Alpha',
                exactOrigin: 'https://alpha.example',
                access: 'site-unapproved' as const,
                siteSettings: null,
              },
            }
          : message.type === 'PAGE_TOOLBOX_PREPARE_CURRENT_SITE'
            ? { ok: true as const, operation: 'prepare' as const, preparation }
            : message.type === 'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE'
              ? { ok: true as const, operation: 'confirm' as const, changed: true, injected: true, preparation }
              : message.type === 'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS'
                ? {
                    ok: true as const,
                    operation: 'replace-site-settings' as const,
                    changed: true,
                    synchronized: 0,
                    snapshot: {
                      schemaVersion: 1 as const,
                      revision: 1,
                      pageTitle: 'Alpha',
                      exactOrigin: 'https://alpha.example',
                      access: 'ready' as const,
                      siteSettings: message.siteSettings,
                    },
                  }
                : { ok: true as const, operation: 'revoke' as const, changed: true, releasedOrigin: true }
        return createPageToolboxManagementResponse(message.type, result)
      }),
    }
    const permissions = { request: vi.fn(async () => true) }
    const client = new PageToolboxClient(transport, permissions)

    await client.status()
    const prepared = await client.prepare()
    if (!prepared.ok || prepared.operation !== 'prepare')
      throw new Error('expected preparation')
    await client.confirm(prepared.preparation)
    await client.replace(0, { enabledToolIds: [], toolSettings: {} })
    await client.revoke()

    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://alpha.example/*'] })
    expect(messages.map(message => message.type)).toEqual([
      'PAGE_TOOLBOX_CONTROL_STATUS',
      'PAGE_TOOLBOX_PREPARE_CURRENT_SITE',
      'PAGE_TOOLBOX_CONFIRM_CURRENT_SITE',
      'PAGE_TOOLBOX_REPLACE_CURRENT_SITE_SETTINGS',
      'PAGE_TOOLBOX_REVOKE_CURRENT_SITE',
    ])
    expect(messages.every(message => !('origin' in message) && !('tabId' in message) && !('moduleId' in message))).toBe(true)
  })

  it('fails closed on denied permission, transport failure and mismatched responses', async () => {
    const guardedPermissions = { request: vi.fn(async () => true) }
    const guarded = new PageToolboxClient(
      { sendMessage: vi.fn() },
      guardedPermissions,
    )
    await expect(guarded.confirm({
      ...preparation,
      originPattern: 'https://evil.example/*',
    })).rejects.toEqual(new PageToolboxClientError('invalid-response'))
    expect(guardedPermissions.request).not.toHaveBeenCalled()

    const denied = new PageToolboxClient(
      { sendMessage: vi.fn() },
      { request: vi.fn(async () => false) },
    )
    await expect(denied.confirm(preparation)).rejects.toEqual(new PageToolboxClientError('permission-denied'))

    const transportFailure = new PageToolboxClient(
      { sendMessage: vi.fn(async () => { throw new Error('offline') }) },
      { request: vi.fn(async () => true) },
    )
    await expect(transportFailure.status()).rejects.toEqual(new PageToolboxClientError('transport-error'))

    const mismatch = new PageToolboxClient(
      {
        sendMessage: vi.fn(async () => createPageToolboxManagementResponse(
          'PAGE_TOOLBOX_STATUS',
          { ok: true, operation: 'status', snapshot: { approvedOrigins: [], sessions: [] } },
        )),
      },
      { request: vi.fn(async () => true) },
    )
    await expect(mismatch.status()).rejects.toEqual(new PageToolboxClientError('invalid-response'))
  })
})
