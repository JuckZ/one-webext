import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  encodeLengthPrefixedJson,
  firefoxAddonOrigin,
  FirefoxProcessLog,
  LengthPrefixedJsonDecoder,
  terminateProcessGroup,
  validateFirefoxArtifactManifest,
} from '../../../scripts/verify-firefox-page-toolbox'

describe('firefox Page Toolbox gate helpers', () => {
  it('decodes split and coalesced length-prefixed Unicode JSON without character-length confusion', () => {
    const decoder = new LengthPrefixedJsonDecoder()
    const first = encodeLengthPrefixedJson({ text: '侧栏' })
    const second = encodeLengthPrefixedJson([1, 2, null, { ok: true }])
    expect(decoder.push(first.subarray(0, 4))).toEqual([])
    expect(decoder.push(Buffer.concat([first.subarray(4), second]))).toEqual([
      { text: '侧栏' },
      [1, 2, null, { ok: true }],
    ])
    expect(() => decoder.push('x:{}')).toThrow('Invalid length-prefixed JSON header')
  })

  it('extracts one stable RDP port from chunked web-ext output and rejects replacement', () => {
    const log = new FirefoxProcessLog()
    expect(log.push('Firefox args: -start-debugger-')).toBeNull()
    expect(log.push('server 37681 -foreground\n')).toBe(37681)
    expect(log.port).toBe(37681)
    expect(() => log.push('Firefox args: -start-debugger-server 37682\n')).toThrow('conflicting RDP ports')
  })

  it('accepts only the temporary expected add-on and a manifest-root moz-extension origin', () => {
    expect(firefoxAddonOrigin({
      addons: [{
        id: 'one-web@juckz.local',
        manifestURL: 'moz-extension://alpha/manifest.json',
        temporarilyInstalled: true,
      }],
    })).toBe('moz-extension://alpha')
    expect(firefoxAddonOrigin({
      addons: [{
        id: 'one-web@juckz.local',
        manifestURL: 'https://attacker.example/manifest.json',
        temporarilyInstalled: true,
      }],
    })).toBeNull()
    expect(firefoxAddonOrigin({
      addons: [{
        id: 'one-web@juckz.local',
        manifestURL: 'moz-extension://alpha/manifest.json',
        temporarilyInstalled: false,
      }],
    })).toBeNull()
  })

  it('locks the Firefox sidebar and least-privilege manifest boundary', () => {
    const manifest = {
      browser_specific_settings: { gecko: { id: 'one-web@juckz.local' } },
      manifest_version: 3,
      optional_host_permissions: ['https://*/*', 'http://*/*'],
      permissions: ['activeTab', 'scripting', 'storage', 'tabs'],
      sidebar_action: { default_panel: 'dist/sidebar/index.html' },
    }
    expect(validateFirefoxArtifactManifest(manifest)).toBe(true)
    expect(() => validateFirefoxArtifactManifest({ ...manifest, side_panel: {} })).toThrow('production sidebar boundary')
    expect(() => validateFirefoxArtifactManifest({ ...manifest, permissions: ['<all_urls>'] })).toThrow('permission boundary')
  })

  it('targets only the explicit child process group and escalates cleanup deterministically', async () => {
    const kill = vi.fn()
    const wait = vi.fn(async () => {})
    await expect(terminateProcessGroup(417, kill, wait)).resolves.toEqual(['SIGTERM', 'SIGKILL'])
    expect(kill.mock.calls).toEqual([[-417, 'SIGTERM'], [-417, 'SIGKILL']])
    expect(wait).toHaveBeenCalledWith(750)

    const missing = vi.fn(() => {
      const error = new Error('missing') as NodeJS.ErrnoException
      error.code = 'ESRCH'
      throw error
    })
    await expect(terminateProcessGroup(418, missing, wait)).resolves.toEqual([])
    await expect(terminateProcessGroup(undefined, kill, wait)).resolves.toEqual([])
  })
})
