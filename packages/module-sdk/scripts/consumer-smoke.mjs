import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const sdk = await import('@oneweb/module-sdk')
const runtime = await import('@oneweb/module-sdk/runtime')
const capabilityRpc = await import('@oneweb/module-sdk/capability-rpc')
const capabilityClient = await import('@oneweb/module-sdk/capability-client')
const storageModule = await import('@oneweb/module-sdk/storage-module')
const require = createRequire(import.meta.url)
const contract = require('@oneweb/module-sdk/contract.json')

assert.equal(typeof sdk.validateRemoteFrameModuleManifest, 'function')
assert.equal(typeof sdk.createRemoteFrameRuntimeClient, 'function')
assert.equal(typeof sdk.projectRemoteFrameRuntimeInitFields, 'function')
assert.equal(runtime.createRemoteFrameRuntimeClient, sdk.createRemoteFrameRuntimeClient)
assert.equal(capabilityRpc.ONEWEB_CAPABILITY_RPC_PROTOCOL, 'oneweb.capability')
assert.equal(typeof capabilityRpc.defineCapabilityRpcCatalog, 'function')
assert.equal(typeof capabilityRpc.reduceCapabilityRpcLifecycle, 'function')
assert.equal(typeof capabilityClient.createCapabilityRpcClient, 'function')
assert.equal(capabilityClient.createCapabilityRpcClient, sdk.createCapabilityRpcClient)
assert.equal(storageModule.STORAGE_MODULE_CAPABILITY, 'storage.module')
assert.deepEqual(storageModule.storageModuleOperations, ['read', 'replace', 'clear'])
assert.equal(storageModule.reduceStorageModuleState, sdk.reduceStorageModuleState)
assert.equal(contract.protocol.name, sdk.ONEWEB_MODULE_PROTOCOL)

for (const privateSubpath of [
  '@oneweb/module-sdk/runtime-state',
  '@oneweb/module-sdk/capability-rpc/internal',
  '@oneweb/module-sdk/storage-module/internal',
  '@oneweb/module-sdk/src/catalog.js',
]) {
  await assert.rejects(import(privateSubpath), error => error?.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
}
