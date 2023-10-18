import { useStorageLocal } from '~/composables/useStorageLocal';

export const storageDemo = useStorageLocal('webext-demo', 'Storage Demo');
export const clashSecret = useStorageLocal('clash-secret', '');
export const clashHost = useStorageLocal('clash-host', 'localhost');
export const clashPort = useStorageLocal('clash-port', '9090');
