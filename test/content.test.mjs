import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Every content field the node collects is really sent, in the shape its type
 * takes.
 *
 * The bug this file was written for: the node offered a Type dropdown of a
 * dozen QR code types and then one Destination box. The API reads
 * `destination` as `payload.url`, so a website code worked and every other
 * type came back 422 naming a field — `ssid`, `text`, `firstName` — that the
 * node had never shown anyone. On Update it was worse: Destination on a
 * contact card, a Wi-Fi join, a GS1 link, a review or a location is a key
 * those payloads do not have, so the API dropped it, answered 200 and changed
 * nothing at all.
 *
 * So the check here is mechanical rather than a hand-written example per type:
 * fill every field the node reveals for a type, build the request body the way
 * n8n's router builds it, and assert the payload carries every one of them.
 * A type added to the table with no field behind it fails; a field that stops
 * being sent fails.
 */

const require = createRequire(import.meta.url)
const { Workflow, displayParameter } = require('n8n-workflow')
const { QrSalt } = require('../dist/nodes/QrSalt/QrSalt.node.js')
const { CONTENT_TYPES, CONTENT_TYPE_OPTIONS, fieldName } = require('../dist/nodes/QrSalt/content.js')

const node = new QrSalt()
const properties = node.description.properties

/**
 * The types `POST /api/v1/codes` builds a payload for, retyped here because
 * this package is published on its own. `parsePayload` in the API keys off
 * exactly this list.
 */
const API_TYPES = [
  'URL',
  'TEXT',
  'WIFI',
  'EMAIL',
  'PHONE',
  'SMS',
  'VCARD',
  'GS1',
  'PDF',
  'APP_STORE',
  'REVIEW',
  'LOCATION',
  'EVENT',
  'PAYMENT',
]

/**
 * Types the node must not offer, and the answer each one gives if it does.
 * PDF is the odd one: the API builds it, but its payload names a storage key
 * minted by the upload endpoint, so there is nothing a text field can collect.
 */
const NOT_OFFERED = {
  PDF: 'its key comes from the upload endpoint, not a text field',
  GALLERY: 'the API answers "That code type is not available yet."',
  AUDIO: 'the API answers "That code type is not available yet."',
  LANDING: 'withdrawn; the API refuses the payload by name',
}

/** lodash `set`, which is what the router uses to place a dotted property. */
function setPath(target, path, value) {
  const keys = path.split('.')
  let cursor = target
  for (const key of keys.slice(0, -1)) {
    if (typeof cursor[key] !== 'object' || cursor[key] === null) cursor[key] = {}
    cursor = cursor[key]
  }
  cursor[keys.at(-1)] = value
}

/** A workflow holding this node, so `value` expressions resolve through n8n's engine. */
function resolver(parameters) {
  const nodeTypes = {
    getByName: () => node,
    getByNameAndVersion: () => node,
    getKnownTypes: () => ({}),
  }
  const placed = {
    id: '1',
    name: 'QRSalt',
    type: 'qrSalt',
    typeVersion: 1,
    position: [0, 0],
    parameters,
  }
  const workflow = new Workflow({ id: 'test', nodes: [placed], connections: {}, active: false, nodeTypes })
  // `$value` is the parameter's own value, which is how the router names it
  // inside a `routing.send.value` expression.
  return (expression, $value) =>
    workflow.expression.getParameterValue(expression, null, 0, 0, 'QRSalt', [], 'manual', {
      $credentials: undefined,
      $version: 1,
      $value,
    })
}

/**
 * The body n8n would send for these parameters.
 *
 * The router walks the node's properties, skips any the editor would not
 * display — which is what makes `displayOptions` the thing that keeps one
 * type's fields out of another type's request — and places each `routing.send`
 * value on the body.
 */
function bodyFor(parameters) {
  const resolve = resolver(parameters)
  const placed = { name: 'QRSalt', type: 'qrSalt', typeVersion: 1, position: [0, 0], parameters }
  const body = {}

  const place = (send, raw) => {
    if (!send || send.type !== 'body') return
    const value = send.value === undefined ? raw : resolve(send.value, raw)
    if (value === undefined) return
    setPath(body, send.property, value)
  }

  for (const property of properties) {
    if (!displayParameter(parameters, property, placed, node.description)) continue
    const raw = parameters[property.name]
    if (property.type === 'collection') {
      for (const option of property.options ?? []) {
        if (!raw || !(option.name in raw)) continue
        place(option.routing?.send, raw[option.name])
      }
      continue
    }
    if (raw === undefined && property.routing?.send?.value === undefined) continue
    place(property.routing?.send, raw)
  }
  return body
}

/** A value of the right sort for one field, so the assertion is about presence. */
const sampleFor = (field) =>
  field.type === 'boolean' ? true : field.type === 'number' ? 1 : field.type === 'options' ? field.default : `sample-${field.name}`

/** Every field of a type filled in, as the editor would hand them over. */
function filled(prefix, type) {
  const parameters = {}
  for (const field of type.fields) parameters[fieldName(prefix, type.value, field.name)] = sampleFor(field)
  if (type.extras.length > 0) {
    parameters[fieldName(prefix, type.value, 'extras')] = Object.fromEntries(
      type.extras.map((field) => [field.name, sampleFor(field)]),
    )
  }
  return parameters
}

test('the node offers only content types the API can build, and no others', () => {
  const offered = CONTENT_TYPE_OPTIONS.map((option) => option.value)
  for (const value of offered) {
    assert.ok(API_TYPES.includes(value), `the node offers ${value}, which the API has no payload for`)
    assert.ok(!(value in NOT_OFFERED), `${value} must not be offered: ${NOT_OFFERED[value]}`)
  }
  // Nothing on the table without an entry in the dropdown, and the other way.
  assert.deepEqual(
    [...offered].sort(),
    CONTENT_TYPES.map((type) => type.value).sort(),
  )
  // Every API type is either offered or accounted for by name.
  for (const value of API_TYPES) {
    assert.ok(
      offered.includes(value) || value in NOT_OFFERED,
      `${value} is neither offered nor explained`,
    )
  }
})

test('every type but URL carries content fields of its own', () => {
  for (const type of CONTENT_TYPES) {
    if (type.value === 'URL') continue
    assert.ok(
      type.fields.length > 0,
      `${type.value} is offered with no content field, so it can only be created empty`,
    )
  }
})

/** The whole point: what the user filled in is what goes on the wire. */
for (const [operation, prefix, extra] of [
  ['create', 'create', { resource: 'code', operation: 'create' }],
  ['update', 'update', { resource: 'code', operation: 'update', codeId: 'abc' }],
]) {
  test(`${operation} sends every content field of every type it offers`, () => {
    for (const type of CONTENT_TYPES) {
      const picker = operation === 'create' ? 'type' : 'contentType'
      const parameters = { ...extra, [picker]: type.value, ...filled(prefix, type) }
      const body = bodyFor(parameters)
      const wanted = [...type.fields, ...type.extras]

      if (wanted.length === 0) continue
      assert.ok(body.payload, `${operation} ${type.value} built no payload at all`)
      for (const field of wanted) {
        assert.equal(
          body.payload[field.name],
          sampleFor(field),
          `${operation} ${type.value} does not send payload.${field.name}`,
        )
      }
      // No other type's fields came along for the ride.
      const allowed = new Set([...wanted.map((field) => field.name), 'type'])
      for (const key of Object.keys(body.payload)) {
        assert.ok(allowed.has(key), `${operation} ${type.value} also sent payload.${key}`)
      }
    }
  })
}

test('create sends the website code as the Destination it has always been', () => {
  const body = bodyFor({ resource: 'code', operation: 'create', type: 'URL', destination: 'https://example.com' })
  assert.equal(body.destination, 'https://example.com')
  assert.equal(body.type, 'URL')
  assert.equal(body.payload, undefined, 'a website code needs no payload object')
})

test('Destination is not offered on a type whose content it is not', () => {
  const [destination] = properties.filter(
    (property) =>
      property.name === 'destination' &&
      property.displayOptions?.show?.operation?.includes('create'),
  )
  assert.deepEqual(destination.displayOptions.show.type, ['URL'])

  for (const type of CONTENT_TYPES) {
    if (type.value === 'URL') continue
    const parameters = { resource: 'code', operation: 'create', type: type.value, destination: 'https://example.com' }
    assert.equal(
      bodyFor(parameters).destination,
      undefined,
      `a ${type.value} code still sends destination, which the API reads as payload.url`,
    )
  }
})

/**
 * A payload carrying only its type means "leave the content alone" (the API
 * discounts `type` when it decides whether a payload says anything), and a
 * payload whose type disagrees with the code is refused by name. Both only
 * work if the node sends the type alongside the content.
 */
test('update names the type with the content, and sends nothing while it is unchanged', () => {
  const quiet = bodyFor({ resource: 'code', operation: 'update', codeId: 'abc', contentType: 'UNCHANGED', updateFields: { name: 'New name' } })
  assert.equal(quiet.payload, undefined, 'an Update that only renames a code still sends a payload')
  assert.equal(quiet.name, 'New name')

  for (const type of CONTENT_TYPES) {
    const named = bodyFor({ resource: 'code', operation: 'update', codeId: 'abc', contentType: type.value })
    assert.equal(named.payload?.type, type.value, `update does not tell the API a ${type.value} payload is one`)
    assert.deepEqual(
      Object.keys(named.payload),
      ['type'],
      `${type.value} with nothing filled in sends more than its type, so it would replace the content`,
    )
  }
})

test('the raw payload box sends an object, not the text that was typed', () => {
  const [additional] = properties.filter((property) => property.name === 'additionalFields')
  const [payload] = additional.options.filter((option) => option.name === 'payload')
  assert.ok(payload.routing.send.value, 'the JSON box is routed straight through, so it arrives as a string')

  const body = bodyFor({
    resource: 'code',
    operation: 'create',
    type: 'TEXT',
    additionalFields: { payload: '{"text":"hello"}' },
  })
  assert.deepEqual(body.payload, { text: 'hello' })
})

test('the raw payload box is declared after the fields it overrides', () => {
  const index = (name) => properties.findIndex((property) => property.name === name)
  assert.ok(
    index('additionalFields') > index(fieldName('create', 'WIFI', 'ssid')),
    'the JSON box is placed before the typed fields, so the fields would silently win',
  )
})
