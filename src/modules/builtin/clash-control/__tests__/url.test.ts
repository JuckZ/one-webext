import { normalizeClashControllerUrl } from '../url'

describe('clash controller URL normalization', () => {
  it.each([
    ['http://localhost:9090', 'http://localhost:9090', 'http://localhost:9090/*'],
    [' HTTPS://LOCALHOST:443/ ', 'https://localhost', 'https://localhost/*'],
    ['http://127.0.0.1:9090/', 'http://127.0.0.1:9090', 'http://127.0.0.1:9090/*'],
    ['http://127.255.10.9:9090', 'http://127.255.10.9:9090', 'http://127.255.10.9:9090/*'],
    ['http://[::1]:9090', 'http://[::1]:9090', 'http://[::1]:9090/*'],
  ])('normalizes the explicit loopback origin %s', (value, controllerOrigin, originPattern) => {
    expect(normalizeClashControllerUrl(value)).toEqual({
      ok: true,
      controller: { controllerOrigin, originPattern },
    })
  })

  it.each([
    'http://192.168.1.2:9090',
    'https://controller.example:9090',
    'http://[::ffff:127.0.0.1]:9090',
  ])('rejects a non-loopback controller %s', (value) => {
    expect(normalizeClashControllerUrl(value)).toEqual({
      ok: false,
      reason: 'controller-not-loopback',
    })
  })

  it.each([
    '',
    'not-a-url',
    'ftp://127.0.0.1:9090',
    'http://user:secret@127.0.0.1:9090',
    'http://127.0.0.1:9090/version',
    'http://127.0.0.1:9090/?secret=value',
    'http://127.0.0.1:9090/#token',
  ])('rejects a URL that is not a pure HTTP(S) origin: %s', (value) => {
    expect(normalizeClashControllerUrl(value)).toEqual({
      ok: false,
      reason: 'invalid-controller-url',
    })
  })
})
