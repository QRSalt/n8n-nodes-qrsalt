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
  'GET /api/qr/free',
  'POST /api/qr/decode',
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
  'GET /api/v1/utm-presets',
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

// What `POST /api/qr/decode` reads. Retyped here because this package is
// published on its own; a name here that the endpoint has dropped is a 400
// inside somebody's workflow.
const DECODE_FORMATS = ['qr', 'code128', 'code39', 'ean13', 'itf', 'datamatrix', 'pdf417', 'aztec']

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
  // The refusal hook is prepended to every operation, so the file handler is
  // the one further down the list rather than the first.
  const fileAction = (operation) =>
    (operation.routing?.output?.postReceive ?? []).find((action) => action.type === 'binaryData')

  const operations = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .filter(fileAction)
  assert.equal(operations.length, 3, 'the code image and both renders return a file')

  for (const operation of operations) {
    const { request } = operation.routing
    // Without this the body arrives parsed and the file is corrupted.
    assert.equal(request.encoding, 'arraybuffer', `${operation.value} does not ask for raw bytes`)
    assert.equal(request.json, false)
    const action = fileAction(operation)
    assert.equal(action.properties.destinationProperty, '={{$parameter["binaryProperty"]}}')
  }

  const [field] = named(new QrSalt(), 'binaryProperty')
  assert.equal(field.default, 'data', 'n8n nodes agree that the default binary field is "data"')
})

test('the render sends only parameters the QR endpoint reads', () => {
  const node = new QrSalt()
  // Not the operation picker itself: its options carry routing for the call,
  // not a parameter to send with it. Not the free read's fields either: those
  // go to /api/qr/decode, which has its own test below.
  const shown = (property) =>
    property.name !== 'operation' &&
    !property.displayOptions?.show?.operation?.includes('readFree') &&
    (property.displayOptions?.show?.resource?.includes('image') ||
      property.displayOptions?.show?.operation?.includes('render'))

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

test('the free render needs no credential and calls its own origin', () => {
  const node = new QrSalt()
  const [credential] = node.description.credentials
  assert.equal(credential.name, 'qrSaltApi')
  assert.deepEqual(credential.displayOptions?.hide, {
    resource: ['image'],
    operation: ['renderFree', 'readFree'],
  })

  const [free] = named(node, 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => operation.value === 'renderFree')
  assert.ok(free, 'the free render is not offered')
  // The shared baseURL is an expression over the credential, which this call
  // does not have.
  assert.equal(free.routing.request.baseURL, 'https://app.qrsalt.com')
  assert.equal(free.routing.request.url, '/api/qr/free')
  assert.match(free.action, /without an account/)
})

test('the free render offers only what the free endpoint accepts', () => {
  const node = new QrSalt()
  const shownForFree = (property) =>
    property.displayOptions?.show?.operation?.includes('renderFree') &&
    property.displayOptions?.show?.resource?.includes('image')

  const fields = properties(node).filter(shownForFree)
  const sent = fields
    .flatMap((property) => [property, ...(property.options ?? [])])
    .map((property) => property.routing?.send?.property)
    .filter(Boolean)
  assert.deepEqual(
    [...sent].sort(),
    ['bgcolor', 'color', 'data', 'ecc', 'format', 'margin', 'size'],
    'the free render sends something the keyless endpoint refuses',
  )

  const [format] = fields.filter((property) => property.name === 'freeFormat')
  assert.deepEqual((format.options ?? []).map((option) => option.value).sort(), ['png', 'svg'])

  const [size] = fields
    .flatMap((property) => property.options ?? [])
    .filter((option) => option.name === 'size')
  assert.equal(size.typeOptions.maxValue, 512, 'the free size cap is not the keyed one')

  const [content] = fields.filter((property) => property.name === 'freeContent')
  assert.equal(content.required, true)
  assert.match(content.description, /No account and no API key/)
})

test('the free read posts the image itself and needs no credential', () => {
  const node = new QrSalt()
  const [read] = named(node, 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => operation.value === 'readFree')
  assert.ok(read, 'the free read is not offered')

  const { request, send, output } = read.routing
  assert.equal(request.method, 'POST')
  assert.equal(request.baseURL, 'https://app.qrsalt.com', 'the shared baseURL reads a credential')
  assert.equal(request.url, '/api/qr/decode')
  // Parsed or serialised bodies corrupt an image on the way out and hide the
  // API's own error message on the way back.
  assert.equal(request.json, false)
  assert.equal(typeof send.preSend[0], 'function', 'nothing puts the file in the body')
  const decode = output.postReceive[output.postReceive.length - 1]
  assert.equal(typeof decode, 'function', 'nothing puts the text in the output')
  assert.match(read.action, /without an account/)

  const [field] = named(node, 'readBinaryProperty')
  assert.equal(field.required, true)
  assert.equal(field.default, 'data')
  assert.deepEqual(field.displayOptions.show, { resource: ['image'], operation: ['readFree'] })
  assert.ok(!field.routing, 'the image is the body, not a parameter')
})

test('the free read offers exactly the symbologies that endpoint reads', () => {
  const [formats] = named(new QrSalt(), 'readFormats')
  assert.ok(formats, 'the free read offers no choice of symbology')
  assert.equal(formats.routing.send.type, 'query')
  assert.equal(formats.routing.send.property, 'formats')
  // QR alone by default: every extra symbology is another search over the same
  // pixels, and most callers have a QR code.
  assert.equal(formats.default, 'qr')
  assert.deepEqual(
    (formats.options ?? []).map((option) => option.value).sort(),
    [...DECODE_FORMATS, 'all'].sort(),
    'the node offers a symbology /api/qr/decode does not read, or misses one it does',
  )
})

test('both free operations send a fairness id, and the keyed ones do not', async () => {
  const free = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => ['renderFree', 'readFree'].includes(operation.value))
  assert.equal(free.length, 2)

  // A key is counted per key, so a keyed call has no shared address problem to
  // solve and nothing to gain from saying which instance it came from.
  const keyed = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => !['renderFree', 'readFree'].includes(operation.value))
  for (const operation of keyed) {
    const hooks = (operation.routing.send?.preSend ?? []).map((hook) => hook.name)
    assert.ok(!hooks.includes('sendFairnessId'), `${operation.value} sends a fairness id`)
  }

  const instance = {
    getInstanceId: () => 'instance-one',
    getWorkflow: () => ({ id: 'workflow-one', active: true }),
  }
  for (const operation of free) {
    const hooks = operation.routing.send.preSend
    const sender = hooks[hooks.length - 1]
    const { headers } = await sender.call(instance, { headers: { Accept: '*/*' }, url: '' })
    assert.match(headers['X-QRSalt-Client'], /^n8n-[0-9a-f]{16}$/, operation.value)
    assert.equal(headers.Accept, '*/*', 'the hook dropped the headers it was given')
  }
})

test('the fairness id is stable, opaque and carries nothing about the instance', async () => {
  const [render] = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .filter((operation) => operation.value === 'renderFree')
  const send = render.routing.send.preSend[0]

  const idFor = async (context) => (await send.call(context, { url: '' })).headers['X-QRSalt-Client']
  const one = { getInstanceId: () => 'instance-one', getWorkflow: () => ({ id: 'w1', active: true }) }
  const two = { getInstanceId: () => 'instance-two', getWorkflow: () => ({ id: 'w1', active: true }) }

  assert.equal(await idFor(one), await idFor(one), 'a fresh id per call is not an allowance')
  assert.notEqual(await idFor(one), await idFor(two))
  // n8n's own instance id is not ours to pass on, and nothing readable is.
  assert.ok(!(await idFor(one)).includes('instance-one'))

  // An n8n too old to have an instance id still gets an allowance of its own.
  const older = {
    getInstanceId: () => {
      throw new Error('not available')
    },
    getWorkflow: () => ({ id: 'workflow-one', active: true }),
  }
  assert.match(await idFor(older), /^n8n-[0-9a-f]{16}$/)

  // Nothing to key on: the call goes out without the header rather than with a
  // value everyone would share.
  const nameless = { getInstanceId: () => '', getWorkflow: () => ({ active: true }) }
  const sent = await send.call(nameless, { url: '', headers: { Accept: '*/*' } })
  assert.deepEqual(sent.headers, { Accept: '*/*' })
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

/**
 * Deleting: the one operation here that cannot be undone.
 *
 * An agent can drive this node (`usableAsTool`), and an agent's instructions
 * can come from a page somebody else wrote. So the delete asks for two things
 * that an instruction saying "delete it" does not carry: a box ticked in the
 * editor, and the code's own name or short link ending, which QRSalt checks
 * against the record before it erases anything.
 */
function fakeContext(params) {
  return {
    getNode: () => ({ name: 'QRSalt', type: 'n8n-nodes-qrsalt.qrSalt', typeVersion: 1 }),
    getNodeParameter: (name, fallback) => (name in params ? params[name] : fallback),
  }
}

const deleteOperation = () =>
  named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .find((option) => option.value === 'delete')

test('deleting a code says it is permanent and names the permission it needs', () => {
  const operation = deleteOperation()
  assert.match(operation.description, /permanent/i)
  assert.match(operation.description, /Delete permission/)
  assert.ok(operation.description.includes('https://qrsalt.com/pricing'))

  const [toggle] = named(new QrSalt(), 'deleteIsPermanent')
  assert.equal(toggle.type, 'boolean')
  assert.equal(toggle.default, false, 'the permanent-delete toggle must start off')
  const [confirm] = named(new QrSalt(), 'deleteConfirm')
  assert.equal(confirm.required, true)

  for (const field of [toggle, confirm]) {
    assert.deepEqual(field.displayOptions.show.operation, ['delete'])
    assert.deepEqual(field.displayOptions.show.resource, ['code'])
  }
})

test('a delete goes nowhere without the toggle and the confirmation', async () => {
  const [hook] = deleteOperation().routing.send.preSend
  assert.equal(typeof hook, 'function', 'the delete has no check in front of it')

  await assert.rejects(
    () => hook.call(fakeContext({ deleteIsPermanent: false, deleteConfirm: 'Spring menu' }), {}),
    /permanent/i,
  )
  await assert.rejects(
    () => hook.call(fakeContext({ deleteIsPermanent: true, deleteConfirm: '   ' }), {}),
    /short link ending/i,
  )

  // With both, the confirmation travels to the API, which checks it too.
  const sent = await hook.call(
    fakeContext({ deleteIsPermanent: true, deleteConfirm: '  Spring menu  ' }),
    {},
  )
  assert.deepEqual(sent.qs, { confirm: 'Spring menu' })
})

test('nothing in this node deletes more than one code', () => {
  const operations = named(new QrSalt(), 'operation').flatMap((property) => property.options ?? [])
  const deletes = operations.filter((option) => option.routing?.request?.method === 'DELETE')
  assert.equal(deletes.length, 1)
  // One id in the path, so there is no shape of this call that covers a list.
  assert.match(deletes[0].routing.request.url, /\/api\/v1\/codes\/\{\{\$parameter\["codeId"\]\}\}$/)
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

// The editor's node panel searches the display name and the codex alias, and
// nothing else — not the description, not the subtitle. "QRSalt" alone answers
// a search for "qr" and not one for "qr code", so the alias is what makes the
// nodes findable at all.
const CATEGORIES = new Set([
  'Analytics',
  'Communication',
  'Data & Storage',
  'Development',
  'Finance & Accounting',
  'Marketing & Content',
  'Miscellaneous',
  'Productivity',
  'Sales',
  'Utility',
])

test('each codex file is searchable for a QR code and names real categories', () => {
  for (const file of ['QrSalt.node.json', 'QrSaltTrigger.node.json']) {
    const codex = JSON.parse(readFileSync(join(root, 'dist/nodes/QrSalt', file), 'utf8'))
    const alias = codex.alias ?? []

    for (const term of ['QR', 'QR Code', 'QRCode']) {
      assert.ok(alias.includes(term), `${file} loses a search for "${term}"`)
    }
    // Only the action node reads barcodes. The trigger fires on a QRSalt code
    // being scanned, which is not a barcode reader by any reading.
    if (file === 'QrSalt.node.json') {
      for (const term of ['Barcode', 'Barcode Reader', 'EAN13', 'Code 128', 'PDF417']) {
        assert.ok(alias.includes(term), `${file} loses a search for "${term}"`)
      }
    } else {
      assert.ok(!alias.some((term) => /barcode/i.test(term)), `${file} is not a barcode reader`)
    }
    for (const category of codex.categories ?? []) {
      assert.ok(CATEGORIES.has(category), `${file} uses "${category}", which n8n does not offer`)
    }
  }
})

test('the npm listing leads with the words people search for', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

  assert.match(pkg.description, /QR code/, 'the description is the npm and Google snippet')
  for (const keyword of ['qr', 'qr code', 'qr-code', 'qrcode']) {
    assert.ok(pkg.keywords.includes(keyword), `the keywords miss "${keyword}"`)
  }
  // Read (Free) really does read these, each proved by drawing it and reading
  // it back, so the words are ours to use.
  for (const keyword of ['barcode', 'barcode reader', 'ean13', 'code128', 'pdf417']) {
    assert.ok(pkg.keywords.includes(keyword), `the keywords miss "${keyword}"`)
  }
})

// Symbologies QRSalt cannot draw and therefore does not support. Courting a
// search for one of them is a promise the package cannot keep.
const UNREAD = ['ean8', 'ean-8', 'upce', 'upc-e', 'codabar', 'maxicode', 'databar']

test('nothing claims a symbology the reader cannot read', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const claims = [
    ...pkg.keywords,
    ...['QrSalt.node.json', 'QrSaltTrigger.node.json'].flatMap(
      (file) => JSON.parse(readFileSync(join(root, 'dist/nodes/QrSalt', file), 'utf8')).alias ?? [],
    ),
  ].map((claim) => claim.toLowerCase().replace(/\s+/g, ''))

  for (const term of UNREAD) {
    const flat = term.replace(/-/g, '')
    assert.ok(!claims.includes(flat), `"${term}" is promised somewhere and cannot be read`)
  }
})

// What each operation costs whoever runs it, from the API's own entitlement
// checks: the keyless endpoints, the `render` scope every key holds, and the
// read/write/delete scopes, which `needsApiAccess` sells.
const PRICING = 'https://qrsalt.com/pricing'
const KEYLESS = ['renderFree', 'readFree']
const FREE_KEYED = ['render']

const allOperations = () =>
  named(new QrSalt(), 'operation').flatMap((property) => property.options ?? [])

test('every operation says what it needs, and only one of the three things', () => {
  for (const operation of allOperations()) {
    const note = operation.description
    assert.equal(typeof note, 'string', `${operation.value} does not say what it needs`)

    const said = [/No account needed/, /A key made on the Free plan/, /a plan with API access/].filter(
      (shape) => shape.test(note),
    )
    assert.equal(said.length, 1, `${operation.value} says "${note}", which is not one clear answer`)
  }
})

test('the keyless operations say no account is needed, and the sold ones link pricing', () => {
  for (const operation of allOperations()) {
    const note = operation.description
    if (KEYLESS.includes(operation.value)) {
      assert.match(note, /No account needed/, `${operation.value} should need no account`)
      assert.ok(!note.includes(PRICING), `${operation.value} is free and should not sell a plan`)
    } else if (FREE_KEYED.includes(operation.value)) {
      // Every key carries the `render` scope, so this one is not sold either.
      assert.match(note, /A key made on the Free plan/)
      assert.ok(!note.includes(PRICING))
    } else {
      assert.ok(note.includes(PRICING), `${operation.value} needs a plan and does not link prices`)
    }
  }
})

test('the paid operations are introduced by a notice that points at pricing', () => {
  const [notice] = properties(new QrSalt()).filter((property) => property.type === 'notice')
  assert.ok(notice, 'nothing tells the reader about plans before they pick an operation')
  assert.ok(notice.displayName.includes(PRICING))
  // Hidden exactly where the credential is hidden: the two keyless operations.
  assert.deepEqual(notice.displayOptions?.hide, {
    resource: ['image'],
    operation: ['renderFree', 'readFree'],
  })

  const [triggerNotice] = properties(new QrSaltTrigger()).filter(
    (property) => property.type === 'notice',
  )
  assert.ok(triggerNotice?.displayName.includes(PRICING), 'the trigger never mentions the plan')
})

test('the notice sits above the operation picker, where it is read first', () => {
  const list = properties(new QrSalt())
  const notice = list.findIndex((property) => property.type === 'notice')
  const operation = list.findIndex((property) => property.name === 'operation')
  assert.ok(notice >= 0 && notice < operation, 'the notice comes after the first operation picker')
})

test('a refusal keeps the API’s own sentence and adds what to do about it', async () => {
  const [create] = allOperations().filter((operation) => operation.value === 'create')
  const [explain] = create.routing.output.postReceive
  assert.equal(typeof explain, 'function', 'nothing turns a refusal into a message')
  // Without this n8n throws on the status code and the hook never runs.
  assert.equal(create.routing.request.ignoreHttpStatusErrors, true)

  const node = { getNode: () => ({ name: 'QRSalt', type: 'qrSalt', typeVersion: 1 }) }
  const refuse = async (statusCode, body) => {
    try {
      await explain.call(node, [], { statusCode, body, headers: {} })
    } catch (error) {
      return error
    }
    return null
  }

  const said = 'Creating and changing things over the API comes with Pro and above.'
  const plan = await refuse(402, { error: { code: 'plan_required', message: said } })
  assert.ok(plan, 'a 402 came back as a successful item')
  assert.match(plan.message, /Pro and above/, 'QRSalt’s own sentence was swallowed')
  assert.match(plan.description, /plan that includes API access/)
  assert.ok(plan.description.includes(PRICING), 'the refusal does not say where to fix it')

  // A narrow key on a plan that has the API: same 403 handling, same link.
  const scope = await refuse(403, { error: { code: 'forbidden', message: 'No "write" scope.' } })
  assert.match(scope.message, /"write" scope/)
  assert.ok(scope.description.includes(PRICING))

  // A bad key is not a plan problem, so it is not sold a plan.
  const key = await refuse(401, { error: { code: 'unauthenticated', message: 'Not valid.' } })
  assert.match(key.message, /Not valid/)
  assert.ok(!key.description.includes(PRICING), 'a wrong key was answered with a price list')
})

test('a refusal on an image operation is read out of the raw bytes', async () => {
  const [render] = allOperations().filter((operation) => operation.value === 'render')
  const [explain] = render.routing.output.postReceive
  const node = { getNode: () => ({ name: 'QRSalt', type: 'qrSalt', typeVersion: 1 }) }

  // `json: false` means a refusal arrives as a Buffer, not an object.
  const body = Buffer.from(JSON.stringify({ error: { message: 'That API key is not valid.' } }))
  await assert.rejects(
    () => explain.call(node, [], { statusCode: 401, body, headers: {} }),
    /That API key is not valid/,
  )

  // Anything that succeeded passes straight through to the binary handler.
  const items = [{ json: { ok: true } }]
  assert.equal(await explain.call(node, items, { statusCode: 200, body, headers: {} }), items)
})

test('the credential test tells a valid key on a cheap plan the truth', () => {
  const rules = new QrSaltApi().test.rules ?? []
  // Free and Starter are the plans without apiAccess; both mint keys that work.
  const plans = rules.map((rule) => rule.properties.value)
  assert.deepEqual([...plans].sort(), ['FREE', 'STARTER'])

  for (const rule of rules) {
    assert.equal(rule.type, 'responseSuccessBody')
    assert.equal(rule.properties.key, 'data.workspace.plan')
    assert.match(rule.properties.message, /This key works/, 'it reads as a wrong key')
    assert.ok(rule.properties.message.includes(PRICING))
  }
})

test('the nodes say on their own tin what they need', () => {
  assert.match(new QrSalt().description.description, /need no account/)
  assert.match(new QrSalt().description.description, /API access/)
  assert.match(new QrSaltTrigger().description.description, /webhooks/)
})

test('every action names what it acts on, in sentence case', () => {
  const actions = named(new QrSalt(), 'operation')
    .flatMap((property) => property.options ?? [])
    .map((operation) => operation.action)

  for (const action of actions) {
    assert.equal(typeof action, 'string', 'every operation needs an action for the panel')
    assert.match(action, /^[A-Z][a-z]/, `"${action}" should be sentence case`)
    assert.ok(action.split(' ').length > 2, `"${action}" does not say what it acts on`)
  }

  // The QR resources say so in words, since this is the phrase a reader scans.
  const qr = actions.filter((action) => /QR code/.test(action))
  assert.ok(qr.length >= 8, 'the QR code operations should name a QR code')
})
