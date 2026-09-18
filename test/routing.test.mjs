import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * The URL each operation really calls, worked out the way n8n works it out.
 *
 * n8n builds a routing request by resolving `requestDefaults` first and then
 * merging the chosen operation's own `routing.request` over it, so an operation
 * that names a `baseURL` wins. The origin in `requestDefaults` is an expression
 * over the credential — and n8n refuses to hand a node a credential that its
 * current parameters hide, which is exactly what the two keyless operations do.
 * So those two are resolved here with no credential at all, and the whole point
 * of them is that they still reach the public host.
 */

const require = createRequire(import.meta.url)
const { Workflow, displayParameter } = require('n8n-workflow')
const { QrSalt } = require('../dist/nodes/QrSalt/QrSalt.node.js')
const { QrSaltTrigger } = require('../dist/nodes/QrSalt/QrSaltTrigger.node.js')
const { QrSaltApi } = require('../dist/credentials/QrSaltApi.credentials.js')

const PUBLIC = 'https://app.qrsalt.com'
const KEYLESS = ['renderFree', 'readFree']

const node = new QrSalt()
const [credential] = node.description.credentials
const credentialBaseUrl = new QrSaltApi().properties.find((p) => p.name === 'baseUrl').default

const operations = node.description.properties
  .filter((property) => property.name === 'operation')
  .flatMap((property) =>
    (property.displayOptions?.show?.resource ?? []).flatMap((resource) =>
      (property.options ?? []).map((option) => ({ resource, operation: option.value, option })),
    ),
  )

/** A workflow holding this node, so expressions resolve through n8n's own engine. */
const resolveWith = (parameters, credentials) => {
  const type = node
  const nodeTypes = {
    getByName: () => type,
    getByNameAndVersion: () => type,
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
  return (value) =>
    workflow.expression.getParameterValue(
      value,
      null,
      0,
      0,
      'QRSalt',
      [],
      'manual',
      { $credentials: credentials, $version: 1 },
      undefined,
      false,
    )
}

/** The origin an operation ends up calling, credential or no credential. */
const originOf = ({ resource, operation, option }) => {
  const parameters = { resource, operation }
  const placed = { name: 'QRSalt', type: 'qrSalt', typeVersion: 1, position: [0, 0], parameters }
  // n8n only gives the node a credential it would also display.
  const shown = displayParameter(parameters, credential, placed, node.description)
  const credentials = shown ? { baseUrl: credentialBaseUrl, apiKey: 'qr_live_test' } : undefined

  const resolve = resolveWith(parameters, credentials)
  const fromDefaults = resolve(node.description.requestDefaults.baseURL)
  const fromOperation = option.routing?.request?.baseURL
  return { shown, url: resolve(fromOperation ?? fromDefaults) }
}

test('the two keyless operations call the public host with no credential at all', () => {
  const calls = {}
  for (const entry of operations) {
    if (!KEYLESS.includes(entry.operation)) continue
    const { shown, url } = originOf(entry)
    assert.equal(shown, false, `${entry.operation} is offered a credential`)
    calls[entry.operation] = url + entry.option.routing.request.url
  }
  assert.deepEqual(calls, {
    renderFree: `${PUBLIC}/api/qr/free`,
    readFree: `${PUBLIC}/api/qr/decode`,
  })
})

test('every keyed operation calls the origin its credential names', () => {
  for (const entry of operations) {
    if (KEYLESS.includes(entry.operation)) continue
    const { shown, url } = originOf(entry)
    assert.equal(shown, true, `${entry.resource} → ${entry.operation} is refused a credential`)
    assert.equal(url, credentialBaseUrl, `${entry.resource} → ${entry.operation} calls ${url}`)
  }
})

/**
 * A self-hosted or staging key moves every keyed call and neither free one.
 */
test('a credential pointing elsewhere moves the keyed calls only', () => {
  const elsewhere = 'https://qr.example.internal'
  for (const entry of operations) {
    const parameters = { resource: entry.resource, operation: entry.operation }
    const resolve = resolveWith(parameters, { baseUrl: elsewhere, apiKey: 'qr_live_test' })
    const base = entry.option.routing?.request?.baseURL ?? node.description.requestDefaults.baseURL
    const url = resolve(base)
    assert.equal(
      url,
      KEYLESS.includes(entry.operation) ? PUBLIC : elsewhere,
      `${entry.operation} calls ${url}`,
    )
  }
})

/**
 * The bug this file was written for: a *required* credential that the chosen
 * operation hides makes n8n fail the run before the request is built, so the
 * keyless operations could never run. Requiring it is only safe if it is shown
 * everywhere.
 */
test('the credential is not required while some operation hides it', () => {
  assert.equal(credential.required, false)
  assert.ok(credential.displayOptions?.hide, 'the credential is hidden on nothing, so it may be required')
})

test('no operation is left without an origin to call', () => {
  for (const entry of operations) {
    const { url } = originOf(entry)
    assert.match(url ?? '', /^https:\/\/\S+$/, `${entry.resource} → ${entry.operation} has no origin`)
  }
})

/**
 * The trigger routes nothing: it calls the API itself, so each URL has to carry
 * its own origin. These run the real hook methods and read what they asked for.
 */
const triggerContext = (answers) => {
  const sent = []
  const staticData = {}
  return {
    sent,
    staticData,
    context: {
      getCredentials: async () => ({ apiKey: 'qr_live_test', baseUrl: credentialBaseUrl }),
      getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
      getNodeParameter: () => ['scan.recorded'],
      getWorkflowStaticData: () => staticData,
      getNode: () => ({ name: 'QRSalt Trigger', type: 'qrSaltTrigger' }),
      helpers: {
        httpRequestWithAuthentication: async (_type, options) => {
          sent.push(options)
          return answers.shift() ?? {}
        },
      },
    },
  }
}

test('every call the trigger makes names the origin the credential points at', async () => {
  const hooks = new QrSaltTrigger().webhookMethods.default

  const exists = triggerContext([{ data: [] }])
  await hooks.checkExists.call(exists.context)

  const create = triggerContext([
    { data: { features: { webhooks: true }, workspace: { plan: 'BUSINESS' } } },
    { data: { id: 'wh_1', secret: 's3cret', events: ['scan.recorded'] } },
  ])
  await hooks.create.call(create.context)

  const remove = triggerContext([{}])
  remove.staticData.endpointId = 'wh_1'
  await hooks.delete.call(remove.context)

  const urls = [...exists.sent, ...create.sent, ...remove.sent].map((options) => options.url)
  assert.deepEqual(urls, [
    `${credentialBaseUrl}/api/v1/webhooks`,
    `${credentialBaseUrl}/api/v1/me`,
    `${credentialBaseUrl}/api/v1/webhooks`,
    `${credentialBaseUrl}/api/v1/webhooks/wh_1`,
  ])
})

test('the credential test calls the origin the credential names', () => {
  const { request } = new QrSaltApi().test
  const resolve = resolveWith({}, { baseUrl: credentialBaseUrl, apiKey: 'qr_live_test' })
  assert.equal(resolve(request.baseURL) + request.url, `${credentialBaseUrl}/api/v1/me`)
})
