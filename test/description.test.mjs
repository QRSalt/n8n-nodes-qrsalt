import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/**
 * Pins what the nodes claim about the API (https://qrsalt.com/qr-code-api).
 * A routing URL pointing at a retired route looks healthy in the editor and
 * only fails inside a live workflow.
 */

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const { QrSalt } = require('../dist/nodes/QrSalt/QrSalt.node.js')
const { QrSaltTrigger } = require('../dist/nodes/QrSalt/QrSaltTrigger.node.js')
const { QrSaltApi } = require('../dist/credentials/QrSaltApi.credentials.js')

// Every route this package is allowed to call.
const ROUTES = new Set([
  'GET /api/qr',
  'POST /api/v1/codes',
  'GET /api/v1/codes',
  'POST /api/v1/codes/bulk',
  'GET /api/v1/codes/{id}',
  'PATCH /api/v1/codes/{id}',
  'DELETE /api/v1/codes/{id}',
  'GET /api/v1/codes/{id}/image',
  'GET /api/v1/codes/{id}/scans',
  'POST /api/v1/links',
  'GET /api/v1/links',
  'GET /api/v1/analytics',
  'GET /api/v1/folders',
  'POST /api/v1/folders',
  'GET /api/v1/forms',
  'GET /api/v1/forms/{id}/responses',
  'GET /api/v1/pages',
  'GET /api/v1/tags',
  'GET /api/v1/me',
])

// What `GET /api/qr` reads. Anything else is ignored, and `frame`, `label` and
// `framecolor` are refused by name.
const RENDER_PARAMS = new Set([
  'data',
  'format',
  'size',
  'mm',
  'color',
  'bgcolor',
  'eyecolor',
  'style',
  'eyes',
  'eyeframe',
  'eyeball',
  'eyeturn',
  'ecc',
  'margin',
])

// The actions `POST /api/v1/codes/bulk` accepts, less `delete`, which this node
// deliberately does not offer.
const BULK_ACTIONS = ['domain', 'folder', 'tags', 'status', 'utm']

const EVENTS = ['code.created', 'code.updated', 'code.disabled', 'scan.recorded', 'form.submitted']

const DIMENSIONS = [
  'country',
  'region',
  'city',
  'device',
  'os',
  'browser',
  'referrer',
  'hour',
  'weekday',
]

// Put n8n expression holes back as `{id}`.
function normalise(url) {
  return url.replace(/^=/, '').replace(/\{\{\$parameter\["[^"]+"\]\}\}/g, '{id}')
}

const properties = (node) => node.description.properties
const named = (node, name) => properties(node).filter((property) => property.name === name)

test('every operation calls a route the API really answers', () => {
  const operations = named(new QrSalt(), 'operation').flatMap((property) => property.options ?? [])
  assert.ok(operations.length > 0, 'the node offers no operations at all')
  for (const operation of operations) {
    const request = operation.routing?.request
    assert.ok(request?.method && request.url, `${operation.value} has no request`)
    const call = `${request.method} ${normalise(request.url)}`
    assert.ok(ROUTES.has(call), `${operation.value} calls ${call}, which the API does not answer`)
  }
})

test('the trigger subscribes to exactly the events QRSalt sends', () => {
  const [events] = named(new QrSaltTrigger(), 'events')
  const offered = (events?.options ?? []).map((option) => option.value)
  assert.deepEqual([...offered].sort(), [...EVENTS].sort())
})

test('the breakdowns offered are the ones the analytics routes accept', () => {
  const fields = [
    ...named(new QrSalt(), 'dimension'),
    ...named(new QrSalt(), 'scansDimension'),
  ]
  assert.equal(fields.length, 2, 'both analytics operations need a breakdown field')
  for (const field of fields) {
    const values = (field.options ?? []).map((option) => option.value).filter(Boolean)
    assert.deepEqual([...values].sort(), [...DIMENSIONS].sort())
  }
})

test('the short link create sends "url", which is the field the route reads', () => {
  // The links route takes `url`, not `destination`; its schema is strict.
  const [field] = properties(new QrSalt()).filter(
    (property) =>
      property.required === true &&
      property.displayOptions?.show?.resource?.includes('link') &&
      property.displayOptions?.show?.operation?.includes('create'),
  )
  assert.equal(field?.routing?.send?.property, 'url')
})

test('the QR code create sends "destination", which is the field that route reads', () => {
  const [field] = properties(new QrSalt()).filter(
    (property) =>
      property.name === 'destination' &&
      property.displayOptions?.show?.resource?.includes('code') &&
      property.displayOptions?.show?.operation?.includes('create'),
  )
  assert.equal(field?.routing?.send?.property, 'destination')
})

test('the list limit cannot ask for more than the API will give', () => {
  // The route clamps to 100.
  const [limit] = named(new QrSalt(), 'limit')
  assert.equal(limit?.typeOptions?.maxValue, 100)
  assert.equal(limit?.typeOptions?.minValue, 1)
})

test('every image operation asks for bytes and files them where the user said', () => {
  const operations = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => operation.routing?.output?.postReceive)
  assert.equal(operations.length, 2, 'the code image and the render both return a file')

  for (const operation of operations) {
    const { request, output } = operation.routing
    // Without this the body arrives parsed and the file is corrupted.
    assert.equal(request.encoding, 'arraybuffer', `${operation.value} does not ask for raw bytes`)
    assert.equal(request.json, false)
    const [action] = output.postReceive
    assert.equal(action.type, 'binaryData')
    assert.equal(action.properties.destinationProperty, '={{$parameter["binaryProperty"]}}')
  }

  const [field] = named(new QrSalt(), 'binaryProperty')
  assert.equal(field.default, 'data', 'n8n nodes agree that the default binary field is "data"')
})

test('the render sends only parameters the QR endpoint reads', () => {
  const node = new QrSalt()
  const shown = (property) =>
    property.displayOptions?.show?.resource?.includes('image') ||
    property.displayOptions?.show?.operation?.includes('render')

  const sent = properties(node)
    .filter(shown)
    .flatMap((property) => [property, ...(property.options ?? [])])
    .map((property) => property.routing?.send)
    .filter(Boolean)

  assert.ok(sent.length > 10, 'the render offers barely any options')
  for (const send of sent) {
    assert.equal(send.type, 'query', `${send.property} is not a query parameter`)
    assert.ok(RENDER_PARAMS.has(send.property), `the render sends "${send.property}", which /api/qr ignores`)
  }
})

test('the code image sends only the parameters that endpoint reads', () => {
  const [options] = named(new QrSalt(), 'imageOptions')
  const names = (options.options ?? []).map((option) => option.routing.send.property)
  assert.deepEqual([...names].sort(), ['mm', 'size'])

  const [format] = named(new QrSalt(), 'format')
  assert.deepEqual(
    (format.options ?? []).map((option) => option.value).sort(),
    ['jpg', 'pdf', 'png', 'svg', 'webp'],
  )
})

test('the bulk action offers what the API accepts, and never a bulk delete', () => {
  const [action] = named(new QrSalt(), 'bulkAction')
  const values = (action.options ?? []).map((option) => option.value)
  assert.deepEqual([...values].sort(), [...BULK_ACTIONS].sort())
  // Deleting hundreds of live codes from a workflow is not an offer worth making.
  assert.ok(!values.includes('delete'))
})

test('a bulk field that clears something sends null rather than an empty string', () => {
  // `""` is not a hostname and not "no folder"; the API's schema takes null.
  for (const name of ['bulkDomain', 'bulkFolderId']) {
    const [field] = named(new QrSalt(), name)
    assert.equal(field.routing.send.value, '={{$value || null}}', `${name} cannot clear`)
  }
})

test('the action node is offered to agents and the trigger is not', () => {
  assert.equal(new QrSalt().description.usableAsTool, true)
  assert.equal(new QrSaltTrigger().description.usableAsTool, undefined)
  assert.deepEqual(new QrSaltTrigger().description.group, ['trigger'])
})

test('the trigger registers, checks and removes its own endpoint', () => {
  // A missing `delete` leaves a dead endpoint behind every deactivated workflow.
  const hooks = new QrSaltTrigger().webhookMethods.default
  for (const name of ['checkExists', 'create', 'delete']) {
    assert.equal(typeof hooks[name], 'function', `the trigger has no ${name} hook`)
  }
})

test('the webhook is read as raw bytes, because that is what the signature covers', () => {
  const [webhook] = new QrSaltTrigger().description.webhooks
  assert.equal(webhook.rawBody, true)
  assert.equal(webhook.httpMethod, 'POST')
})

test('the credential is tested against the endpoint built for testing credentials', () => {
  // Listing codes would report a new, empty workspace as a broken key.
  const credential = new QrSaltApi()
  assert.equal(credential.test.request.url, '/api/v1/me')
  assert.equal(credential.test.request.method, 'GET')
})

test('the API key is a password field and is sent as a bearer token', () => {
  const credential = new QrSaltApi()
  const key = credential.properties.find((property) => property.name === 'apiKey')
  assert.equal(key?.typeOptions?.password, true)
  assert.equal(
    credential.authenticate.properties.headers.Authorization,
    '=Bearer {{$credentials.apiKey}}',
  )
})

test('every icon a node names is in the build, at the path it names', () => {
  // Icon paths are relative to the compiled file, so check them against dist/.
  const claims = [
    [join(root, 'dist/nodes/QrSalt'), new QrSalt().description.icon],
    [join(root, 'dist/nodes/QrSalt'), new QrSaltTrigger().description.icon],
    [join(root, 'dist/credentials'), new QrSaltApi().icon],
  ]
  for (const [from, icon] of claims) {
    assert.equal(typeof icon, 'object', 'each icon should name a light and a dark file')
    for (const value of Object.values(icon)) {
      assert.ok(value.startsWith('file:'), `${value} should use the file: prefix`)
      const path = resolve(from, value.slice('file:'.length))
      assert.ok(existsSync(path), `${value} does not exist (${path})`)
    }
  }
})

test('package.json points at files the build really produced', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  assert.ok(pkg.name.startsWith('n8n-nodes-'), 'the name must carry the community prefix')
  assert.ok(pkg.keywords.includes('n8n-community-node-package'), 'the keyword is how n8n finds it')
  assert.equal(pkg.license, 'MIT', 'a verified community node must be MIT')
  assert.equal(pkg.n8n.n8nNodesApiVersion, 1)
  // A verified community node may have no runtime dependencies.
  assert.deepEqual(pkg.dependencies ?? {}, {})

  for (const entry of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
    assert.ok(entry.startsWith('dist/'), `${entry} must start with dist/`)
    assert.ok(existsSync(join(root, entry)), `${entry} was not built`)
  }
})
