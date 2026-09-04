import type { RemoteFrameModuleManifest } from '@oneweb/module-sdk'
import type { AddressInfo } from 'node:net'
import type { Manifest } from 'webextension-polyfill'
import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import {
  defineRemoteFrameModuleManifest,
  ONEWEB_MODULE_MANIFEST_VERSION,
  ONEWEB_MODULE_PROTOCOL,
  ONEWEB_MODULE_PROTOCOL_VERSION,
  REMOTE_FRAME_RUNTIME,
} from '@oneweb/module-sdk'
import { test as base, type BrowserContext, chromium } from '@playwright/test'
import fs from 'fs-extra'
import ts from 'typescript'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const sdkRuntimeFiles = new Set([
  'capability-client.js',
  'capability-rpc.js',
  'catalog.js',
  'index.js',
  'manifest.js',
  'protocol.js',
  'runtime-client.js',
  'runtime-state.js',
  'storage-module.js',
])

export const extensionPath = process.env.EXTENSION_PATH || path.join(currentDir, '../artifacts/chromium')

interface ExtensionFixtures {
  alistFixture: OpenListFixture
  bookmarkProbeFixture: BookmarkProbeFixture
  clashControllerFixture: ClashControllerFixture
  context: BrowserContext
  extensionId: string
  moduleFixture: RemoteModuleFixture
  moduleFixtures: {
    primary: RemoteModuleFixture
    secondary: RemoteModuleFixture
    storagePeer: RemoteModuleFixture
  }
  openListFixture: OpenListFixture
}

export interface OpenListFixture {
  kind: 'openlist' | 'alist'
  origin: string
  token: string
  requests: {
    me: number
    tools: number
    add: number
    activeAdds: number
    maximumAdds: number
    unauthorized: number
    undone: number
    done: number
    cancel: number
    clientIds: string[]
    toolPaths: Array<string | null>
  }
  tools: string[]
}

export interface ClashControllerFixture {
  origin: string
  secret: string
  requests: {
    version: number
    configs: number
    proxies: number
    unauthorized: number
  }
  switches: {
    attempts: number
    successful: number
    lastPath: string | null
    lastBody: unknown
  }
  lifecycle: {
    pendingPreflights: number
    abortedPreflights: number
    ambiguousWrites: number
    blockNextPreflight: () => void
    releaseBlockedPreflight: () => void
    applyNextWriteWithoutResponse: () => void
  }
  proxyGroupName: string
  setMode: (_mode: string) => void
  setSelectedNode: (_nodeName: string) => void
}

export interface BookmarkProbeFixture {
  origin: string
  urls: {
    ok: string
    error: string
    timeout: string
    failure: string
    slow: (_index: number) => string
  }
  requests: {
    active: number
    maximum: number
    aborted: number
  }
}

export interface RemoteModuleFixture {
  manifestUrl: string
  manifest: RemoteFrameModuleManifest
  requests: { count: number }
  setManifest: (_manifest: RemoteFrameModuleManifest) => void
}

interface RemoteModuleFixtureDefinition {
  id: string
  name: string
  description: string
  matches: RemoteFrameModuleManifest['matches']
  contexts: RemoteFrameModuleManifest['contexts']
  contextFields: RemoteFrameModuleManifest['context_fields']
  capabilities: RemoteFrameModuleManifest['capabilities']
}

function renderRepoLensFixture(parentOrigin: string) {
  const script = [
    'import { createRemoteFrameRuntimeClient } from "/oneweb-sdk/runtime-client.js";',
    `const parentOrigin=${JSON.stringify(parentOrigin)};`,
    'let currentContext=null;',
    'const waiting=document.querySelector("#waiting"),content=document.querySelector("#content"),summary=document.querySelector("#summary"),state=document.querySelector("#state-text");',
    'function clear(){currentContext=null;waiting.hidden=false;content.hidden=true}',
    'function show(value){currentContext=value;waiting.hidden=true;content.hidden=false;summary.hidden=false;document.querySelector("#repo").textContent=String(value.repo||"");document.querySelector("#meta").textContent=String(value.pageType||"")+" · 仅同步仓库标识与 URL";state.textContent="已显示缓存摘要"}',
    'window.__onewebRuntimeContextCount=0;',
    'const client=createRemoteFrameRuntimeClient({moduleId:"dev.juck.repolens",parentOrigin,onContextUpdate(update){window.__onewebRuntimeContextCount++;const value=update.contexts&&update.contexts["github.repository"];value&&typeof value==="object"?show(value):clear()}});',
    'window.__onewebRuntimeClient=client;',
    'window.addEventListener("pagehide",()=>client.destroy(),{once:true});',
    'document.querySelector("#analyze").addEventListener("click",()=>{state.textContent="深度分析完成"});',
    'client.start();',
  ].join('')
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>RepoLens E2E fixture</title>',
    '<style>*{box-sizing:border-box}html,body{margin:0;max-width:100%;overflow-x:hidden;font:14px system-ui}.app{padding:14px}.card{margin-top:10px;padding:12px;border:1px solid #dfe6f0;border-radius:12px}#repo{font-size:20px;font-weight:700}#meta,#state-text{margin-top:6px}button{margin-top:12px;padding:8px 12px}</style>',
    '</head><body><main class="app" data-testid="embed-app">',
    '<section id="waiting" class="card">等待 GitHub 仓库</section>',
    '<section id="content" hidden><div class="card"><div id="repo"></div><div id="meta"></div><div id="state-text"></div></div>',
    '<div id="summary" class="card" hidden>缓存摘要</div><button id="analyze" type="button">深度分析</button></section>',
    `</main><script type="module">${script}</script></body></html>`,
  ].join('')
}

function renderStorageModuleFixture(parentOrigin: string, moduleId: string, label: string) {
  const script = [
    'import { createRemoteFrameRuntimeClient } from "/oneweb-sdk/runtime-client.js";',
    'import { storageModuleCapabilityCatalog } from "/oneweb-sdk/storage-module.js";',
    `const parentOrigin=${JSON.stringify(parentOrigin)},moduleId=${JSON.stringify(moduleId)},label=${JSON.stringify(label)};`,
    'const state=document.querySelector("#state"),result=document.querySelector("#result"),moduleLabel=document.querySelector("#module-label");',
    'const client=createRemoteFrameRuntimeClient({moduleId,parentOrigin,capabilityRpcCatalog:storageModuleCapabilityCatalog,onContextUpdate(){}});',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'const errorCode=error=>String(error&&error.code||"UNKNOWN_ERROR");',
    'async function waitConnected(){for(let attempt=0;attempt<500;attempt++){if(client.status==="connected")return;await delay(10)}throw new Error("storage client did not connect")}',
    'function show(value){result.textContent=JSON.stringify(value);return value}',
    'async function invoke(operation,payload){await waitConnected();try{const handle=client.request("storage.module",operation,payload);return show({ok:true,result:await handle.result,requestId:handle.requestId})}catch(error){return show({ok:false,code:errorCode(error)})}}',
    'const read=()=>invoke("read",null);',
    'const replace=(expectedRevision,document)=>invoke("replace",{expectedRevision,document});',
    'const clear=expectedRevision=>invoke("clear",{expectedRevision});',
    'window.__storageModuleFixture={read,replace,clear,info:()=>({moduleId,status:client.status,extensionRuntime:Boolean(globalThis.chrome&&globalThis.chrome.runtime)})};',
    'window.addEventListener("pagehide",()=>client.destroy(),{once:true});',
    'moduleLabel.textContent=label;',
    'client.start();',
    'void waitConnected().then(()=>{state.textContent="connected"},error=>{state.textContent=String(error&&error.message||"connect-failed")});',
  ].join('')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>storage.module fixture</title></head><body>',
    '<h1 id="module-label"></h1><output id="state">connecting</output><pre id="result">waiting</pre>',
    `<script type="module">${script}</script></body></html>`,
  ].join('')
}

function renderCapabilityRpcFrame(parentOrigin: string) {
  const script = [
    'import { capabilityRpcSchema, createRemoteFrameRuntimeClient, defineCapabilityRpcCatalog } from "/oneweb-sdk/index.js";',
    `const parentOrigin=${JSON.stringify(parentOrigin)};`,
    'const catalog=defineCapabilityRpcCatalog({"conformance.echo":{operations:{echo:{request:capabilityRpcSchema.object({text:capabilityRpcSchema.string({maximumLength:64})}),result:capabilityRpcSchema.object({echoed:capabilityRpcSchema.string({maximumLength:64})})},sum:{request:capabilityRpcSchema.object({values:capabilityRpcSchema.array(capabilityRpcSchema.number(),{maximumItems:8})}),result:capabilityRpcSchema.object({total:capabilityRpcSchema.number()})}}}});',
    'const resultState=document.querySelector("#rpc-result"),cancelState=document.querySelector("#rpc-cancel"),errorState=document.querySelector("#rpc-error");',
    'const client=createRemoteFrameRuntimeClient({moduleId:"dev.oneweb.conformance.rpc-frame",parentOrigin,capabilityRpcCatalog:catalog,onContextUpdate(){}});',
    'window.__onewebRpcClient=client;',
    'window.addEventListener("pagehide",()=>client.destroy(),{once:true});',
    'client.start();',
    'async function runRpc(){try{const success=client.request("conformance.echo","echo",{text:"chromium"});document.body.dataset.requestId=success.requestId;resultState.textContent=(await success.result).echoed;const cancelled=client.request("conformance.echo","echo",{text:"cancel-me"});document.body.dataset.cancelRequestId=cancelled.requestId;cancelled.cancel();try{await cancelled.result;cancelState.textContent="unexpected-result"}catch(error){cancelState.textContent=String(error&&error.code||"unknown-cancel")}const unavailable=client.request("conformance.echo","sum",{values:[1,2]});try{await unavailable.result;errorState.textContent="unexpected-result"}catch(error){errorState.textContent=String(error&&error.code||"unknown-error")}}catch(error){errorState.textContent=String(error&&error.code||"request-failed")}}',
    'const wait=setInterval(()=>{if(client.status!=="connected")return;clearInterval(wait);setTimeout(runRpc,0)},5);',
  ].join('')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>RPC frame</title></head>',
    '<body><output id="rpc-result">connecting</output><output id="rpc-cancel">connecting</output><output id="rpc-error">connecting</output>',
    `<script type="module">${script}</script></body></html>`,
  ].join('')
}

function renderCapabilityRpcHost(origin: string) {
  const script = [
    'import { capabilityRpcSchema, createModuleEnvelope, defineCapabilityRpcCatalog } from "/oneweb-sdk/index.js";',
    'import { createModuleCapabilityDispatcher } from "/capability-dispatcher.js";',
    'const moduleId="dev.oneweb.conformance.rpc-frame";',
    'const catalog=defineCapabilityRpcCatalog({"conformance.echo":{operations:{echo:{request:capabilityRpcSchema.object({text:capabilityRpcSchema.string({maximumLength:64})}),result:capabilityRpcSchema.object({echoed:capabilityRpcSchema.string({maximumLength:64})})},sum:{request:capabilityRpcSchema.object({values:capabilityRpcSchema.array(capabilityRpcSchema.number(),{maximumItems:8})}),result:capabilityRpcSchema.object({total:capabilityRpcSchema.number()})}}}});',
    'const frame=document.querySelector("#rpc-frame"),generation=document.querySelector("#rpc-generation"),status=document.querySelector("#host-state"),cancelled=document.querySelector("#host-cancelled");',
    'const handlers={"conformance.echo":{echo:({payload,signal})=>{if(payload.text!=="cancel-me")return {echoed:payload.text};return new Promise(resolve=>signal.addEventListener("abort",()=>{cancelled.textContent="aborted";resolve({echoed:"late"})},{once:true}))}}};',
    'let currentPort=null,currentDispatcher=null,currentGeneration=0;',
    'function cleanup(){currentDispatcher&&currentDispatcher.destroy();currentDispatcher=null;if(currentPort){try{currentPort.close()}catch{}}currentPort=null}',
    'window.addEventListener("message",event=>{const data=event.data;if(event.source!==frame.contentWindow||event.origin!==location.origin||!data||data.protocol!=="oneweb.module"||data.version!==1||data.moduleId!==moduleId||data.type!=="MODULE_HELLO"||typeof data.challenge!=="string")return;cleanup();currentGeneration++;const sessionId="session_"+Array.from(crypto.getRandomValues(new Uint8Array(24)),value=>value.toString(16).padStart(2,"0")).join("");const channel=new MessageChannel();currentPort=channel.port1;currentDispatcher=createModuleCapabilityDispatcher({binding:{moduleId,sessionId,generation:currentGeneration},catalog,manifestCapabilities:["conformance.echo"],grantedCapabilities:["conformance.echo"],handlers,port:currentPort});currentPort.addEventListener("message",portEvent=>{const message=portEvent.data;if(message&&message.protocol==="oneweb.module"&&message.version===1&&message.moduleId===moduleId&&message.type==="MODULE_READY"&&message.sessionNonce===sessionId){status.textContent="ready";return}currentDispatcher&&currentDispatcher.dispatch(message)});currentPort.start();generation.textContent=String(currentGeneration);frame.contentWindow.postMessage(createModuleEnvelope(moduleId,"MODULE_INIT",{challenge:data.challenge,sessionNonce:sessionId,capabilityGeneration:currentGeneration}),location.origin,[channel.port2])});',
    'document.querySelector("#reload-rpc").addEventListener("click",()=>{status.textContent="reloading";cancelled.textContent="waiting";frame.contentWindow.location.reload()});',
    'window.addEventListener("pagehide",cleanup,{once:true});',
  ].join('')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>RPC host</title></head><body>',
    '<output id="host-state">waiting</output><output id="rpc-generation">0</output><output id="host-cancelled">waiting</output>',
    '<button id="reload-rpc" type="button">Reload RPC frame</button>',
    `<iframe id="rpc-frame" src="${origin}/rpc-frame?parentOrigin=${encodeURIComponent(origin)}"></iframe>`,
    `<script type="module">${script}</script></body></html>`,
  ].join('')
}

function renderPageToolboxFixture() {
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Page Toolbox PoC</title></head>',
    '<body contenteditable="false"><input id="toolbox-password" type="password" value="page-local-secret">',
    '<input id="toolbox-disabled-password" type="password" disabled value="disabled-secret">',
    '<p id="toolbox-copy-target">untrusted &lt;script&gt;page text&lt;/script&gt;</p>',
    '<a id="send-openlist-signed" href="https://cdn.example/resource?sig=a%2Bb&amp;part=1#drop" title="&lt;img data-discovery-xss src=x&gt;">signed resource</a>',
    '<a id="send-openlist-local" href="http://127.1/private">local resource</a>',
    '<a id="send-openlist-script" href="javascript:void(0)">rejected script</a>',
    '<video id="send-openlist-video" src="https://cdn.example/video.mp4"></video>',
    '<iframe id="toolbox-child-frame" src="/journal-page-toolbox-frame"></iframe>',
    '<script>',
    'window.__pageToolboxFixture={copyBlocks:0,contextBlocks:0,selectionBlocks:0};',
    'const fixture=window.__pageToolboxFixture;',
    'document.body.addEventListener("copy",event=>{fixture.copyBlocks++;event.preventDefault()});',
    'document.body.addEventListener("contextmenu",event=>{fixture.contextBlocks++;event.preventDefault()});',
    'document.body.addEventListener("selectstart",event=>{fixture.selectionBlocks++;event.preventDefault()});',
    '</script></body></html>',
  ].join('')
}

function renderCapabilityRpcIsolationFrame(parentOrigin: string, moduleId: string, label: string) {
  const script = [
    'import { capabilityRpcSchema, createRemoteFrameRuntimeClient, defineCapabilityRpcCatalog } from "/oneweb-sdk/index.js";',
    `const parentOrigin=${JSON.stringify(parentOrigin)},moduleId=${JSON.stringify(moduleId)},label=${JSON.stringify(label)};`,
    'const catalog=defineCapabilityRpcCatalog({"conformance.echo":{operations:{echo:{request:capabilityRpcSchema.object({text:capabilityRpcSchema.string({maximumLength:64})}),result:capabilityRpcSchema.object({echoed:capabilityRpcSchema.string({maximumLength:64})})},sum:{request:capabilityRpcSchema.object({values:capabilityRpcSchema.array(capabilityRpcSchema.number(),{maximumItems:8})}),result:capabilityRpcSchema.object({total:capabilityRpcSchema.number()})}}}});',
    'const state=document.querySelector("#state"),success=document.querySelector("#success"),failure=document.querySelector("#failure"),cancelled=document.querySelector("#cancelled"),flood=document.querySelector("#flood");',
    'const client=createRemoteFrameRuntimeClient({moduleId,parentOrigin,capabilityRpcCatalog:catalog,onContextUpdate(){}});',
    'let held=null;',
    'const errorCode=error=>String(error&&error.code||"UNKNOWN_ERROR");',
    'const delay=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));',
    'async function waitConnected(){for(let attempt=0;attempt<500;attempt++){if(client.status==="connected")return;await delay(10)}throw new Error("RPC client did not connect")}',
    'async function runSuccess(marker){await waitConnected();const handle=client.request("conformance.echo","echo",{text:marker});document.body.dataset.requestId=handle.requestId;const result=await handle.result;success.textContent=result.echoed;return {requestId:handle.requestId,result:result.echoed}}',
    'async function runFailure(){await waitConnected();const handle=client.request("conformance.echo","echo",{text:"fail"});try{await handle.result;failure.textContent="unexpected-result"}catch(error){failure.textContent=errorCode(error)}return failure.textContent}',
    'async function runCancel(){await waitConnected();const handle=client.request("conformance.echo","echo",{text:"hold-cancel"});const outcome=handle.result.then(()=>"unexpected-result",error=>errorCode(error));await delay(50);handle.cancel();cancelled.textContent=await outcome;return cancelled.textContent}',
    'async function runFlood(){await waitConnected();const handles=Array.from({length:16},(_,index)=>client.request("conformance.echo","echo",{text:"hold-flood-"+index}));const outcomes=handles.map(handle=>handle.result.then(()=>"unexpected-result",error=>errorCode(error)));await delay(50);let overflow="unexpected-result";try{client.request("conformance.echo","echo",{text:"overflow"})}catch(error){overflow=errorCode(error)}for(const handle of handles)handle.cancel();await Promise.all(outcomes);flood.textContent=overflow;return overflow}',
    'async function beginHold(marker="hold-forged"){await waitConnected();held=client.request("conformance.echo","echo",{text:marker});void held.result.catch(()=>{});document.body.dataset.heldRequestId=held.requestId;return held.requestId}',
    'async function heldStatus(){if(!held)return "missing";return Promise.race([held.result.then(()=>"settled",()=>"settled"),delay(75).then(()=>"pending")])}',
    'async function cancelHeld(){if(!held)return "missing";const current=held;const outcome=current.result.then(()=>"unexpected-result",error=>errorCode(error));current.cancel();held=null;return outcome}',
    'window.__rpcFixture={runSuccess,runFailure,runCancel,runFlood,beginHold,heldStatus,cancelHeld,info:()=>({moduleId,status:client.status,requestId:document.body.dataset.requestId||null})};',
    'window.addEventListener("pagehide",()=>client.destroy(),{once:true});',
    'document.querySelector("#label").textContent=label;',
    'client.start();',
    'void waitConnected().then(()=>{state.textContent="connected"},error=>{state.textContent=String(error&&error.message||"connect-failed")});',
  ].join('')
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>RPC isolation frame</title></head><body>',
    '<h1 id="label"></h1><output id="state">connecting</output>',
    '<output id="success">waiting</output><output id="failure">waiting</output>',
    '<output id="cancelled">waiting</output><output id="flood">waiting</output>',
    `<script type="module">${script}</script></body></html>`,
  ].join('')
}

function renderCapabilityRpcIsolationHost(moduleFixtures: ExtensionFixtures['moduleFixtures']) {
  const definitions = {
    alpha: {
      moduleId: moduleFixtures.primary.manifest.id,
      origin: new URL(moduleFixtures.primary.manifestUrl).origin,
    },
    beta: {
      moduleId: moduleFixtures.secondary.manifest.id,
      origin: new URL(moduleFixtures.secondary.manifestUrl).origin,
    },
  }
  const script = [
    'import { capabilityRpcSchema, createModuleEnvelope, defineCapabilityRpcCatalog } from "/oneweb-sdk/index.js";',
    'import { createModuleCapabilityDispatcher } from "/capability-dispatcher.js";',
    `const definitions=${JSON.stringify(definitions)};`,
    'const catalog=defineCapabilityRpcCatalog({"conformance.echo":{operations:{echo:{request:capabilityRpcSchema.object({text:capabilityRpcSchema.string({maximumLength:64})}),result:capabilityRpcSchema.object({echoed:capabilityRpcSchema.string({maximumLength:64})})},sum:{request:capabilityRpcSchema.object({values:capabilityRpcSchema.array(capabilityRpcSchema.number(),{maximumItems:8})}),result:capabilityRpcSchema.object({total:capabilityRpcSchema.number()})}}}});',
    'const randomSession=()=>"session_"+Array.from(crypto.getRandomValues(new Uint8Array(24)),value=>value.toString(16).padStart(2,"0")).join("");',
    'const slots=new Map(Object.entries(definitions).map(([key,definition])=>[key,{key,...definition,frame:document.querySelector("#rpc-"+key),state:document.querySelector("#"+key+"-state"),generationOutput:document.querySelector("#"+key+"-generation"),abortOutput:document.querySelector("#"+key+"-aborts"),generation:0,aborts:0,port:null,dispatcher:null,lastRequest:null,staleRequest:null}]));',
    'function cleanup(slot,preserve=true){if(preserve&&slot.lastRequest)slot.staleRequest=structuredClone(slot.lastRequest);slot.lastRequest=null;if(slot.dispatcher)slot.dispatcher.destroy();slot.dispatcher=null;if(slot.port){try{slot.port.close()}catch{}}slot.port=null}',
    'function handlersFor(slot){return {"conformance.echo":{echo:({payload,signal})=>{if(payload.text==="fail")throw new Error("fixture failure");if(payload.text.startsWith("hold"))return new Promise(resolve=>signal.addEventListener("abort",()=>{slot.aborts++;slot.abortOutput.textContent=String(slot.aborts);resolve({echoed:"late"})},{once:true}));return {echoed:payload.text}},sum:({payload})=>({total:payload.values.reduce((total,value)=>total+value,0)})}}}',
    'window.addEventListener("message",event=>{for(const slot of slots.values()){const data=event.data;if(event.source!==slot.frame.contentWindow||event.origin!==slot.origin||!data||data.protocol!=="oneweb.module"||data.version!==1||data.moduleId!==slot.moduleId||data.type!=="MODULE_HELLO"||typeof data.challenge!=="string")continue;cleanup(slot,false);slot.generation++;const sessionId=randomSession(),channel=new MessageChannel();slot.port=channel.port1;slot.dispatcher=createModuleCapabilityDispatcher({binding:{moduleId:slot.moduleId,sessionId,generation:slot.generation},catalog,manifestCapabilities:["conformance.echo"],grantedCapabilities:["conformance.echo"],handlers:handlersFor(slot),port:slot.port});slot.port.addEventListener("message",portEvent=>{const message=portEvent.data;if(message&&message.protocol==="oneweb.module"&&message.version===1&&message.moduleId===slot.moduleId&&message.type==="MODULE_READY"&&message.sessionNonce===sessionId){slot.state.textContent="ready";return}if(message&&message.type==="CAPABILITY_REQUEST")slot.lastRequest=structuredClone(message);slot.dispatcher&&slot.dispatcher.dispatch(message)});slot.port.start();slot.generationOutput.textContent=String(slot.generation);slot.frame.contentWindow.postMessage(createModuleEnvelope(slot.moduleId,"MODULE_INIT",{challenge:data.challenge,sessionNonce:sessionId,capabilityGeneration:slot.generation}),slot.origin,[channel.port2]);return}});',
    'window.__rpcHost={forge(key){const slot=slots.get(key);if(!slot||!slot.port||!slot.lastRequest)return false;const forged={...structuredClone(slot.lastRequest),type:"CAPABILITY_RESULT",moduleId:key==="alpha"?definitions.beta.moduleId:definitions.alpha.moduleId,result:{echoed:"forged"}};slot.port.postMessage(forged);return true},reload(key){const slot=slots.get(key);if(!slot)return false;cleanup(slot,true);slot.state.textContent="reloading";slot.frame.src=slot.frame.src;return true},replay(key){const slot=slots.get(key);if(!slot||!slot.dispatcher||!slot.staleRequest)return false;slot.dispatcher.dispatch(structuredClone(slot.staleRequest));return true},remove(key){const slot=slots.get(key);if(!slot)return false;cleanup(slot,true);slot.frame.remove();slot.state.textContent="removed";return true},info(key){const slot=slots.get(key);return slot?{moduleId:slot.moduleId,generation:slot.generation,aborts:slot.aborts,hasPort:Boolean(slot.port),lastRequestId:slot.lastRequest&&slot.lastRequest.requestId||null}:null}};',
    'window.addEventListener("pagehide",()=>{for(const slot of slots.values())cleanup(slot,true)},{once:true});',
  ].join('')
  const alphaUrl = `${definitions.alpha.origin}/rpc-isolation-frame?parentOrigin=${encodeURIComponent('http://127.0.0.1:4747')}`
  const betaUrl = `${definitions.beta.origin}/rpc-isolation-frame?parentOrigin=${encodeURIComponent('http://127.0.0.1:4747')}`
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>Dual RPC isolation host</title></head><body>',
    '<section><output id="alpha-state">waiting</output><output id="alpha-generation">0</output><output id="alpha-aborts">0</output>',
    `<iframe id="rpc-alpha" src="${alphaUrl}"></iframe></section>`,
    '<section><output id="beta-state">waiting</output><output id="beta-generation">0</output><output id="beta-aborts">0</output>',
    `<iframe id="rpc-beta" src="${betaUrl}"></iframe></section>`,
    `<script type="module">${script}</script></body></html>`,
  ].join('')
}

async function startRepoLensFixture(moduleFixtures: ExtensionFixtures['moduleFixtures']) {
  const sdkDistRoot = path.join(currentDir, '../packages/module-sdk/dist')
  const dispatcherSource = ts.transpileModule(
    fs.readFileSync(path.join(currentDir, '../src/modules/capability-dispatcher.ts'), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText.replaceAll('from \'@oneweb/module-sdk\'', 'from \'/oneweb-sdk/index.js\'')
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/api/auth/extension-grants') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      }).end('{}')
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(404).end()
      return
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1:4747')
    if (url.pathname.startsWith('/oneweb-sdk/')) {
      const file = url.pathname.slice('/oneweb-sdk/'.length)
      if (!sdkRuntimeFiles.has(file)) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end()
        return
      }
      const filePath = path.join(sdkDistRoot, file)
      if (!fs.existsSync(filePath))
        throw new Error(`Built module SDK file is missing: ${filePath}`)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
      }).end(fs.readFileSync(filePath))
      return
    }
    if (url.pathname === '/capability-dispatcher.js') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
      }).end(dispatcherSource)
      return
    }
    if (url.pathname === '/rpc-host') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      }).end(renderCapabilityRpcHost('http://127.0.0.1:4747'))
      return
    }
    if (url.pathname === '/rpc-isolation-host') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      }).end(renderCapabilityRpcIsolationHost(moduleFixtures))
      return
    }
    if (url.pathname === '/rpc-frame') {
      const parentOrigin = url.searchParams.get('parentOrigin') || ''
      if (parentOrigin !== 'http://127.0.0.1:4747') {
        response.writeHead(403, { 'cache-control': 'no-store' }).end()
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      }).end(renderCapabilityRpcFrame(parentOrigin))
      return
    }
    if (url.pathname === '/embed') {
      const parentOrigin = url.searchParams.get('parentOrigin') || ''
      if (!/^chrome-extension:\/\/[a-p]{32}$/.test(parentOrigin)) {
        response.writeHead(403, { 'cache-control': 'no-store' }).end()
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors ${parentOrigin}`,
        'content-type': 'text/html; charset=utf-8',
      }).end(renderRepoLensFixture(parentOrigin))
      return
    }
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204, { 'cache-control': 'no-store' }).end()
      return
    }
    response.writeHead(404, { 'cache-control': 'no-store' }).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(4747, '127.0.0.1', resolve)
  })
  return () => {
    server.closeAllConnections()
    return new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

async function startRemoteModuleFixture(definition: RemoteModuleFixtureDefinition) {
  const sdkDistRoot = path.join(currentDir, '../packages/module-sdk/dist')
  const requests = { count: 0 }
  let manifest: RemoteFrameModuleManifest
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(404).end()
      return
    }
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    if (url.pathname.startsWith('/oneweb-sdk/')) {
      const file = url.pathname.slice('/oneweb-sdk/'.length)
      if (!sdkRuntimeFiles.has(file)) {
        response.writeHead(404, { 'cache-control': 'no-store' }).end()
        return
      }
      const filePath = path.join(sdkDistRoot, file)
      if (!fs.existsSync(filePath))
        throw new Error(`Built module SDK file is missing: ${filePath}`)
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/javascript; charset=utf-8',
      }).end(fs.readFileSync(filePath))
      return
    }
    if (url.pathname === '/.well-known/oneweb-fixture.json') {
      requests.count++
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      })
      response.end(JSON.stringify(manifest))
      return
    }
    if (url.pathname === '/embed') {
      const parentOrigin = url.searchParams.get('parentOrigin') || ''
      const moduleId = url.searchParams.get('moduleId') || ''
      if (definition.capabilities.includes('storage.module')
        && (!/^chrome-extension:\/\/[a-p]{32}$/.test(parentOrigin) || moduleId !== definition.id)) {
        response.writeHead(403, { 'cache-control': 'no-store' }).end()
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      })
      if (definition.capabilities.includes('storage.module')) {
        response.end(renderStorageModuleFixture(parentOrigin, definition.id, definition.name))
        return
      }
      response.end('<!doctype html><title>OneWeb conformance fixture</title><p>Remote fixture</p>')
      return
    }
    if (url.pathname === '/rpc-isolation-frame') {
      const parentOrigin = url.searchParams.get('parentOrigin') || ''
      if (parentOrigin !== 'http://127.0.0.1:4747') {
        response.writeHead(403, { 'cache-control': 'no-store' }).end()
        return
      }
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      })
      response.end(renderCapabilityRpcIsolationFrame(parentOrigin, definition.id, definition.name))
      return
    }
    if (url.pathname === '/journal-page-toolbox-frame') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      }).end('<!doctype html><body><input id="frame-password" type="password" value="frame-secret"></body>')
      return
    }
    if (url.pathname === '/journal-page-toolbox-poc') {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      }).end(renderPageToolboxFixture())
      return
    }
    if (url.pathname.startsWith('/journal-')) {
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      })
      const title = url.pathname === '/journal-memory-only-marker'
        ? '&lt;img data-journal-e2e-xss src=x&gt; &lt;script&gt;not-executed&lt;/script&gt;'
        : url.pathname.slice(1)
      response.end(`<!doctype html><title>${title}</title><p>Journal navigation fixture</p>`)
      return
    }
    if (url.pathname === '/icon.png') {
      response.writeHead(204, { 'cache-control': 'no-store', 'content-type': 'image/png' }).end()
      return
    }
    response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  manifest = defineRemoteFrameModuleManifest({
    manifest_version: ONEWEB_MODULE_MANIFEST_VERSION,
    runtime: REMOTE_FRAME_RUNTIME,
    id: definition.id,
    name: definition.name,
    version: '0.1.0',
    description: definition.description,
    icon_url: `${origin}/icon.png`,
    entry_url: `${origin}/embed`,
    matches: definition.matches,
    contexts: definition.contexts,
    context_fields: definition.contextFields,
    capabilities: definition.capabilities,
    activation: 'manual',
    min_host_version: '0.0.1',
    bridge: {
      protocol: ONEWEB_MODULE_PROTOCOL,
      version: ONEWEB_MODULE_PROTOCOL_VERSION,
    },
  })
  return {
    fixture: {
      manifestUrl: `${origin}/.well-known/oneweb-fixture.json`,
      manifest: structuredClone(manifest),
      requests,
      setManifest(candidate: RemoteFrameModuleManifest) {
        manifest = structuredClone(candidate)
      },
    } satisfies RemoteModuleFixture,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    }),
  }
}

async function startBookmarkProbeFixture() {
  const requests = { active: 0, maximum: 0, aborted: 0 }
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const server = createServer((request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(404).end()
      return
    }
    requests.active += 1
    requests.maximum = Math.max(requests.maximum, requests.active)
    let settled = false
    const finish = () => {
      if (settled)
        return
      settled = true
      requests.active -= 1
    }
    response.once('finish', finish)
    response.once('close', () => {
      if (!settled)
        requests.aborted += 1
      finish()
    })

    if (request.url === '/ok') {
      response.writeHead(204, { 'cache-control': 'no-store' }).end()
      return
    }
    if (request.url === '/error') {
      response.writeHead(503, { 'cache-control': 'no-store', 'content-type': 'text/plain' }).end('unavailable')
      return
    }
    if (request.url === '/failure') {
      request.socket.destroy()
      return
    }
    const delay = request.url === '/timeout' ? 12_000 : request.url?.startsWith('/slow/') ? 20_000 : null
    if (delay !== null) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        if (!response.destroyed)
          response.writeHead(200, { 'cache-control': 'no-store' }).end('late')
      }, delay)
      timers.add(timer)
      return
    }
    response.writeHead(404, { 'cache-control': 'no-store' }).end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    fixture: {
      origin,
      urls: {
        ok: `${origin}/ok`,
        error: `${origin}/error`,
        timeout: `${origin}/timeout`,
        failure: `${origin}/failure`,
        slow: (index: number) => `${origin}/slow/${index}`,
      },
      requests,
    } satisfies BookmarkProbeFixture,
    close: () => {
      for (const timer of timers)
        clearTimeout(timer)
      timers.clear()
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    },
  }
}

async function startClashControllerFixture() {
  const secret = 'oneweb-e2e-clash-secret-4c'
  const proxyGroupName = 'GLOBAL <img data-clash-xss src=x>'
  const proxySwitchPath = `/proxies/${encodeURIComponent(proxyGroupName)}`
  const requests = { version: 0, configs: 0, proxies: 0, unauthorized: 0 }
  const switches: ClashControllerFixture['switches'] = {
    attempts: 0,
    successful: 0,
    lastPath: null,
    lastBody: null,
  }
  let blockNextPreflight = false
  let releaseBlockedPreflight: (() => void) | null = null
  let applyNextWriteWithoutResponse = false
  const lifecycle: ClashControllerFixture['lifecycle'] = {
    pendingPreflights: 0,
    abortedPreflights: 0,
    ambiguousWrites: 0,
    blockNextPreflight() {
      blockNextPreflight = true
    },
    releaseBlockedPreflight() {
      releaseBlockedPreflight?.()
    },
    applyNextWriteWithoutResponse() {
      applyNextWriteWithoutResponse = true
    },
  }
  let mode = 'rule'
  let selectedNode = 'Node A'
  const proxyPayload = () => ({
    proxies: {
      [proxyGroupName]: {
        type: 'Selector',
        now: selectedNode,
        all: ['Node A', 'Node B'],
      },
      'Node A': { type: 'Vmess', alive: true, history: [{ delay: 5 }] },
      'Node B': { type: 'Shadowsocks', alive: false, extra: '<script>ignored</script>' },
    },
  })
  const server = createServer((request, response) => {
    const isRead = request.method === 'GET'
      && (request.url === '/version' || request.url === '/configs' || request.url === '/proxies')
    const isSwitch = request.method === 'PUT' && request.url === proxySwitchPath
    if (!isRead && !isSwitch) {
      response.writeHead(404).end()
      return
    }
    if (request.headers.authorization !== `Bearer ${secret}`) {
      requests.unauthorized += 1
      response.writeHead(401, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      }).end(JSON.stringify({ message: 'Unauthorized' }))
      return
    }
    if (isSwitch) {
      switches.attempts += 1
      switches.lastPath = request.url || null
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        let body: unknown
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }
        catch {
          response.writeHead(400, { 'cache-control': 'no-store' }).end()
          return
        }
        switches.lastBody = structuredClone(body)
        const validBody = Boolean(body
          && typeof body === 'object'
          && !Array.isArray(body)
          && Object.keys(body).length === 1
          && typeof (body as { name?: unknown }).name === 'string'
          && ['Node A', 'Node B'].includes((body as { name: string }).name))
        if (!validBody) {
          response.writeHead(400, { 'cache-control': 'no-store' }).end()
          return
        }
        selectedNode = (body as { name: string }).name
        switches.successful += 1
        if (applyNextWriteWithoutResponse) {
          applyNextWriteWithoutResponse = false
          lifecycle.ambiguousWrites += 1
          return
        }
        response.writeHead(204, { 'cache-control': 'no-store' }).end()
      })
      return
    }
    if (request.url === '/version') {
      requests.version += 1
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      }).end(JSON.stringify({ meta: true, version: '1.19.0-e2e' }))
      return
    }
    if (request.url === '/configs') {
      requests.configs += 1
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      }).end(JSON.stringify({ mode, ignored: '<script>not-executed</script>' }))
      return
    }
    requests.proxies += 1
    const sendProxyResponse = () => response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    }).end(JSON.stringify(proxyPayload()))
    if (blockNextPreflight) {
      blockNextPreflight = false
      lifecycle.pendingPreflights += 1
      let settled = false
      const settle = (aborted: boolean) => {
        if (settled)
          return
        settled = true
        lifecycle.pendingPreflights -= 1
        releaseBlockedPreflight = null
        if (aborted) {
          lifecycle.abortedPreflights += 1
          return
        }
        sendProxyResponse()
      }
      releaseBlockedPreflight = () => settle(false)
      request.once('aborted', () => settle(true))
      response.once('close', () => {
        if (!response.writableEnded)
          settle(true)
      })
      return
    }
    sendProxyResponse()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    fixture: {
      origin,
      secret,
      requests,
      switches,
      lifecycle,
      proxyGroupName,
      setMode: value => mode = value,
      setSelectedNode: value => selectedNode = value,
    } satisfies ClashControllerFixture,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    },
  }
}

async function startOpenListFixture(kind: OpenListFixture['kind'] = 'openlist') {
  const token = `oneweb-e2e-${kind}-token`
  const tools = kind === 'openlist' ? ['SimpleHttp', 'qBittorrent'] : ['aria2', '115 Cloud']
  const requests = {
    me: 0,
    tools: 0,
    add: 0,
    activeAdds: 0,
    maximumAdds: 0,
    unauthorized: 0,
    undone: 0,
    done: 0,
    cancel: 0,
    clientIds: [] as string[],
    toolPaths: [] as Array<string | null>,
  }
  const undoneTasks: Array<Record<string, unknown>> = []
  const doneTasks: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1')
    const reply = (code: number, data: unknown, status = 200) => response.writeHead(status, {
      'cache-control': 'no-store',
      'content-type': 'application/json',
    }).end(JSON.stringify({ code, message: code === 200 ? 'success' : 'failed', data }))
    const clientId = request.headers['client-id']
    if (typeof clientId !== 'string' || !/^oneweb-[0-9a-f]{8}$/u.test(clientId)) {
      reply(400, null, 400)
      return
    }
    requests.clientIds.push(clientId)
    if (request.method === 'GET' && url.pathname === '/api/public/offline_download_tools') {
      requests.tools += 1
      requests.toolPaths.push(url.searchParams.get('path'))
      if (request.headers.authorization !== undefined) {
        response.writeHead(400).end()
        return
      }
      reply(200, tools)
      return
    }
    if (request.headers.authorization !== token) {
      requests.unauthorized += 1
      reply(401, null, 401)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/me') {
      requests.me += 1
      reply(200, { id: 1, username: 'fixture' })
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/task/offline_download/undone') {
      requests.undone += 1
      reply(200, undoneTasks)
      return
    }
    if (request.method === 'GET' && url.pathname === '/api/task/offline_download/done') {
      requests.done += 1
      reply(200, doneTasks)
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/task/offline_download/cancel') {
      requests.cancel += 1
      const taskId = url.searchParams.get('tid')
      const index = undoneTasks.findIndex(task => task.id === taskId)
      if (index < 0) {
        reply(404, null)
        return
      }
      const [task] = undoneTasks.splice(index, 1)
      doneTasks.push({ ...task, state: 4, status: 'cancelled' })
      reply(200, null)
      return
    }
    if (request.method !== 'POST' || url.pathname !== '/api/fs/add_offline_download') {
      response.writeHead(404).end()
      return
    }
    requests.add += 1
    requests.activeAdds += 1
    requests.maximumAdds = Math.max(requests.maximumAdds, requests.activeAdds)
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      requests.activeAdds -= 1
      let body: Record<string, unknown> | null = null
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
      }
      catch {}
      if (!body
        || !Array.isArray(body.urls)
        || body.urls.length !== 1
        || typeof body.urls[0] !== 'string'
        || typeof body.path !== 'string'
        || !tools.includes(String(body.tool))
        || body.delete_policy !== 'delete_on_upload_succeed') {
        reply(400, null, 400)
        return
      }
      const task = {
        id: `task-${requests.add}`,
        name: `<img data-openlist-xss src=x> task ${requests.add}`,
        state: 1,
        status: 'running',
        progress: 0,
        total_bytes: 0,
        error: '',
      }
      undoneTasks.push(task)
      reply(200, { tasks: [{ id: task.id }] })
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    fixture: { kind, origin, token, requests, tools } satisfies OpenListFixture,
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    },
  }
}

export const test = base.extend<ExtensionFixtures>({
  context: async ({ alistFixture, bookmarkProbeFixture, clashControllerFixture, headless, moduleFixtures, openListFixture }, use) => {
    const closeRepoLensFixture = await startRepoLensFixture(moduleFixtures)
    const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oneweb-e2e-'))
    const launchOptions = {
      headless,
      ...(process.env.PW_BROWSER_CHANNEL ? { channel: process.env.PW_BROWSER_CHANNEL as 'chrome' | 'msedge' } : {}),
      args: [
        ...(headless ? ['--headless=new'] : []),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    }
    const bootstrap = await chromium.launchPersistentContext(profileDir, launchOptions)
    let [bootstrapWorker] = bootstrap.serviceWorkers()
    if (!bootstrapWorker)
      bootstrapWorker = await bootstrap.waitForEvent('serviceworker')
    const extensionId = new URL(bootstrapWorker.url()).hostname
    await bootstrap.close()

    const preferencesPath = path.join(profileDir, 'Default', 'Preferences')
    const preferences = await fs.readJson(preferencesPath)
    const extensionSettings = preferences.extensions.settings[extensionId]
    // Chromium's optional-host prompt is browser chrome and cannot be accepted in
    // headless E2E. Pre-grant only these ephemeral local origins in the isolated
    // profile; unit tests still verify the exact user-gesture request itself.
    const fixtureOrigins = Object.values(moduleFixtures)
      .map(fixture => `${new URL(fixture.manifestUrl).origin}/*`)
    fixtureOrigins.push(`${bookmarkProbeFixture.origin}/*`)
    fixtureOrigins.push(`${clashControllerFixture.origin}/*`)
    fixtureOrigins.push(`${openListFixture.origin}/*`)
    fixtureOrigins.push(`${alistFixture.origin}/*`)
    for (const key of ['active_permissions', 'granted_permissions']) {
      const origins = extensionSettings[key].explicit_host as string[]
      for (const fixtureOrigin of fixtureOrigins) {
        if (!origins.includes(fixtureOrigin))
          origins.push(fixtureOrigin)
      }
      const api = extensionSettings[key].api as string[]
      if (!api.includes('bookmarks'))
        api.push('bookmarks')
    }
    await fs.writeJson(preferencesPath, preferences)

    const context = await chromium.launchPersistentContext(profileDir, launchOptions)
    try {
      await use(context)
    }
    finally {
      await context.close()
      await fs.remove(profileDir)
      await closeRepoLensFixture()
    }
  },
  // Playwright requires fixture dependency arguments to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  alistFixture: async ({}, use) => {
    const fixture = await startOpenListFixture('alist')
    try {
      await use(fixture.fixture)
    }
    finally {
      await fixture.close()
    }
  },
  // Playwright requires fixture dependency arguments to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  bookmarkProbeFixture: async ({}, use) => {
    const fixture = await startBookmarkProbeFixture()
    try {
      await use(fixture.fixture)
    }
    finally {
      await fixture.close()
    }
  },
  // Playwright requires fixture dependency arguments to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  clashControllerFixture: async ({}, use) => {
    const fixture = await startClashControllerFixture()
    try {
      await use(fixture.fixture)
    }
    finally {
      await fixture.close()
    }
  },
  // Playwright requires fixture dependency arguments to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  openListFixture: async ({}, use) => {
    const fixture = await startOpenListFixture('openlist')
    try {
      await use(fixture.fixture)
    }
    finally {
      await fixture.close()
    }
  },
  extensionId: async ({ context }, use) => {
    // for manifest v3:
    let [background] = context.serviceWorkers()
    if (!background)
      background = await context.waitForEvent('serviceworker')

    const extensionId = background.url().split('/')[2]
    await use(extensionId)
  },
  moduleFixture: async ({ moduleFixtures }, use) => {
    await use(moduleFixtures.primary)
  },
  // Playwright requires fixture dependency arguments to use object destructuring.
  // eslint-disable-next-line no-empty-pattern
  moduleFixtures: async ({}, use) => {
    const primary = await startRemoteModuleFixture({
      id: 'dev.juck.installable',
      name: 'Installable Fixture',
      description: 'Remote installation conformance fixture',
      matches: ['https://github.com/*/*'],
      contexts: ['github.repository'],
      contextFields: { 'github.repository': ['repo', 'url', 'pageType'] },
      capabilities: ['tabs.open'],
    })
    const secondary = await startRemoteModuleFixture({
      id: 'dev.oneweb.conformance.secondary',
      name: 'Secondary Conformance',
      description: 'Independent remote module isolation fixture',
      matches: ['https://example.com/*'],
      contexts: ['page.metadata'],
      contextFields: { 'page.metadata': ['title', 'description'] },
      capabilities: ['storage.module'],
    })
    const storagePeer = await startRemoteModuleFixture({
      id: 'dev.oneweb.conformance.storage-peer',
      name: 'Storage Peer Conformance',
      description: 'Independent storage.module namespace fixture',
      matches: ['https://storage.example.com/*'],
      contexts: [],
      contextFields: {},
      capabilities: ['storage.module'],
    })
    try {
      await use({
        primary: primary.fixture,
        secondary: secondary.fixture,
        storagePeer: storagePeer.fixture,
      })
    }
    finally {
      await Promise.all([primary.close(), secondary.close(), storagePeer.close()])
    }
  },
})

export const expect = test.expect

export function isDevArtifact() {
  const manifest: Manifest.WebExtensionManifest = fs.readJsonSync(path.resolve(extensionPath, 'manifest.json'))
  return Boolean(
    typeof manifest.content_security_policy === 'object'
    && manifest.content_security_policy.extension_pages?.includes('localhost'),
  )
}
