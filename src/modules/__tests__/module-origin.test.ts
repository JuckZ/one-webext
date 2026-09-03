import { getModuleOriginPattern, parseModuleSourceUrl } from '../module-origin'

describe('module origin permissions', () => {
  it('creates exact HTTPS and local-development origin patterns', () => {
    expect(getModuleOriginPattern('https://modules.example:8443/.well-known/module.json?channel=stable'))
      .toBe('https://modules.example:8443/*')
    expect(getModuleOriginPattern('http://localhost:4747/module.json')).toBe('http://localhost:4747/*')
    expect(getModuleOriginPattern('http://127.0.0.1:4747/module.json')).toBe('http://127.0.0.1:4747/*')
  })

  it('rejects credentials, fragments, relative URLs and non-local cleartext origins', () => {
    expect(parseModuleSourceUrl('http://modules.example/module.json')).toBeNull()
    expect(parseModuleSourceUrl('https://user:secret@modules.example/module.json')).toBeNull()
    expect(parseModuleSourceUrl('https://modules.example/module.json#changed')).toBeNull()
    expect(parseModuleSourceUrl('/module.json')).toBeNull()
    expect(parseModuleSourceUrl('http://localhost.evil.example/module.json')).toBeNull()
  })
})
