import { useWebExtensionStorage } from '~/composables/useWebExtensionStorage'

export const storageDemo = useWebExtensionStorage('webext-demo', 'Storage Demo')
export const clashSecret = useWebExtensionStorage('clash-secret', '')
export const clashHost = useWebExtensionStorage('clash-host', 'localhost')
export const clashPort = useWebExtensionStorage('clash-port', '9090')

export const customHeader = useWebExtensionStorage('custom-header', [
  {
    name: 'Example-Header',
    value: 'example-val11ue',
    enabled: true,
  },
  {
    name: 'Zodance-Version',
    value: 'changeme',
    enabled: false,
  },
])
