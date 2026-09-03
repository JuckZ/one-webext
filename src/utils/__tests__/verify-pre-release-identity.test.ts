import { describe, expect, it } from 'vitest'
import {
  findForbiddenRuntimeMarker,
  validateOneWebIdentity,
  validateRuntimeTexts,
} from '../../../scripts/verify-pre-release-identity'

const packageManifest = {
  displayName: 'OneWeb',
  homepage: 'https://github.com/JuckZ/one-web',
  name: 'one-web',
  version: '0.1.0',
}

const extensionManifest = {
  browser_specific_settings: {
    gecko: { id: 'one-web@juckz.local' },
  },
  name: 'OneWeb',
  version: '0.1.0',
}

describe('oneWeb pre-release identity gate', () => {
  it('accepts only the canonical root and Firefox identities', () => {
    expect(validateOneWebIdentity(packageManifest, extensionManifest)).toEqual({
      displayName: 'OneWeb',
      firefoxId: 'one-web@juckz.local',
      homepage: 'https://github.com/JuckZ/one-web',
      packageName: 'one-web',
      version: '0.1.0',
    })
    expect(() => validateOneWebIdentity({ ...packageManifest, name: 'oneweb' }, extensionManifest))
      .toThrow('Root package identity')
    expect(() => validateOneWebIdentity({ ...packageManifest, version: '0.0.1' }, extensionManifest))
      .toThrow('canonical release candidate')
    expect(() => validateOneWebIdentity({ ...packageManifest, homepage: 'https://example.test' }, extensionManifest))
      .toThrow('canonical OneWeb repository')
    expect(() => validateOneWebIdentity(packageManifest, {
      ...extensionManifest,
      browser_specific_settings: { gecko: { id: 'oneweb@juckz.local' } },
    })).toThrow('Firefox add-on identity')
  })

  it('rejects legacy runtime, remote-code and private-site markers', () => {
    const cases = [
      'GM_xmlhttpRequest({})',
      'eval(remoteText)',
      'https://unpkg.com/spacingjs',
      'https://cdn.jsdelivr.net/npm/vue',
      'http://10.1.2.3/private',
      'vite-plugin-monkey',
      'one-tampermonkey',
      'file:../one-web',
      '/home/example/Projects/one-web',
      String.raw`C:\Users\example\one-web`,
    ]
    for (const text of cases)
      expect(findForbiddenRuntimeMarker('runtime.js', text)).not.toBeNull()
  })

  it('accepts reviewed packaged runtime text and reports the scanned count', () => {
    const entries = [
      { filePath: 'tool.ts', text: 'export const tool = "OneWeb"' },
      { filePath: 'bundle.js', text: 'addEventListener("copy", dispose)' },
    ]
    expect(validateRuntimeTexts(entries)).toBe(2)
    expect(entries).toEqual([
      { filePath: 'tool.ts', text: 'export const tool = "OneWeb"' },
      { filePath: 'bundle.js', text: 'addEventListener("copy", dispose)' },
    ])
  })

  it('reports the exact production file and rejected boundary', () => {
    expect(() => validateRuntimeTexts([
      { filePath: 'dist/pageToolbox.js', text: 'window.eval(payload)' },
    ])).toThrow('Legacy runtime marker rejected (dynamic eval): dist/pageToolbox.js')
  })
})
