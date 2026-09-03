export const ONEWEB_CAPABILITY_RPC_PROTOCOL = 'oneweb.capability' as const
export const ONEWEB_CAPABILITY_RPC_VERSION = 1 as const

export const CAPABILITY_RPC_REQUEST_PAYLOAD_MAX_BYTES = 16 * 1024
export const CAPABILITY_RPC_RESULT_MAX_BYTES = 64 * 1024
export const CAPABILITY_RPC_DATA_MAX_DEPTH = 8
export const CAPABILITY_RPC_DATA_MAX_NODES = 512
export const CAPABILITY_RPC_MAX_IN_FLIGHT = 16
export const CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION = 1024
export const CAPABILITY_RPC_REQUEST_TIMEOUT_MS = 15_000

export const capabilityRpcEnvelopeTypes = Object.freeze([
  'CAPABILITY_REQUEST',
  'CAPABILITY_RESULT',
  'CAPABILITY_ERROR',
  'CAPABILITY_CANCEL',
] as const)

export const capabilityRpcErrorCodes = Object.freeze([
  'INVALID_ENVELOPE',
  'SESSION_MISMATCH',
  'CAPABILITY_NOT_DECLARED',
  'CAPABILITY_NOT_ALLOWED',
  'OPERATION_NOT_ALLOWED',
  'PAYLOAD_INVALID',
  'PAYLOAD_TOO_LARGE',
  'RESULT_INVALID',
  'RESULT_TOO_LARGE',
  'REQUEST_ID_REUSED',
  'IN_FLIGHT_LIMIT_REACHED',
  'SESSION_REQUEST_LIMIT_REACHED',
  'REQUEST_NOT_FOUND',
  'RESPONSE_MISMATCH',
  'REQUEST_ALREADY_TERMINAL',
  'TIMEOUT_NOT_REACHED',
  'REQUEST_TIMED_OUT',
  'SESSION_DESTROYED',
  'STORAGE_REVISION_CONFLICT',
  'OPERATION_FAILED',
  'CAPABILITY_UNAVAILABLE',
] as const)

export type CapabilityRpcEnvelopeType = typeof capabilityRpcEnvelopeTypes[number]
export type CapabilityRpcErrorCode = typeof capabilityRpcErrorCodes[number]

export interface CapabilityRpcNullSchema {
  readonly kind: 'null'
}

export interface CapabilityRpcBooleanSchema {
  readonly kind: 'boolean'
}

export interface CapabilityRpcNumberSchema {
  readonly kind: 'number'
  readonly integer: boolean
  readonly minimum?: number
  readonly maximum?: number
}

export interface CapabilityRpcStringSchema {
  readonly kind: 'string'
  readonly minimumLength: number
  readonly maximumLength: number
}

export interface CapabilityRpcLiteralSchema<
  Value extends string | number | boolean | null = string | number | boolean | null,
> {
  readonly kind: 'literal'
  readonly value: Value
}

export type CapabilityRpcJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CapabilityRpcJsonValue[]
  | { readonly [key: string]: CapabilityRpcJsonValue }

export interface CapabilityRpcJsonSchema {
  readonly kind: 'json'
  readonly maximumBytes: number
  readonly maximumDepth: number
  readonly maximumNodes: number
}

export interface CapabilityRpcArraySchema<
  Item extends CapabilityRpcSchema = CapabilityRpcSchema,
> {
  readonly kind: 'array'
  readonly items: Item
  readonly minimumItems: number
  readonly maximumItems: number
}

export interface CapabilityRpcObjectSchema<
  Fields extends Readonly<Record<string, CapabilityRpcSchema>> = Readonly<Record<string, CapabilityRpcSchema>>,
  Optional extends readonly (keyof Fields & string)[] = readonly (keyof Fields & string)[],
> {
  readonly kind: 'object'
  readonly fields: Fields
  readonly optional: Optional
}

export type CapabilityRpcSchema =
  | CapabilityRpcNullSchema
  | CapabilityRpcBooleanSchema
  | CapabilityRpcNumberSchema
  | CapabilityRpcStringSchema
  | CapabilityRpcLiteralSchema
  | CapabilityRpcJsonSchema
  | CapabilityRpcArraySchema
  | CapabilityRpcObjectSchema

type OptionalObjectKeys<
  Fields extends Readonly<Record<string, CapabilityRpcSchema>>,
  Optional extends readonly (keyof Fields & string)[],
> = Optional[number]

export type CapabilityRpcSchemaValue<Schema extends CapabilityRpcSchema> =
  Schema extends CapabilityRpcNullSchema ? null
    : Schema extends CapabilityRpcBooleanSchema ? boolean
      : Schema extends CapabilityRpcNumberSchema ? number
        : Schema extends CapabilityRpcStringSchema ? string
          : Schema extends CapabilityRpcLiteralSchema<infer Value> ? Value
            : Schema extends CapabilityRpcJsonSchema ? CapabilityRpcJsonValue
              : Schema extends CapabilityRpcArraySchema<infer Item> ? readonly CapabilityRpcSchemaValue<Item>[]
                : Schema extends CapabilityRpcObjectSchema<infer Fields, infer Optional> ? Readonly<
                  & {
                    [Key in Exclude<keyof Fields, OptionalObjectKeys<Fields, Optional>>]:
                    CapabilityRpcSchemaValue<Fields[Key]>
                  }
                  & {
                    [Key in OptionalObjectKeys<Fields, Optional>]?: CapabilityRpcSchemaValue<Fields[Key]>
                  }
                >
                  : never

export interface CapabilityRpcOperationDescriptor<
  Request extends CapabilityRpcSchema = CapabilityRpcSchema,
  Result extends CapabilityRpcSchema = CapabilityRpcSchema,
> {
  readonly request: Request
  readonly result: Result
}

export interface CapabilityRpcCapabilityDescriptor<
  Operations extends Readonly<Record<string, CapabilityRpcOperationDescriptor>> = Readonly<Record<string, CapabilityRpcOperationDescriptor>>,
> {
  readonly operations: Operations
}

export type CapabilityRpcCatalog = Readonly<Record<string, CapabilityRpcCapabilityDescriptor>>
export type CapabilityRpcCapabilityId<Catalog extends CapabilityRpcCatalog> = keyof Catalog & string
export type CapabilityRpcOperationId<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
> = keyof Catalog[Capability]['operations'] & string
export type CapabilityRpcRequestPayload<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
  Operation extends CapabilityRpcOperationId<Catalog, Capability>,
> = CapabilityRpcSchemaValue<Catalog[Capability]['operations'][Operation]['request']>
export type CapabilityRpcResultPayload<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
  Operation extends CapabilityRpcOperationId<Catalog, Capability>,
> = CapabilityRpcSchemaValue<Catalog[Capability]['operations'][Operation]['result']>

export interface CapabilityRpcSessionBinding {
  readonly moduleId: string
  readonly sessionId: string
  readonly generation: number
}

export interface CapabilityRpcRequestIdentity extends CapabilityRpcSessionBinding {
  readonly requestId: string
}

export interface CapabilityRpcRequestReference extends CapabilityRpcRequestIdentity {
  readonly protocol: typeof ONEWEB_CAPABILITY_RPC_PROTOCOL
  readonly version: typeof ONEWEB_CAPABILITY_RPC_VERSION
  readonly type: 'CAPABILITY_REQUEST'
  readonly capability: string
  readonly operation: string
}

interface CapabilityRpcEnvelopeBase<
  Type extends CapabilityRpcEnvelopeType,
  Capability extends string,
  Operation extends string,
> extends CapabilityRpcRequestIdentity {
  readonly protocol: typeof ONEWEB_CAPABILITY_RPC_PROTOCOL
  readonly version: typeof ONEWEB_CAPABILITY_RPC_VERSION
  readonly type: Type
  readonly capability: Capability
  readonly operation: Operation
}

export interface CapabilityRpcRequestEnvelope<
  Capability extends string = string,
  Operation extends string = string,
  Payload = unknown,
> extends CapabilityRpcEnvelopeBase<'CAPABILITY_REQUEST', Capability, Operation> {
  readonly payload: Payload
}

export interface CapabilityRpcResultEnvelope<
  Capability extends string = string,
  Operation extends string = string,
  Result = unknown,
> extends CapabilityRpcEnvelopeBase<'CAPABILITY_RESULT', Capability, Operation> {
  readonly result: Result
}

export interface CapabilityRpcErrorEnvelope<
  Capability extends string = string,
  Operation extends string = string,
> extends CapabilityRpcEnvelopeBase<'CAPABILITY_ERROR', Capability, Operation> {
  readonly code: CapabilityRpcErrorCode
}

export type CapabilityRpcCancelEnvelope<
  Capability extends string = string,
  Operation extends string = string,
> = CapabilityRpcEnvelopeBase<'CAPABILITY_CANCEL', Capability, Operation>

type AnyCapabilityRpcRequest<Catalog extends CapabilityRpcCatalog> = {
  [Capability in CapabilityRpcCapabilityId<Catalog>]: {
    [Operation in CapabilityRpcOperationId<Catalog, Capability>]: CapabilityRpcRequestEnvelope<
      Capability,
      Operation,
      CapabilityRpcRequestPayload<Catalog, Capability, Operation>
    >
  }[CapabilityRpcOperationId<Catalog, Capability>]
}[CapabilityRpcCapabilityId<Catalog>]

type AnyCapabilityRpcResult<Catalog extends CapabilityRpcCatalog> = {
  [Capability in CapabilityRpcCapabilityId<Catalog>]: {
    [Operation in CapabilityRpcOperationId<Catalog, Capability>]: CapabilityRpcResultEnvelope<
      Capability,
      Operation,
      CapabilityRpcResultPayload<Catalog, Capability, Operation>
    >
  }[CapabilityRpcOperationId<Catalog, Capability>]
}[CapabilityRpcCapabilityId<Catalog>]

export type CapabilityRpcValidationResult<Value> =
  | { readonly ok: true, readonly value: Value }
  | { readonly ok: false, readonly code: CapabilityRpcErrorCode }

const moduleIdPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?){2,}$/
const opaqueIdPattern = /^[\w-]+$/
const capabilityIdPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const operationIdPattern = /^[a-z][a-z0-9-]*$/
const capabilityRpcErrorCodeSet = new Set<string>(capabilityRpcErrorCodes)

function assertSafeInteger(value: number, name: string, minimum: number, maximum: number) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new TypeError(`${name} must be a safe integer between ${minimum} and ${maximum}`)
}

function assertFiniteBound(value: number | undefined, name: string) {
  if (value !== undefined && !Number.isFinite(value))
    throw new TypeError(`${name} must be finite when provided`)
}

function createNumberSchema(options: {
  integer?: boolean
  minimum?: number
  maximum?: number
} = {}): CapabilityRpcNumberSchema {
  assertFiniteBound(options.minimum, 'minimum')
  assertFiniteBound(options.maximum, 'maximum')
  if (options.minimum !== undefined && options.maximum !== undefined && options.minimum > options.maximum)
    throw new TypeError('minimum must not exceed maximum')
  return Object.freeze({
    kind: 'number',
    integer: options.integer === true,
    ...(options.minimum === undefined ? {} : { minimum: options.minimum }),
    ...(options.maximum === undefined ? {} : { maximum: options.maximum }),
  })
}

function createStringSchema(options: {
  minimumLength?: number
  maximumLength: number
}): CapabilityRpcStringSchema {
  const minimumLength = options.minimumLength ?? 0
  assertSafeInteger(minimumLength, 'minimumLength', 0, CAPABILITY_RPC_RESULT_MAX_BYTES)
  assertSafeInteger(options.maximumLength, 'maximumLength', 0, CAPABILITY_RPC_RESULT_MAX_BYTES)
  if (minimumLength > options.maximumLength)
    throw new TypeError('minimumLength must not exceed maximumLength')
  return Object.freeze({ kind: 'string', minimumLength, maximumLength: options.maximumLength })
}

function createLiteralSchema<const Value extends string | number | boolean | null>(
  value: Value,
): CapabilityRpcLiteralSchema<Value> {
  if (typeof value === 'number' && !Number.isFinite(value))
    throw new TypeError('literal number must be finite')
  return Object.freeze({ kind: 'literal', value })
}

function createJsonSchema(options: {
  maximumBytes: number
  maximumDepth: number
  maximumNodes: number
}): CapabilityRpcJsonSchema {
  assertSafeInteger(options.maximumBytes, 'maximumBytes', 1, CAPABILITY_RPC_RESULT_MAX_BYTES)
  assertSafeInteger(options.maximumDepth, 'maximumDepth', 0, CAPABILITY_RPC_DATA_MAX_DEPTH)
  assertSafeInteger(options.maximumNodes, 'maximumNodes', 1, CAPABILITY_RPC_DATA_MAX_NODES)
  return Object.freeze({ kind: 'json', ...options })
}

function createArraySchema<const Item extends CapabilityRpcSchema>(
  items: Item,
  options: { minimumItems?: number, maximumItems: number },
): CapabilityRpcArraySchema<Item> {
  const minimumItems = options.minimumItems ?? 0
  assertSafeInteger(minimumItems, 'minimumItems', 0, CAPABILITY_RPC_DATA_MAX_NODES)
  assertSafeInteger(options.maximumItems, 'maximumItems', 0, CAPABILITY_RPC_DATA_MAX_NODES)
  if (minimumItems > options.maximumItems)
    throw new TypeError('minimumItems must not exceed maximumItems')
  return Object.freeze({ kind: 'array', items, minimumItems, maximumItems: options.maximumItems })
}

function createObjectSchema<
  const Fields extends Readonly<Record<string, CapabilityRpcSchema>>,
>(_fields: Fields): CapabilityRpcObjectSchema<Fields, readonly []>
function createObjectSchema<
  const Fields extends Readonly<Record<string, CapabilityRpcSchema>>,
  const Optional extends readonly (keyof Fields & string)[],
>(
  _fields: Fields,
  _options: { optional: Optional },
): CapabilityRpcObjectSchema<Fields, Optional>
function createObjectSchema(
  fields: Readonly<Record<string, CapabilityRpcSchema>>,
  options: { optional?: readonly string[] } = {},
): CapabilityRpcObjectSchema {
  const fieldNames = Object.keys(fields)
  if (fieldNames.length === 0 || fieldNames.length > CAPABILITY_RPC_DATA_MAX_NODES)
    throw new TypeError('object schema must declare between 1 and 512 fields')
  if (Reflect.ownKeys(fields).some(key => typeof key === 'symbol'))
    throw new TypeError('object schema fields must not use symbol keys')
  const optional = options.optional || []
  if (new Set(optional).size !== optional.length || optional.some(key => !Object.hasOwn(fields, key)))
    throw new TypeError('optional fields must be unique declared field names')
  return Object.freeze({
    kind: 'object',
    fields: Object.freeze({ ...fields }),
    optional: Object.freeze([...optional]),
  })
}

export const capabilityRpcSchema = Object.freeze({
  null: Object.freeze({ kind: 'null' } as const),
  boolean: Object.freeze({ kind: 'boolean' } as const),
  number: createNumberSchema,
  string: createStringSchema,
  literal: createLiteralSchema,
  json: createJsonSchema,
  array: createArraySchema,
  object: createObjectSchema,
})

function cloneSchema(schema: CapabilityRpcSchema, ancestors = new Set<object>()): CapabilityRpcSchema {
  if (!schema || typeof schema !== 'object' || ancestors.has(schema))
    throw new TypeError('capability schema must be an acyclic descriptor')
  const nextAncestors = new Set(ancestors).add(schema)
  switch (schema.kind) {
    case 'null':
      return capabilityRpcSchema.null
    case 'boolean':
      return capabilityRpcSchema.boolean
    case 'number':
      return createNumberSchema(schema)
    case 'string':
      return createStringSchema(schema)
    case 'literal':
      return createLiteralSchema(schema.value)
    case 'json':
      return createJsonSchema(schema)
    case 'array':
      return createArraySchema(cloneSchema(schema.items, nextAncestors), schema)
    case 'object': {
      const fields = Object.fromEntries(Object.entries(schema.fields).map(([key, value]) => [
        key,
        cloneSchema(value, nextAncestors),
      ]))
      return createObjectSchema(fields, { optional: schema.optional })
    }
    default:
      throw new TypeError('capability schema kind is not supported')
  }
}

export function defineCapabilityRpcCatalog<const Catalog extends CapabilityRpcCatalog>(
  catalog: Catalog,
): Catalog {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog))
    throw new TypeError('capability catalog must be an object')
  const capabilities = Object.entries(catalog)
  if (capabilities.length === 0)
    throw new TypeError('capability catalog must not be empty')
  const cloned: Record<string, CapabilityRpcCapabilityDescriptor> = {}
  for (const [capability, descriptor] of capabilities) {
    if (!capabilityIdPattern.test(capability))
      throw new TypeError(`invalid capability ID: ${capability}`)
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor))
      throw new TypeError(`invalid descriptor for capability: ${capability}`)
    const operations = Object.entries(descriptor.operations || {})
    if (operations.length === 0)
      throw new TypeError(`capability must declare at least one operation: ${capability}`)
    const clonedOperations: Record<string, CapabilityRpcOperationDescriptor> = {}
    for (const [operation, operationDescriptor] of operations) {
      if (!operationIdPattern.test(operation))
        throw new TypeError(`invalid operation ID: ${operation}`)
      if (!operationDescriptor || typeof operationDescriptor !== 'object' || Array.isArray(operationDescriptor))
        throw new TypeError(`invalid descriptor for operation: ${operation}`)
      clonedOperations[operation] = Object.freeze({
        request: cloneSchema(operationDescriptor.request),
        result: cloneSchema(operationDescriptor.result),
      })
    }
    cloned[capability] = Object.freeze({ operations: Object.freeze(clonedOperations) })
  }
  return Object.freeze(cloned) as Catalog
}

function isPlainDataObject(value: object) {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

interface CloneBudget {
  nodes: number
  ancestors: Set<object>
}

type CloneDataResult =
  | { ok: true, value: unknown, bytes: number }
  | { ok: false, tooLarge: boolean }

function cloneDataNode(value: unknown, depth: number, budget: CloneBudget): unknown {
  budget.nodes += 1
  if (budget.nodes > CAPABILITY_RPC_DATA_MAX_NODES || depth > CAPABILITY_RPC_DATA_MAX_DEPTH)
    throw new TypeError('data boundary exceeded')
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('number must be finite')
    return value
  }
  if (typeof value !== 'object')
    throw new TypeError('data must be JSON-like')
  if (budget.ancestors.has(value))
    throw new TypeError('data must be acyclic')

  const nextBudget = { nodes: budget.nodes, ancestors: new Set(budget.ancestors).add(value) }
  if (Array.isArray(value)) {
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some(key => typeof key === 'symbol') || ownKeys.length !== value.length + 1)
      throw new TypeError('arrays must be dense and must not have extra properties')
    const cloned = value.map((_, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
        throw new TypeError('array elements must be enumerable data properties')
      const item = cloneDataNode(descriptor.value, depth + 1, nextBudget)
      budget.nodes = nextBudget.nodes
      return item
    })
    return Object.freeze(cloned)
  }
  if (!isPlainDataObject(value))
    throw new TypeError('objects must use a plain prototype')
  const keys = Reflect.ownKeys(value)
  if (keys.some(key => typeof key === 'symbol'))
    throw new TypeError('objects must not use symbol keys')
  const cloned: Record<string, unknown> = {}
  for (const key of keys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      throw new TypeError('object fields must be enumerable data properties')
    const item = cloneDataNode(descriptor.value, depth + 1, nextBudget)
    budget.nodes = nextBudget.nodes
    Object.defineProperty(cloned, key, {
      configurable: false,
      enumerable: true,
      value: item,
      writable: false,
    })
  }
  return Object.freeze(cloned)
}

function cloneCapabilityRpcData(value: unknown, maximumBytes: number): CloneDataResult {
  try {
    const budget: CloneBudget = { nodes: 0, ancestors: new Set() }
    const cloned = cloneDataNode(value, 0, budget)
    const bytes = new TextEncoder().encode(JSON.stringify(cloned)).byteLength
    if (bytes > maximumBytes)
      return { ok: false, tooLarge: true }
    return { ok: true, value: cloned, bytes }
  }
  catch {
    return { ok: false, tooLarge: false }
  }
}

function matchesSchema(value: unknown, schema: CapabilityRpcSchema): boolean {
  switch (schema.kind) {
    case 'null':
      return value === null
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number'
        && Number.isFinite(value)
        && (!schema.integer || Number.isInteger(value))
        && (schema.minimum === undefined || value >= schema.minimum)
        && (schema.maximum === undefined || value <= schema.maximum)
    case 'string':
      return typeof value === 'string'
        && value.length >= schema.minimumLength
        && value.length <= schema.maximumLength
    case 'literal':
      return Object.is(value, schema.value)
    case 'json': {
      let nodes = 0
      let maximumDepth = 0
      const visit = (item: unknown, depth: number): boolean => {
        nodes += 1
        maximumDepth = Math.max(maximumDepth, depth)
        if (nodes > schema.maximumNodes || maximumDepth > schema.maximumDepth)
          return false
        if (item === null || typeof item === 'string' || typeof item === 'boolean')
          return true
        if (typeof item === 'number')
          return Number.isFinite(item)
        if (Array.isArray(item))
          return item.every(child => visit(child, depth + 1))
        if (!item || typeof item !== 'object' || !isPlainDataObject(item))
          return false
        return Object.values(item).every(child => visit(child, depth + 1))
      }
      return visit(value, 0)
        && new TextEncoder().encode(JSON.stringify(value)).byteLength <= schema.maximumBytes
    }
    case 'array':
      return Array.isArray(value)
        && value.length >= schema.minimumItems
        && value.length <= schema.maximumItems
        && value.every(item => matchesSchema(item, schema.items))
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
      const record = value as Record<string, unknown>
      const keys = Object.keys(record)
      const optional = new Set<string>(schema.optional)
      return keys.every(key => Object.hasOwn(schema.fields, key))
        && Object.keys(schema.fields).every(key => optional.has(key) || Object.hasOwn(record, key))
        && keys.every(key => matchesSchema(record[key], schema.fields[key]))
    }
  }
}

function validationFailure(code: CapabilityRpcErrorCode): CapabilityRpcValidationResult<never> {
  return Object.freeze({ ok: false, code })
}

function validationSuccess<Value>(value: Value): CapabilityRpcValidationResult<Value> {
  return Object.freeze({ ok: true, value })
}

function assertValidBinding(binding: CapabilityRpcSessionBinding) {
  if (!binding || typeof binding !== 'object'
    || typeof binding.moduleId !== 'string'
    || !moduleIdPattern.test(binding.moduleId)
    || typeof binding.sessionId !== 'string'
    || binding.sessionId.length < 24
    || binding.sessionId.length > 128
    || !opaqueIdPattern.test(binding.sessionId)
    || !Number.isSafeInteger(binding.generation)
    || binding.generation < 1) {
    throw new TypeError('invalid capability RPC session binding')
  }
}

function assertValidRequestId(requestId: string) {
  if (typeof requestId !== 'string'
    || requestId.length < 8
    || requestId.length > 128
    || !opaqueIdPattern.test(requestId)) {
    throw new TypeError('invalid capability RPC request ID')
  }
}

function frozenBinding(binding: CapabilityRpcSessionBinding): CapabilityRpcSessionBinding {
  assertValidBinding(binding)
  return Object.freeze({
    moduleId: binding.moduleId,
    sessionId: binding.sessionId,
    generation: binding.generation,
  })
}

function frozenIdentity(identity: CapabilityRpcRequestIdentity): CapabilityRpcRequestIdentity {
  assertValidRequestId(identity.requestId)
  return Object.freeze({ ...frozenBinding(identity), requestId: identity.requestId })
}

function operationDescriptor(
  catalog: CapabilityRpcCatalog,
  capability: string,
  operation: string,
): CapabilityRpcOperationDescriptor | null {
  const capabilityDescriptor = Object.hasOwn(catalog, capability) ? catalog[capability] : null
  if (!capabilityDescriptor || !Object.hasOwn(capabilityDescriptor.operations, operation))
    return null
  return capabilityDescriptor.operations[operation]
}

function cloneForSchema(
  value: unknown,
  schema: CapabilityRpcSchema,
  maximumBytes: number,
  invalidCode: CapabilityRpcErrorCode,
  tooLargeCode: CapabilityRpcErrorCode,
): CapabilityRpcValidationResult<unknown> {
  const cloned = cloneCapabilityRpcData(value, maximumBytes)
  if (!cloned.ok)
    return validationFailure(cloned.tooLarge ? tooLargeCode : invalidCode)
  if (!matchesSchema(cloned.value, schema))
    return validationFailure(invalidCode)
  return validationSuccess(cloned.value)
}

export function validateCapabilityRpcSchemaValue<const Schema extends CapabilityRpcSchema>(
  schema: Schema,
  value: unknown,
  maximumBytes: number,
): CapabilityRpcValidationResult<CapabilityRpcSchemaValue<Schema>> {
  assertSafeInteger(maximumBytes, 'maximumBytes', 1, CAPABILITY_RPC_RESULT_MAX_BYTES)
  const validated = cloneForSchema(
    value,
    schema,
    maximumBytes,
    'PAYLOAD_INVALID',
    'PAYLOAD_TOO_LARGE',
  )
  return validated as CapabilityRpcValidationResult<CapabilityRpcSchemaValue<Schema>>
}

function exactEnvelope(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !isPlainDataObject(value))
    return null
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== expectedKeys.length || ownKeys.some(key => typeof key === 'symbol'))
    return null
  const actualKeys = ownKeys as string[]
  if (actualKeys.some(key => !expectedKeys.includes(key)))
    return null
  const record: Record<string, unknown> = {}
  for (const key of actualKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
      return null
    Object.defineProperty(record, key, {
      configurable: false,
      enumerable: true,
      value: descriptor.value,
      writable: false,
    })
  }
  return Object.freeze(record)
}

const baseEnvelopeKeys = Object.freeze([
  'protocol',
  'version',
  'type',
  'moduleId',
  'sessionId',
  'generation',
  'requestId',
  'capability',
  'operation',
] as const)

function envelopeBase<
  Type extends CapabilityRpcEnvelopeType,
  Capability extends string,
  Operation extends string,
>(
  type: Type,
  identity: CapabilityRpcRequestIdentity,
  capability: Capability,
  operation: Operation,
): CapabilityRpcEnvelopeBase<Type, Capability, Operation> {
  const canonicalIdentity = frozenIdentity(identity)
  return {
    protocol: ONEWEB_CAPABILITY_RPC_PROTOCOL,
    version: ONEWEB_CAPABILITY_RPC_VERSION,
    type,
    moduleId: canonicalIdentity.moduleId,
    sessionId: canonicalIdentity.sessionId,
    generation: canonicalIdentity.generation,
    requestId: canonicalIdentity.requestId,
    capability,
    operation,
  }
}

function assertDescriptor(
  catalog: CapabilityRpcCatalog,
  capability: string,
  operation: string,
) {
  if (!Object.hasOwn(catalog, capability))
    throw new TypeError('CAPABILITY_NOT_ALLOWED')
  const descriptor = operationDescriptor(catalog, capability, operation)
  if (!descriptor)
    throw new TypeError('OPERATION_NOT_ALLOWED')
  return descriptor
}

export function createCapabilityRpcRequestEnvelope<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
  Operation extends CapabilityRpcOperationId<Catalog, Capability>,
>(
  catalog: Catalog,
  identity: CapabilityRpcRequestIdentity,
  capability: Capability,
  operation: Operation,
  payload: CapabilityRpcRequestPayload<Catalog, Capability, Operation>,
): CapabilityRpcRequestEnvelope<
    Capability,
    Operation,
    CapabilityRpcRequestPayload<Catalog, Capability, Operation>
  > {
  const descriptor = assertDescriptor(catalog, capability, operation)
  const validated = cloneForSchema(
    payload,
    descriptor.request,
    CAPABILITY_RPC_REQUEST_PAYLOAD_MAX_BYTES,
    'PAYLOAD_INVALID',
    'PAYLOAD_TOO_LARGE',
  )
  if (!validated.ok)
    throw new TypeError(validated.code)
  return Object.freeze({
    ...envelopeBase('CAPABILITY_REQUEST', identity, capability, operation),
    payload: validated.value,
  }) as CapabilityRpcRequestEnvelope<
    Capability,
    Operation,
    CapabilityRpcRequestPayload<Catalog, Capability, Operation>
  >
}

export function createCapabilityRpcResultEnvelope<
  Catalog extends CapabilityRpcCatalog,
  Capability extends CapabilityRpcCapabilityId<Catalog>,
  Operation extends CapabilityRpcOperationId<Catalog, Capability>,
>(
  catalog: Catalog,
  request: CapabilityRpcRequestEnvelope<Capability, Operation>,
  result: CapabilityRpcResultPayload<Catalog, Capability, Operation>,
): CapabilityRpcResultEnvelope<
    Capability,
    Operation,
    CapabilityRpcResultPayload<Catalog, Capability, Operation>
  > {
  const descriptor = assertDescriptor(catalog, request.capability, request.operation)
  const validated = cloneForSchema(
    result,
    descriptor.result,
    CAPABILITY_RPC_RESULT_MAX_BYTES,
    'RESULT_INVALID',
    'RESULT_TOO_LARGE',
  )
  if (!validated.ok)
    throw new TypeError(validated.code)
  return Object.freeze({
    ...envelopeBase('CAPABILITY_RESULT', request, request.capability, request.operation),
    result: validated.value,
  }) as CapabilityRpcResultEnvelope<
    Capability,
    Operation,
    CapabilityRpcResultPayload<Catalog, Capability, Operation>
  >
}

export function createCapabilityRpcErrorEnvelope<
  Capability extends string,
  Operation extends string,
>(
  _request: CapabilityRpcRequestReference & { readonly capability: Capability, readonly operation: Operation },
  _code: CapabilityRpcErrorCode,
): CapabilityRpcErrorEnvelope<Capability, Operation>
export function createCapabilityRpcErrorEnvelope<
  Capability extends string,
  Operation extends string,
>(
  _request: CapabilityRpcRequestEnvelope<Capability, Operation>,
  _code: CapabilityRpcErrorCode,
): CapabilityRpcErrorEnvelope<Capability, Operation>
export function createCapabilityRpcErrorEnvelope(
  request: CapabilityRpcRequestReference,
  code: CapabilityRpcErrorCode,
): CapabilityRpcErrorEnvelope {
  if (!capabilityRpcErrorCodeSet.has(code))
    throw new TypeError('invalid capability RPC error code')
  return Object.freeze({
    ...envelopeBase('CAPABILITY_ERROR', request, request.capability, request.operation),
    code,
  })
}

export function createCapabilityRpcCancelEnvelope<
  Capability extends string,
  Operation extends string,
>(
  request: CapabilityRpcRequestEnvelope<Capability, Operation>,
): CapabilityRpcCancelEnvelope<Capability, Operation> {
  return Object.freeze({
    ...envelopeBase('CAPABILITY_CANCEL', request, request.capability, request.operation),
  })
}

export function validateCapabilityRpcRequestEnvelope<Catalog extends CapabilityRpcCatalog>(
  catalog: Catalog,
  value: unknown,
  expectedSession: CapabilityRpcSessionBinding,
  manifestCapabilities: readonly string[],
): CapabilityRpcValidationResult<AnyCapabilityRpcRequest<Catalog>> {
  try {
    assertValidBinding(expectedSession)
  }
  catch {
    return validationFailure('SESSION_MISMATCH')
  }
  const record = exactEnvelope(value, [...baseEnvelopeKeys, 'payload'])
  if (!record
    || record.protocol !== ONEWEB_CAPABILITY_RPC_PROTOCOL
    || record.version !== ONEWEB_CAPABILITY_RPC_VERSION
    || record.type !== 'CAPABILITY_REQUEST'
    || typeof record.requestId !== 'string'
    || typeof record.capability !== 'string'
    || typeof record.operation !== 'string') {
    return validationFailure('INVALID_ENVELOPE')
  }
  try {
    assertValidRequestId(record.requestId)
  }
  catch {
    return validationFailure('INVALID_ENVELOPE')
  }
  if (record.moduleId !== expectedSession.moduleId
    || record.sessionId !== expectedSession.sessionId
    || record.generation !== expectedSession.generation) {
    return validationFailure('SESSION_MISMATCH')
  }
  if (!manifestCapabilities.includes(record.capability))
    return validationFailure('CAPABILITY_NOT_DECLARED')
  if (!Object.hasOwn(catalog, record.capability))
    return validationFailure('CAPABILITY_NOT_ALLOWED')
  const descriptor = operationDescriptor(catalog, record.capability, record.operation)
  if (!descriptor)
    return validationFailure('OPERATION_NOT_ALLOWED')
  const payload = cloneForSchema(
    record.payload,
    descriptor.request,
    CAPABILITY_RPC_REQUEST_PAYLOAD_MAX_BYTES,
    'PAYLOAD_INVALID',
    'PAYLOAD_TOO_LARGE',
  )
  if (!payload.ok)
    return payload
  return validationSuccess(Object.freeze({
    ...envelopeBase('CAPABILITY_REQUEST', { ...expectedSession, requestId: record.requestId }, record.capability, record.operation),
    payload: payload.value,
  }) as AnyCapabilityRpcRequest<Catalog>)
}

export function validateCapabilityRpcRequestReference(
  value: unknown,
  expectedSession: CapabilityRpcSessionBinding,
): CapabilityRpcValidationResult<CapabilityRpcRequestReference> {
  try {
    assertValidBinding(expectedSession)
  }
  catch {
    return validationFailure('SESSION_MISMATCH')
  }
  const record = exactEnvelope(value, [...baseEnvelopeKeys, 'payload'])
  if (!record
    || record.protocol !== ONEWEB_CAPABILITY_RPC_PROTOCOL
    || record.version !== ONEWEB_CAPABILITY_RPC_VERSION
    || record.type !== 'CAPABILITY_REQUEST'
    || typeof record.requestId !== 'string'
    || typeof record.capability !== 'string'
    || !capabilityIdPattern.test(record.capability)
    || typeof record.operation !== 'string'
    || !operationIdPattern.test(record.operation)) {
    return validationFailure('INVALID_ENVELOPE')
  }
  try {
    assertValidRequestId(record.requestId)
  }
  catch {
    return validationFailure('INVALID_ENVELOPE')
  }
  if (record.moduleId !== expectedSession.moduleId
    || record.sessionId !== expectedSession.sessionId
    || record.generation !== expectedSession.generation) {
    return validationFailure('SESSION_MISMATCH')
  }
  return validationSuccess(Object.freeze({
    ...envelopeBase(
      'CAPABILITY_REQUEST',
      { ...expectedSession, requestId: record.requestId },
      record.capability,
      record.operation,
    ),
  }))
}

function validateResponseBase(
  value: unknown,
  type: CapabilityRpcEnvelopeType,
  expectedKeys: readonly string[],
  request: CapabilityRpcRequestEnvelope,
): CapabilityRpcValidationResult<Record<string, unknown>> {
  const record = exactEnvelope(value, expectedKeys)
  if (!record)
    return validationFailure('INVALID_ENVELOPE')
  if (record.protocol !== ONEWEB_CAPABILITY_RPC_PROTOCOL
    || record.version !== ONEWEB_CAPABILITY_RPC_VERSION
    || record.type !== type
    || typeof record.requestId !== 'string'
    || typeof record.capability !== 'string'
    || typeof record.operation !== 'string') {
    return validationFailure('INVALID_ENVELOPE')
  }
  if (record.moduleId !== request.moduleId
    || record.sessionId !== request.sessionId
    || record.generation !== request.generation) {
    return validationFailure('SESSION_MISMATCH')
  }
  if (record.requestId !== request.requestId)
    return validationFailure('RESPONSE_MISMATCH')
  if (record.capability !== request.capability || record.operation !== request.operation)
    return validationFailure('RESPONSE_MISMATCH')
  return validationSuccess(record)
}

export function validateCapabilityRpcResultEnvelope<Catalog extends CapabilityRpcCatalog>(
  catalog: Catalog,
  value: unknown,
  request: AnyCapabilityRpcRequest<Catalog>,
): CapabilityRpcValidationResult<AnyCapabilityRpcResult<Catalog>> {
  const base = validateResponseBase(
    value,
    'CAPABILITY_RESULT',
    [...baseEnvelopeKeys, 'result'],
    request,
  )
  if (!base.ok)
    return base
  const descriptor = operationDescriptor(catalog, request.capability, request.operation)
  if (!descriptor)
    return validationFailure('OPERATION_NOT_ALLOWED')
  const result = cloneForSchema(
    base.value.result,
    descriptor.result,
    CAPABILITY_RPC_RESULT_MAX_BYTES,
    'RESULT_INVALID',
    'RESULT_TOO_LARGE',
  )
  if (!result.ok)
    return result
  return validationSuccess(Object.freeze({
    ...envelopeBase('CAPABILITY_RESULT', request, request.capability, request.operation),
    result: result.value,
  }) as AnyCapabilityRpcResult<Catalog>)
}

export function validateCapabilityRpcErrorEnvelope(
  value: unknown,
  request: CapabilityRpcRequestEnvelope,
): CapabilityRpcValidationResult<CapabilityRpcErrorEnvelope> {
  const base = validateResponseBase(
    value,
    'CAPABILITY_ERROR',
    [...baseEnvelopeKeys, 'code'],
    request,
  )
  if (!base.ok)
    return base
  if (typeof base.value.code !== 'string' || !capabilityRpcErrorCodeSet.has(base.value.code))
    return validationFailure('INVALID_ENVELOPE')
  return validationSuccess(Object.freeze({
    ...envelopeBase('CAPABILITY_ERROR', request, request.capability, request.operation),
    code: base.value.code as CapabilityRpcErrorCode,
  }))
}

export function validateCapabilityRpcCancelEnvelope(
  value: unknown,
  request: CapabilityRpcRequestEnvelope,
): CapabilityRpcValidationResult<CapabilityRpcCancelEnvelope> {
  const base = validateResponseBase(
    value,
    'CAPABILITY_CANCEL',
    baseEnvelopeKeys,
    request,
  )
  if (!base.ok)
    return base
  return validationSuccess(Object.freeze({
    ...envelopeBase('CAPABILITY_CANCEL', request, request.capability, request.operation),
  }))
}

export const capabilityRpcRequestStatuses = Object.freeze([
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'timed-out',
  'session-destroyed',
] as const)

export type CapabilityRpcRequestStatus = typeof capabilityRpcRequestStatuses[number]

export interface CapabilityRpcRequestRecord extends CapabilityRpcRequestIdentity {
  readonly capability: string
  readonly operation: string
  readonly status: CapabilityRpcRequestStatus
  readonly startedAt: number
  readonly deadlineAt: number
  readonly completedAt: number | null
  readonly errorCode: CapabilityRpcErrorCode | null
}

export interface CapabilityRpcLifecycleState {
  readonly binding: CapabilityRpcSessionBinding
  readonly status: 'active' | 'destroyed'
  readonly requests: readonly CapabilityRpcRequestRecord[]
  readonly destroyedAt: number | null
}

export type CapabilityRpcLifecycleEvent =
  | { readonly type: 'register', readonly request: CapabilityRpcRequestEnvelope, readonly now: number }
  | { readonly type: 'result', readonly response: CapabilityRpcResultEnvelope, readonly now: number }
  | { readonly type: 'error', readonly response: CapabilityRpcErrorEnvelope, readonly now: number }
  | { readonly type: 'cancel', readonly response: CapabilityRpcCancelEnvelope, readonly now: number }
  | { readonly type: 'timeout', readonly identity: CapabilityRpcRequestIdentity, readonly now: number }
  | { readonly type: 'destroy', readonly now: number }

export type CapabilityRpcLifecycleTransition =
  | { readonly ok: true, readonly state: CapabilityRpcLifecycleState }
  | { readonly ok: false, readonly code: CapabilityRpcErrorCode, readonly state: CapabilityRpcLifecycleState }

function assertTimestamp(now: number) {
  if (!Number.isFinite(now) || now < 0)
    throw new TypeError('lifecycle timestamp must be a non-negative finite number')
}

function freezeRequestRecord(record: CapabilityRpcRequestRecord): CapabilityRpcRequestRecord {
  return Object.freeze({ ...record })
}

function freezeLifecycleState(state: CapabilityRpcLifecycleState): CapabilityRpcLifecycleState {
  return Object.freeze({
    binding: frozenBinding(state.binding),
    status: state.status,
    requests: Object.freeze(state.requests.map(freezeRequestRecord)),
    destroyedAt: state.destroyedAt,
  })
}

export function createCapabilityRpcLifecycleState(
  binding: CapabilityRpcSessionBinding,
): CapabilityRpcLifecycleState {
  return freezeLifecycleState({
    binding,
    status: 'active',
    requests: [],
    destroyedAt: null,
  })
}

function lifecycleFailure(
  state: CapabilityRpcLifecycleState,
  code: CapabilityRpcErrorCode,
): CapabilityRpcLifecycleTransition {
  return Object.freeze({ ok: false, code, state })
}

function lifecycleSuccess(state: CapabilityRpcLifecycleState): CapabilityRpcLifecycleTransition {
  return Object.freeze({ ok: true, state })
}

function sameSession(binding: CapabilityRpcSessionBinding, identity: CapabilityRpcSessionBinding) {
  return binding.moduleId === identity.moduleId
    && binding.sessionId === identity.sessionId
    && binding.generation === identity.generation
}

function terminalState(
  state: CapabilityRpcLifecycleState,
  index: number,
  status: CapabilityRpcRequestStatus,
  now: number,
  errorCode: CapabilityRpcErrorCode | null,
) {
  const requests = [...state.requests]
  requests[index] = freezeRequestRecord({
    ...requests[index],
    status,
    completedAt: now,
    errorCode,
  })
  return freezeLifecycleState({ ...state, requests })
}

function findPendingRequest(
  state: CapabilityRpcLifecycleState,
  identity: CapabilityRpcRequestIdentity,
  capability?: string,
  operation?: string,
): CapabilityRpcLifecycleTransition | { index: number, request: CapabilityRpcRequestRecord } {
  if (!sameSession(state.binding, identity))
    return lifecycleFailure(state, 'SESSION_MISMATCH')
  const index = state.requests.findIndex(request => request.requestId === identity.requestId)
  if (index < 0)
    return lifecycleFailure(state, 'REQUEST_NOT_FOUND')
  const request = state.requests[index]
  if ((capability !== undefined && request.capability !== capability)
    || (operation !== undefined && request.operation !== operation)) {
    return lifecycleFailure(state, 'RESPONSE_MISMATCH')
  }
  if (request.status !== 'pending')
    return lifecycleFailure(state, 'REQUEST_ALREADY_TERMINAL')
  return { index, request }
}

function reduceTerminalResponse(
  state: CapabilityRpcLifecycleState,
  response: CapabilityRpcResultEnvelope | CapabilityRpcErrorEnvelope | CapabilityRpcCancelEnvelope,
  now: number,
  status: 'succeeded' | 'failed' | 'cancelled',
  errorCode: CapabilityRpcErrorCode | null,
): CapabilityRpcLifecycleTransition {
  const pending = findPendingRequest(state, response, response.capability, response.operation)
  if ('ok' in pending)
    return pending
  if (now >= pending.request.deadlineAt) {
    return lifecycleFailure(
      terminalState(state, pending.index, 'timed-out', now, 'REQUEST_TIMED_OUT'),
      'REQUEST_TIMED_OUT',
    )
  }
  return lifecycleSuccess(terminalState(state, pending.index, status, now, errorCode))
}

export function reduceCapabilityRpcLifecycle(
  state: CapabilityRpcLifecycleState,
  event: CapabilityRpcLifecycleEvent,
): CapabilityRpcLifecycleTransition {
  assertTimestamp(event.now)
  if (state.status === 'destroyed') {
    if (event.type === 'destroy')
      return lifecycleSuccess(state)
    return lifecycleFailure(state, 'SESSION_DESTROYED')
  }
  switch (event.type) {
    case 'register': {
      if (!sameSession(state.binding, event.request))
        return lifecycleFailure(state, 'SESSION_MISMATCH')
      if (state.requests.some(request => request.requestId === event.request.requestId))
        return lifecycleFailure(state, 'REQUEST_ID_REUSED')
      if (state.requests.length >= CAPABILITY_RPC_MAX_REQUESTS_PER_SESSION)
        return lifecycleFailure(state, 'SESSION_REQUEST_LIMIT_REACHED')
      const inFlight = state.requests.filter(request => request.status === 'pending').length
      if (inFlight >= CAPABILITY_RPC_MAX_IN_FLIGHT)
        return lifecycleFailure(state, 'IN_FLIGHT_LIMIT_REACHED')
      const request = freezeRequestRecord({
        moduleId: state.binding.moduleId,
        sessionId: state.binding.sessionId,
        generation: state.binding.generation,
        requestId: event.request.requestId,
        capability: event.request.capability,
        operation: event.request.operation,
        status: 'pending',
        startedAt: event.now,
        deadlineAt: event.now + CAPABILITY_RPC_REQUEST_TIMEOUT_MS,
        completedAt: null,
        errorCode: null,
      })
      return lifecycleSuccess(freezeLifecycleState({
        ...state,
        requests: [...state.requests, request],
      }))
    }
    case 'result':
      return reduceTerminalResponse(state, event.response, event.now, 'succeeded', null)
    case 'error':
      return reduceTerminalResponse(state, event.response, event.now, 'failed', event.response.code)
    case 'cancel':
      return reduceTerminalResponse(state, event.response, event.now, 'cancelled', null)
    case 'timeout': {
      const pending = findPendingRequest(state, event.identity)
      if ('ok' in pending)
        return pending
      if (event.now < pending.request.deadlineAt)
        return lifecycleFailure(state, 'TIMEOUT_NOT_REACHED')
      return lifecycleSuccess(terminalState(
        state,
        pending.index,
        'timed-out',
        event.now,
        'REQUEST_TIMED_OUT',
      ))
    }
    case 'destroy': {
      const requests = state.requests.map(request => request.status === 'pending'
        ? freezeRequestRecord({
          ...request,
          status: 'session-destroyed',
          completedAt: event.now,
          errorCode: 'SESSION_DESTROYED',
        })
        : request)
      return lifecycleSuccess(freezeLifecycleState({
        ...state,
        status: 'destroyed',
        requests,
        destroyedAt: event.now,
      }))
    }
  }
}
