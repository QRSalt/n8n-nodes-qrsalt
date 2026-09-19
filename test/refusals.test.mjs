import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * A refusal has to fail the step.
 *
 * Every operation is given `ignoreHttpStatusErrors`, so that the post-receive
 * hook can read QRSalt's own sentence off the body before n8n throws its
 * generic one. That switch also means nothing else fails the step: if the hook
 * returned the body instead of throwing, a 401 would arrive downstream as a
 * perfectly ordinary item carrying the API's error text, and the run would read
 * as a pass. These tests run the real hook against the real shapes the API
 * answers with.
 */

const require = createRequire(import.meta.url)
const { NodeApiError } = require('n8n-workflow')
const { explainRefusal, withPlanNotes, PRICING } = require('../dist/nodes/QrSalt/plans.js')
const { QrSalt } = require('../dist/nodes/QrSalt/QrSalt.node.js')
const { QrSaltTrigger } = require('../dist/nodes/QrSalt/QrSaltTrigger.node.js')

/** One n8n item, as the router hands it to a post-receive hook. */
const ITEMS = [{ json: { error: { code: 'unauthenticated', message: 'nope' } } }]

/**
 * A stand-in for the single-item execution context the router calls the hook
 * with. `key` is the API key the node's credential holds; `null` is a node with
 * no credential bound, which n8n signals by throwing, and `throws` is a
 * credential that exists and could not be handed over.
 */
const context = ({
  key = 'qr_live_test',
  operation = 'create',
  continueOnFail = false,
  throws = null,
} = {}) => ({
  getNode: () => ({ name: 'QRSalt', type: 'qrSalt', typeVersion: 1 }),
  getNodeParameter: (name, fallback) => (name === 'operation' ? operation : fallback),
  getCredentials: async () => {
    if (throws) throw new Error(throws)
    // n8n's own wording for a node the editor has never bound a credential to,
    // which is every node of a workflow that was just imported.
    if (key === null) throw new Error('Node does not require credentials')
    return { apiKey: key, baseUrl: 'https://app.qrsalt.com' }
  },
  continueOnFail: () => continueOnFail,
})

/** The three sentences a 401 on a keyed operation is allowed to produce. */
const SAID = {
  none: 'This node has no QRSalt API credential attached, so the call went out without a key.',
  empty: 'The QRSalt API credential on this node has no API key in it.',
  unreadable:
    'This node’s QRSalt API credential could not be read, so the call went out without a key.',
  unsent: 'This node’s API key never reached QRSalt.',
  refused: 'QRSalt refused this API key.',
}

/** A full response the way n8n hands one on with `returnFullResponse`. */
const answer = (statusCode, body) => ({ statusCode, headers: {}, body })

/** Run the hook and return the error it threw, failing the test if it did not. */
const refused = async (ctx, response) => {
  try {
    await explainRefusal.call(ctx, ITEMS, response)
  } catch (error) {
    return error
  }
  assert.fail(`HTTP ${response.statusCode} was not thrown: the step would have passed`)
}

// The bodies below are the ones app.qrsalt.com really answers with; the 401s
// were taken from a live call with no key and with a wrong one.
const NO_KEY_BODY = {
  error: {
    code: 'unauthenticated',
    message: 'Send your API key as `Authorization: Bearer qr_live_...`.',
  },
}
const BAD_KEY_BODY = { error: { code: 'unauthenticated', message: 'That API key is not valid.' } }
const PLAN_BODY = {
  error: {
    code: 'plan_required',
    message:
      'Creating and changing codes over the API comes with Pro and above. Your key can still render static QR codes and barcodes: GET /api/qr.',
    feature: 'apiAccess',
    scope: 'write',
    suggestedPlan: 'PRO',
  },
}
const SCOPE_BODY = {
  error: {
    code: 'forbidden',
    message:
      'This API key does not have the "delete" scope. It has "render", "read", "write". Create a key with it in Dashboard → API.',
    scope: 'delete',
    scopes: ['render', 'read', 'write'],
  },
}
const VALIDATION_BODY = {
  error: { code: 'invalid_input', message: 'destination must be an http or https URL.' },
}

/**
 * The second envelope. `/api/qr`, `/api/qr/free` and `/api/qr/decode` do not
 * nest the refusal: the message *is* the value of `error`. These four bodies
 * are the ones qrsalt.com really answered with, byte for byte, to a bad colour,
 * a bad size keyless, a bad size with a key, and a file that is not an image.
 */
const FLAT_COLOUR_BODY = {
  error: '"color" must be a hex colour, for example 1F2937.',
  docs: '/qr-code-api/docs#render',
}
const FLAT_SIZE_KEYLESS_BODY = {
  error: '"size" must be a number between 64 and 512 without an API key.',
  hint: 'Larger exports are on /api/qr.',
  docs: '/qr-code-api/docs#render',
}
const FLAT_SIZE_BODY = {
  error: '"size" must be a number between 64 and 2000.',
  docs: '/qr-code-api/docs#render',
}
const FLAT_IMAGE_BODY = {
  error: 'That file is not a PNG, JPEG or WebP image we can read.',
  docs: '/qr-code-api/docs',
}

/**
 * The same refusal as it is sent now: the old field untouched, and the
 * `code`/`message` pair every endpoint carries on top of it.
 */
const UNIFIED_IMAGE_BODY = {
  error: 'That file is not a PNG, JPEG or WebP image we can read.',
  code: 'unsupported_media',
  message: 'That file is not a PNG, JPEG or WebP image we can read.',
  docs: '/qr-code-api/docs',
}

test('401 on a node with no credential says so, and says opening it binds one', async () => {
  const error = await refused(context({ key: null }), answer(401, NO_KEY_BODY))
  assert.ok(error instanceof NodeApiError, 'the step failed with something other than a NodeApiError')
  assert.equal(error.message, SAID.none)
  assert.match(error.description, /Credential to connect with/)
  assert.match(error.description, /Settings → API keys/)
  // The trap that cost an evening: an imported workflow binds nothing until
  // each node is opened, so the sentence has to name it.
  assert.match(error.description, /just imported/)
  assert.match(error.description, /opening each QRSalt node once/)
  assert.match(error.description, /Render \(Free\) and Read \(Free\)/)
  // It must not read as a bad key: there is no key.
  assert.doesNotMatch(error.message, /not valid|revoked/)
})

test('401 on a node that does have a credential says the key is wrong or revoked', async () => {
  const error = await refused(context({ key: 'qr_live_wrong' }), answer(401, BAD_KEY_BODY))
  assert.equal(error.message, SAID.refused)
  assert.match(error.description, /wrong, or it has been revoked/)
  assert.match(error.description, /Base URL/)
  // QRSalt's own sentence is kept.
  assert.match(error.description, /That API key is not valid\./)
  assert.doesNotMatch(error.description, /Credential to connect with/)
})

test('an empty API key is reported as an empty key, not as a missing credential', async () => {
  const error = await refused(context({ key: '   ' }), answer(401, NO_KEY_BODY))
  assert.equal(error.message, SAID.empty)
  assert.match(error.description, /Settings → API keys/)
  assert.doesNotMatch(error.message, /no QRSalt API credential attached/)
})

test('a credential that cannot be read is never reported as a credential that is absent', async () => {
  const error = await refused(
    context({ throws: 'Credentials could not be decrypted' }),
    answer(401, NO_KEY_BODY),
  )
  assert.equal(error.message, SAID.unreadable)
  // The real fault has to survive, or there is nothing to act on.
  assert.match(error.description, /Credentials could not be decrypted/)
  assert.doesNotMatch(error.message, /has no QRSalt API credential attached/)
  assert.doesNotMatch(String(error.description), /Create new/)
})

test('a key that is present but never sent is not blamed on the key', async () => {
  // QRSalt says the header never arrived; the node can read a perfectly good
  // key. Saying "QRSalt refused this API key" there sends people to check a key
  // that is fine.
  const error = await refused(context({ key: 'qr_live_fine' }), answer(401, NO_KEY_BODY))
  assert.equal(error.message, SAID.unsent)
  assert.match(error.description, /no Authorization header/)
  assert.match(error.description, /just imported/)
  assert.match(error.description, /Send your API key as/)
})

test('each credential state has its own sentence, and no two share one', async () => {
  const states = [
    [context({ key: null }), SAID.none],
    [context({ key: '' }), SAID.empty],
    [context({ throws: 'Credential not found' }), SAID.unreadable],
    [context({ key: 'qr_live_fine' }), SAID.unsent],
    [context({ key: 'qr_live_fine' }), SAID.refused, BAD_KEY_BODY],
  ]
  const seen = new Set()
  for (const [ctx, sentence, body = NO_KEY_BODY] of states) {
    const error = await refused(ctx, answer(401, body))
    assert.equal(error.message, sentence)
    assert.ok(!seen.has(sentence), `two credential states say “${sentence}”`)
    seen.add(sentence)
  }
})

test('402 keeps QRSalt’s own sentence and adds the pricing link', async () => {
  const error = await refused(context(), answer(402, PLAN_BODY))
  assert.equal(error.message, PLAN_BODY.error.message)
  assert.match(error.description, /plan that includes API access/)
  assert.ok(error.description.includes(PRICING), 'the pricing link is missing')
  assert.equal(error.httpCode, '402')
})

test('403 names the permission the key is missing, and the ones it has', async () => {
  const error = await refused(context({ operation: 'delete' }), answer(403, SCOPE_BODY))
  assert.equal(error.message, SCOPE_BODY.error.message)
  assert.match(error.description, /does not have the “delete” permission/)
  assert.match(error.description, /“render”, “read”, “write”/)
  assert.match(error.description, /Settings → API keys/)
  // A missing permission is not a plan problem, so it must not send them to buy one.
  assert.doesNotMatch(error.description, /Plans and prices/)
})

test('403 with no scope named still refuses rather than passing', async () => {
  const error = await refused(context(), answer(403, { error: { code: 'forbidden', message: 'No.' } }))
  assert.equal(error.message, 'No.')
  assert.match(error.description, /not allowed to do this/)
})

test('422 is reported with the API’s own message and nothing invented', async () => {
  const error = await refused(context(), answer(422, VALIDATION_BODY))
  assert.equal(error.message, 'destination must be an http or https URL.')
  assert.ok(!error.description, 'a plan or key description was invented for a validation error')
  assert.equal(error.httpCode, '422')
})

test('a 400 on the free renderer says what is wrong with the colour, not “HTTP 400”', async () => {
  const error = await refused(context({ operation: 'renderFree' }), answer(400, FLAT_COLOUR_BODY))
  assert.equal(error.message, '"color" must be a hex colour, for example 1F2937.')
  assert.doesNotMatch(error.message, /HTTP 400/)
  assert.ok(!error.description, 'a description was invented for a plain validation error')
  assert.equal(error.httpCode, '400')
})

test('a 400 on the keyed renderer says what is wrong with the size', async () => {
  const error = await refused(context({ operation: 'render' }), answer(400, FLAT_SIZE_BODY))
  assert.equal(error.message, '"size" must be a number between 64 and 2000.')
  assert.doesNotMatch(error.message, /HTTP 400/)
})

test('a 415 from the free reader says the file is not an image it can read', async () => {
  const error = await refused(context({ operation: 'readFree' }), answer(415, FLAT_IMAGE_BODY))
  assert.equal(error.message, 'That file is not a PNG, JPEG or WebP image we can read.')
  assert.doesNotMatch(error.message, /HTTP 415/)
  assert.equal(error.httpCode, '415')
})

test('a 422 from the free reader says no code was found, and how to widen the search', async () => {
  const error = await refused(
    context({ key: null, operation: 'readFree' }),
    answer(422, {
      error: 'No QR code was found in that image. Add ?formats=all to look for barcodes too.',
      docs: '/qr-code-api/docs',
    }),
  )
  assert.equal(
    error.message,
    'No QR code was found in that image. Add ?formats=all to look for barcodes too.',
  )
  assert.doesNotMatch(error.message, /HTTP 422/)
})

test('the hint is carried too, because it says how to fix it', async () => {
  const error = await refused(
    context({ key: null, operation: 'renderFree' }),
    answer(400, FLAT_SIZE_KEYLESS_BODY),
  )
  assert.equal(error.message, '"size" must be a number between 64 and 512 without an API key.')
  assert.equal(error.description, 'Larger exports are on /api/qr.')
})

test('a flat refusal arriving as a Buffer is read the same way', async () => {
  // Render (Free) asks for raw bytes, so its refusal comes back as a Buffer.
  const body = Buffer.from(JSON.stringify(FLAT_COLOUR_BODY), 'utf8')
  const error = await refused(context({ key: null, operation: 'renderFree' }), answer(400, body))
  assert.equal(error.message, '"color" must be a hex colour, for example 1F2937.')
})

test('a flat refusal arriving as a JSON string is read the same way', async () => {
  const error = await refused(
    context({ operation: 'readFree' }),
    answer(415, JSON.stringify(FLAT_IMAGE_BODY)),
  )
  assert.equal(error.message, 'That file is not a PNG, JPEG or WebP image we can read.')
})

test('a flat 401 on a keyed operation still says to add a credential', async () => {
  // The two envelopes must not change which refusal it is, only where the
  // sentence is read from.
  const error = await refused(
    context({ key: null, operation: 'render' }),
    answer(401, { error: 'Send your API key as `Authorization: Bearer qr_live_...`.' }),
  )
  assert.equal(error.message, SAID.none)
  assert.match(error.description, /Credential to connect with/)
})

test('continue on fail carries the flat sentence and its hint', async () => {
  const out = await explainRefusal.call(
    context({ key: null, operation: 'renderFree', continueOnFail: true }),
    ITEMS,
    answer(400, Buffer.from(JSON.stringify(FLAT_SIZE_KEYLESS_BODY), 'utf8')),
  )
  assert.equal(out[0].json.error, '"size" must be a number between 64 and 512 without an API key.')
  assert.equal(out[0].json.description, 'Larger exports are on /api/qr.')
  assert.equal(out[0].json.httpCode, 400)
  assert.ok(out[0].error instanceof NodeApiError)
})

test('a body that is not JSON is reported as the status', async () => {
  const error = await refused(context(), answer(502, '<html><body>Bad gateway</body></html>'))
  assert.equal(error.message, 'QRSalt refused this call with HTTP 502.')
  assert.ok(!error.description, 'a description was invented for a body that says nothing')
})

test('a Buffer that is not JSON at all is reported as the status, not as garbage', async () => {
  const body = Buffer.from('<html><body>504 Gateway Time-out</body></html>', 'utf8')
  const error = await refused(context({ operation: 'renderFree' }), answer(504, body))
  assert.equal(error.message, 'QRSalt refused this call with HTTP 504.')
  assert.ok(!error.description)
})

test('a Buffer of PNG bytes is not mistaken for a message', async () => {
  const body = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
  const error = await refused(context({ operation: 'renderFree' }), answer(500, body))
  assert.equal(error.message, 'QRSalt refused this call with HTTP 500.')
})

test('a refusal to an image operation arrives as a Buffer and is still read', async () => {
  const body = Buffer.from(JSON.stringify(PLAN_BODY), 'utf8')
  const error = await refused(context({ operation: 'render' }), answer(402, body))
  assert.equal(error.message, PLAN_BODY.error.message)
  assert.ok(error.description.includes(PRICING))
})

test('a keyless operation is never told to add a credential', async () => {
  const error = await refused(
    context({ key: null, operation: 'renderFree' }),
    answer(401, { error: { code: 'unauthenticated', message: 'Refused.' } }),
  )
  assert.equal(error.message, 'Refused.')
  assert.doesNotMatch(String(error.description ?? ''), /Add a QRSalt API credential/)
})

test('a 200 passes through untouched', async () => {
  const items = [{ json: { data: { id: 'c_1' } } }]
  const out = await explainRefusal.call(context(), items, answer(200, { data: { id: 'c_1' } }))
  assert.equal(out, items, 'a good answer was rebuilt instead of passed on')
})

test('a 201 and a 304 pass through untouched', async () => {
  for (const status of [201, 204, 304]) {
    const out = await explainRefusal.call(context(), ITEMS, answer(status, {}))
    assert.equal(out, ITEMS, `HTTP ${status} was treated as a refusal`)
  }
})

test('continue on fail puts the sentence in json.error rather than faking a success', async () => {
  const out = await explainRefusal.call(
    context({ key: null, continueOnFail: true }),
    ITEMS,
    answer(401, NO_KEY_BODY),
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].json.error, SAID.none)
  assert.match(out[0].json.description, /Credential to connect with/)
  assert.equal(out[0].json.httpCode, 401)
  // The item carries the error itself as well, so n8n marks it failed.
  assert.ok(out[0].error instanceof NodeApiError)
  // And it must not carry the API's raw body as though it were data.
  assert.equal(out[0].json.data, undefined)
})

test('continue on fail still fails the item for a plan refusal', async () => {
  const out = await explainRefusal.call(context({ continueOnFail: true }), ITEMS, answer(402, PLAN_BODY))
  assert.equal(out[0].json.error, PLAN_BODY.error.message)
  assert.ok(out[0].json.description.includes(PRICING))
})

/**
 * The structural half: a single operation left without the hook is a single
 * operation that answers a refusal with a passing item.
 */
test('every operation runs the refusal hook first, and lets the hook see the status', () => {
  const node = new QrSalt()
  const operations = node.description.properties
    .filter((property) => property.name === 'operation')
    .flatMap((property) => property.options ?? [])

  assert.ok(operations.length >= 20, 'the operations were not found')
  for (const option of operations) {
    const routing = option.routing
    assert.ok(routing?.request, `${option.value} has no request to route`)
    assert.equal(
      routing.request.ignoreHttpStatusErrors,
      true,
      `${option.value} would throw n8n's generic error before the hook reads QRSalt's own`,
    )
    const postReceive = routing.output?.postReceive ?? []
    assert.equal(
      postReceive[0],
      explainRefusal,
      `${option.value} does not check for a refusal before anything else`,
    )
  }
})

test('the hook is added once, however many times the description is walked', () => {
  const description = new QrSalt().description
  withPlanNotes(description)
  withPlanNotes(description)
  const operations = description.properties
    .filter((property) => property.name === 'operation')
    .flatMap((property) => property.options ?? [])
  for (const option of operations) {
    const postReceive = option.routing?.output?.postReceive ?? []
    const hooks = postReceive.filter((action) => action === explainRefusal)
    assert.equal(hooks.length, 1, `${option.value} runs the refusal hook ${hooks.length} times`)
  }
})

/**
 * The trigger routes nothing, so it cannot swallow a status the way the node
 * could — but every call it makes has to fail the activation rather than report
 * a trigger that will never fire.
 */
const triggerContext = (behaviour) => ({
  getCredentials: async () => ({ apiKey: 'qr_live_test', baseUrl: 'https://app.qrsalt.com' }),
  getNodeWebhookUrl: () => 'https://n8n.example.com/webhook/abc',
  getNodeParameter: () => ['scan.recorded'],
  getWorkflowStaticData: () => ({ endpointId: 'wh_1', secret: 's' }),
  getNode: () => ({ name: 'QRSalt Trigger', type: 'qrSaltTrigger' }),
  helpers: { httpRequestWithAuthentication: behaviour },
})

const refusedHook = async (hook, behaviour) => {
  try {
    await hook.call(triggerContext(behaviour))
  } catch (error) {
    return error
  }
  assert.fail('the hook reported success on a refused call')
}

test('the trigger fails to subscribe rather than reporting a trigger that cannot fire', async () => {
  const hooks = new QrSaltTrigger().webhookMethods.default
  const refuse = async () => {
    throw Object.assign(new Error('That API key is not valid.'), { httpCode: '401' })
  }

  const listing = await refusedHook(hooks.checkExists, refuse)
  assert.match(listing.message, /webhook endpoints/)

  const creating = await refusedHook(hooks.create, refuse)
  // Not "would not accept this API key": a timeout here is not a rejected key.
  assert.match(creating.message, /would not answer for this API key/)

  const removing = await refusedHook(hooks.delete, refuse)
  assert.match(removing.message, /would not remove/)
})

test('the trigger refuses a plan without webhooks instead of registering nothing', async () => {
  const hooks = new QrSaltTrigger().webhookMethods.default
  const error = await refusedHook(hooks.create, async () => ({
    data: { workspace: { plan: 'PRO', planName: 'Pro' }, features: { webhooks: false } },
  }))
  assert.match(error.message, /Webhooks are not included in Pro/)
  assert.ok(error.description.includes(PRICING))
})

test('the credential test asks for a status it can judge, and judges the body', () => {
  const { QrSaltApi } = require('../dist/credentials/QrSaltApi.credentials.js')
  const { test: credentialTest } = new QrSaltApi()
  // No `ignoreHttpStatusErrors` here: n8n's own credential test has to see the
  // 401, and there is no post-receive hook of ours to put it back.
  assert.equal(credentialTest.request.ignoreHttpStatusErrors, undefined)
  for (const rule of credentialTest.rules ?? []) {
    assert.equal(rule.type, 'responseSuccessBody')
  }
})

test('the top-level pair is what a refusal is read from now', async () => {
  const error = await refused(context({ operation: 'readFree' }), answer(415, UNIFIED_IMAGE_BODY))
  assert.equal(error.message, 'That file is not a PNG, JPEG or WebP image we can read.')
  assert.doesNotMatch(error.message, /HTTP 415/)
  assert.equal(error.httpCode, '415')
})

test('a plan wall is recognised by the code wherever the code is carried', async () => {
  const error = await refused(
    context(),
    answer(402, {
      error: { code: 'plan_required', message: 'Creating codes comes with Pro and above.' },
      code: 'plan_required',
      message: 'Creating codes comes with Pro and above.',
    }),
  )
  assert.equal(error.message, 'Creating codes comes with Pro and above.')
  assert.match(error.description, /plan that includes API access/)
})
