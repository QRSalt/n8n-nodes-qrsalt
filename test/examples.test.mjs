import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { QrSalt } = require('../dist/nodes/QrSalt/QrSalt.node.js')
const { QrSaltTrigger } = require('../dist/nodes/QrSalt/QrSaltTrigger.node.js')

/**
 * The zzz-test workflows report on themselves, and a report that says "ok" when
 * nothing happened is worse than no report: it once passed a run in which the
 * credential was never bound and every call failed. These tests run the Summary
 * node's own code, exactly as it sits in the file, against made-up n8n run data
 * and insist that it says FAIL when there is nothing there.
 */

const read = (name) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../examples/${name}`, import.meta.url)), 'utf8'))

const full = read('zzz-full-test.json')
const trigger = read('zzz-trigger-test.json')

const codeOf = (wf, nodeName) => {
  const node = wf.nodes.find((n) => n.name === nodeName)
  assert.ok(node, `${nodeName} is missing from the workflow`)
  return node.parameters.jsCode
}

/** The Summary node, run over the run data of the nodes it names. */
const runSummary = (nodes) => {
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`Referenced node is unexecuted: no data found for "${name}"`)
    const items = nodes[name]
    return { all: () => items, first: () => items[0] }
  }
  return new Function('$', 'Buffer', codeOf(full, 'Summary'))($, Buffer)[0].json
}

/**
 * The trigger workflow's judge, run over one delivery. `store` is the workflow
 * static data n8n hands a Code node; a fresh one per call unless a test wants
 * to watch the checklist fill up across deliveries.
 */
const runTrigger = (items, store = {}) => {
  const $input = { first: () => items[0], all: () => items }
  const $getWorkflowStaticData = () => store
  return new Function('$input', '$getWorkflowStaticData', codeOf(trigger, 'Delivery Received'))(
    $input,
    $getWorkflowStaticData,
  )[0].json
}

/** One branch node of the trigger workflow, run over the judge's output. */
const runBranch = (name, items) => {
  const $input = { first: () => items[0], all: () => items }
  return new Function('$input', codeOf(trigger, name))($input)
}

const PREFIX = 'zzz-test-20260918T12'
const j = (json, binary) => [binary ? { json, binary } : { json }]
const IMAGE = { data: { mimeType: 'image/png', data: Buffer.from('not really a png').toString('base64') } }
/** What a routing node passes on when it fails and is set to continue. */
const FAILED = [{ json: {}, error: { message: 'The service refused the request', httpCode: '422' } }]
/** An empty item with no error at all: the shape that used to print "ok". */
const EMPTY = [{ json: {} }]

const happy = {
  Prepare: j({ stamp: '20260918T12', prefix: PREFIX }),
  'Check Credential': j({
    statusCode: 200,
    body: { success: true, data: { workspace: { id: 'ws_1', name: 'Acme', plan: 'PRO' } } },
  }),
  'Render (Free)': j({}, IMAGE),
  'Read (Free)': j({
    success: true,
    data: `https://example.com/?${PREFIX}-free`,
    format: 'qr',
    version: 3,
    errorCorrection: 'M',
    mask: 2,
  }),
  Render: j({}, IMAGE),
  'Create QR Code': j({ success: true, data: { id: 'c_a', slug: 'aB3x', shortUrl: 'https://qrsalt.com/aB3x' } }),
  'Create QR Code B': j({ success: true, data: { id: 'c_b' } }),
  'Fire a Scan': j({ statusCode: 302 }),
  'Get QR Code': j({
    success: true,
    data: { id: 'c_a', name: `${PREFIX}-code-a`, status: 'ACTIVE', destination: `https://example.com/?${PREFIX}-a` },
  }),
  'Update QR Code': j({ success: true, data: { id: 'c_a', destination: `https://example.com/?${PREFIX}-a2` } }),
  'Get QR Image': j({}, IMAGE),
  'Get Scans': j({ success: true, data: { summary: { scans: 1, uniques: 1 } } }),
  'Get Many QR Codes': j({ success: true, data: [{ id: 'c_a' }, { id: 'c_b' }] }),
  'Change Many': j({ success: true, data: { action: 'status', done: 2, unchanged: 0, skipped: 0 } }),
  'Create Short Link': j({ success: true, data: { id: 'l_1', shortUrl: 'https://qrsalt.com/zZ9' } }),
  'Get Many Short Links': j({ success: true, data: [{ id: 'l_1' }] }),
  'Get Analytics': j({ success: true, data: { summary: { scans: 5 }, series: [{}, {}], breakdown: [{ scans: 5 }] } }),
  'Create Folder': j({ success: true, data: { id: 'f_1', name: `${PREFIX}-folder` } }),
  'Get Many Folders': j({ success: true, data: [{ id: 'f_1' }] }),
  'Get Many Tags': j({ success: true, data: [] }),
  'Get Many UTM Presets': j({ success: true, data: [] }),
  'Get Many Forms': j({ success: true, data: [] }),
  'Get Form Responses': EMPTY,
  'Get Many QR Menus': j({ success: true, data: [] }),
  'Delete QR Code': j({ success: true, data: { id: 'c_a', status: 'DELETED' } }),
  'Bulk Delete QR Code B': j({ success: true, data: { action: 'delete', done: 1 } }),
  'Delete Short Link': j({ success: true, data: { id: 'l_1', status: 'DELETED' } }),
  'Delete Folder': j({ success: true, data: { id: 'f_1', codesUnfiled: 0 } }),
}

test('a run where everything works is reported as passed', () => {
  const r = runSummary(happy)
  assert.equal(r.passed, true)
  assert.match(r.report, /^RESULT: PASSED/)
  assert.match(r.report, /credential {12}ok {7}workspace=Acme plan=PRO/)
  assert.doesNotMatch(r.report, / {2}FAIL /)
  assert.doesNotMatch(r.report, /MISSING/)
  assert.match(r.report, /FAILURES: none/)
  assert.match(r.report, /cleanup {15}ok {7}4 of 4 objects removed/)
})

/**
 * What n8n really does when a node cannot get its credential: the node never
 * runs, and with continue-on-error its INPUT is handed to the next node with no
 * error anywhere on the item. So the whole run carries the first node's item.
 */
test('the credential never binding is named, and nothing under it claims to have run', () => {
  const nodes = {}
  for (const name of Object.keys(happy)) nodes[name] = happy.Prepare
  nodes['Fire a Scan'] = j({ statusCode: 404 }) // the fallback URL, as the owner saw

  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /^RESULT: FAILED/)
  assert.match(r.report, /credential {12}FAIL {5}credential not set on the Check Credential node/)
  assert.match(r.report, /codeCreate {12}SKIPPED {2}credential not working/)
  // The line that lied last time: a 404 on the short link must never read ok.
  assert.doesNotMatch(r.report, /scanFired {13}ok/)
  assert.doesNotMatch(r.report, / {2}ok {7}id=/)
})

test('a step that never ran but repeats the item before it is a failure, not a pass', () => {
  // Create QR Code B has no credential, so n8n hands on Create QR Code's answer.
  // It carries a data.id of its own and would otherwise read as a fine result.
  const b = { ...happy }
  b['Create QR Code B'] = happy['Create QR Code']
  const rb = runSummary(b)
  assert.equal(rb.passed, false)
  assert.match(rb.report, /codeCreateB {11}FAIL {5}this step handed on the item it was given/)

  // Update QR Code never ran, so the destination that comes back is the old one
  // rather than the one the step set.
  const u = { ...happy }
  u['Update QR Code'] = happy['Get QR Code']
  const ru = runSummary(u)
  assert.equal(ru.passed, false)
  assert.match(ru.report, /codeUpdate {12}FAIL/)
})

test('a refused key is reported with the API sentence, and only the keyless steps still run', () => {
  const keyless = new Set(['Prepare', 'Render (Free)', 'Read (Free)'])
  const nodes = {}
  for (const name of Object.keys(happy)) nodes[name] = keyless.has(name) ? happy[name] : EMPTY
  nodes['Check Credential'] = j({
    statusCode: 401,
    body: { success: false, error: { message: 'API key is invalid or revoked' } },
  })
  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /credential {12}FAIL {5}credential not working — HTTP 401 API key is invalid or revoked/)
  assert.match(r.report, /renderFree {12}ok/)
  assert.match(r.report, /render {16}SKIPPED/)
})

test('a step that errors reports the API message, and its dependents are skipped', () => {
  const nodes = { ...happy }
  nodes['Create QR Code'] = FAILED
  for (const dependent of ['Get QR Code', 'Update QR Code', 'Get QR Image', 'Get Scans', 'Change Many', 'Delete QR Code'])
    nodes[dependent] = EMPTY
  nodes['Fire a Scan'] = j({ statusCode: 404 })

  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /codeCreate {12}FAIL {5}The service refused the request — HTTP 422/)
  assert.match(r.report, /codeGet {15}SKIPPED {2}QR code A was never created/)
  assert.match(r.report, /scanFired {13}SKIPPED/)
  // The objects that were made are still cleaned up.
  assert.match(r.report, /codeBulkDelete {8}ok/)
  assert.match(r.report, /cleanup {15}ok {7}3 of 3 objects removed/)
})

/**
 * The shape the QRSalt node leaves behind when it is refused and the step is
 * set to continue: the sentence in `json.error`, and the error beside it. Every
 * step in the test workflow is set to continue, so this is the shape the report
 * actually meets when the credential is missing — and the run that prompted
 * this test read those steps as passes.
 */
const REFUSED = [
  {
    json: {
      error: 'This operation needs a QRSalt API key, and this node has none.',
      description: 'Add a QRSalt API credential to this node: open the node and, under “Credential to connect with”, pick one or choose Create new.',
      httpCode: 401,
    },
    error: {
      message: 'This operation needs a QRSalt API key, and this node has none.',
      httpCode: '401',
    },
  },
]

/**
 * The bug this guards: every node in the test workflows once carried
 * `onError: continueRegularOutput`. n8n then catches the thrown NodeApiError,
 * marks the node SUCCESSFUL and passes the error text on as data — so a run
 * with no credential at all showed a canvas of green nodes. A test workflow
 * that cannot go red is worth nothing, so nothing here may continue on error
 * except the one step whose failure genuinely means nothing.
 */
test('no step in the test workflows swallows an error, bar the optional scan', () => {
  const MAY_CONTINUE = new Set(['Fire a Scan'])
  for (const [file, wf] of [
    ['zzz-full-test.json', full],
    ['zzz-trigger-test.json', trigger],
  ]) {
    for (const node of wf.nodes) {
      if (MAY_CONTINUE.has(node.name)) continue
      assert.equal(
        node.onError,
        undefined,
        `${file}: "${node.name}" is set to ${node.onError} — a refusal there would show as a green node`,
      )
    }
  }
  // And the one exception is an HTTP Request node of n8n's own, never a QRSalt node.
  for (const node of full.nodes)
    if (MAY_CONTINUE.has(node.name)) assert.ok(!node.type.startsWith('n8n-nodes-qrsalt.'))
})

test('a keyed step refused for want of a credential is a failure, not a pass', () => {
  const keyless = new Set(['Prepare', 'Render (Free)', 'Read (Free)'])
  const nodes = {}
  // The credential node is an HTTP Request node, so it answers with the status.
  for (const name of Object.keys(happy)) nodes[name] = keyless.has(name) ? happy[name] : REFUSED
  nodes['Check Credential'] = j({
    statusCode: 401,
    body: { error: { code: 'unauthenticated', message: 'Send your API key as `Authorization: Bearer qr_live_...`.' } },
  })

  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /^RESULT: FAILED/)
  // Every keyed step says so, and none of them says "ok".
  for (const line of ['render', 'codeCreate', 'linkCreate', 'analytics', 'folderGetMany'])
    assert.match(r.report, new RegExp(`${line} +(FAIL|SKIPPED)`))
  assert.doesNotMatch(r.report, /codeCreate {12}ok/)
  // The keyless pair still ran, because they need no key.
  assert.match(r.report, /renderFree {12}ok/)
  assert.match(r.report, /readFree {14}ok/)
})

test('a keyed step refused while the credential itself works is named, not skipped', () => {
  const nodes = { ...happy }
  nodes['Create QR Code'] = REFUSED
  for (const dependent of ['Get QR Code', 'Update QR Code', 'Get QR Image', 'Get Scans', 'Change Many', 'Delete QR Code'])
    nodes[dependent] = EMPTY
  nodes['Fire a Scan'] = j({ statusCode: 404 })

  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /codeCreate {12}FAIL {5}This operation needs a QRSalt API key/)
})

test('empty items with no error anywhere are failures, not passes', () => {
  const nodes = { Prepare: happy.Prepare, 'Check Credential': happy['Check Credential'] }
  for (const name of Object.keys(happy)) if (!(name in nodes)) nodes[name] = EMPTY
  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  for (const line of ['renderFree', 'readFree', 'render', 'codeCreate', 'linkCreate', 'analytics'])
    assert.match(r.report, new RegExp(`${line} +FAIL`))
  assert.doesNotMatch(r.report, /\?/)
})

test('a node that never ran is a failure, not a pass', () => {
  const nodes = { ...happy }
  delete nodes['Create Short Link']
  delete nodes['Delete Short Link']
  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /linkCreate {12}FAIL {5}this step did not run/)
})

test('a credential set on the QRSalt nodes but not on the check node does not blank the run', () => {
  const nodes = { ...happy }
  nodes['Check Credential'] = [{ json: {}, error: { message: 'Node does not have any credentials set' } }]
  const r = runSummary(nodes)
  assert.equal(r.passed, false)
  assert.match(r.report, /credential {12}FAIL {5}the QRSalt nodes authenticate/)
  assert.match(r.report, /codeCreate {12}ok/)
})

/**
 * One real delivery per event, shaped from the QRSalt webhook contract:
 * `scan.recorded` names the code as `data.codeId`, the three `code.*` events as
 * `data.id`, and `form.submitted` carries `formId` and `responseId`. Getting
 * that wrong is how a trigger test passes a delivery it cannot actually read.
 */
const DELIVERIES = {
  'scan.recorded': {
    id: 'evt_8f3b2c1d9a7e6f5b',
    event: 'scan.recorded',
    createdAt: '2026-09-18T10:00:00.000Z',
    data: { codeId: 'c0de1d00', slug: 'k3Tq9x', scannedAt: '2026-09-18T10:00:00.000Z', country: 'NO' },
  },
  'code.created': {
    id: 'evt_1111111111111111',
    event: 'code.created',
    createdAt: '2026-09-18T10:01:00.000Z',
    data: {
      id: 'c0de1d00',
      slug: 'k3Tq9x',
      name: 'Poster',
      kind: 'DYNAMIC',
      type: 'URL',
      destination: 'https://example.com/',
    },
  },
  'code.updated': {
    id: 'evt_2222222222222222',
    event: 'code.updated',
    createdAt: '2026-09-18T10:02:00.000Z',
    data: {
      id: 'c0de1d00',
      slug: 'k3Tq9x',
      previousDestination: 'https://example.com/old',
      destination: 'https://example.com/new',
    },
  },
  'code.disabled': {
    id: 'evt_3333333333333333',
    event: 'code.disabled',
    createdAt: '2026-09-18T10:03:00.000Z',
    data: { id: 'c0de1d00', slug: 'k3Tq9x', from: 'ACTIVE', status: 'PAUSED' },
  },
  'form.submitted': {
    id: 'evt_4444444444444444',
    event: 'form.submitted',
    createdAt: '2026-09-18T10:04:00.000Z',
    data: {
      formId: 'f0f0f0f0',
      slug: 'Tq8Lm2',
      title: 'How was your visit?',
      responseId: 'a11ce000',
      version: 3,
      answers: [{ questionId: 'f_k2x9q1ab', question: 'How was the food?', kind: 'rating', answer: 4 }],
    },
  },
}

test('every event the node offers is reported as a pass, naming what it is about', () => {
  for (const [event, body] of Object.entries(DELIVERIES)) {
    const r = runTrigger([{ json: body }])
    assert.equal(r.passed, true, `${event} was not reported as a pass: ${r.result}`)
    assert.equal(r.event, event)
    assert.match(r.report, /^RESULT: PASSED/)
    assert.match(r.result, new RegExp(`^PASSED — signed ${event.replace('.', '\\.')} `))
    // The code or form it is about, by name, never a blank.
    assert.match(
      r.subject,
      event === 'form.submitted'
        ? /^form f0f0f0f0 "How was your visit\?", response a11ce000/
        : /^code c0de1d00 \(\/k3Tq9x\)/,
    )
    assert.doesNotMatch(r.report, /MISSING/)
    assert.match(r.report, /FAILURES: none/)
    // Whether the signature verified is stated, not left to be inferred.
    assert.match(r.report, /signature: +verified/)
  }
})

test('the checklist fills up as the five events arrive, and says what is left', () => {
  const store = {}
  let last
  for (const body of Object.values(DELIVERIES)) last = runTrigger([{ json: body }], store)
  assert.deepEqual(store.eventsSeen, Object.keys(DELIVERIES))
  assert.match(last.report, /events so far: .*all five done/)

  const one = runTrigger([{ json: DELIVERIES['scan.recorded'] }])
  assert.match(one.report, /still to fire: code\.created, code\.updated, code\.disabled, form\.submitted/)
})

test('a delivery that names no code or form is a failure, not a pass', () => {
  for (const [items, expected] of [
    [[{ json: {} }], /empty body/],
    [[], /empty body/],
    [[{ json: { id: 'evt_1', createdAt: 'x', data: { codeId: 'c_a' } } }], /no "event"/],
    [
      [{ json: { id: 'evt_1', createdAt: 'x', event: 'code.archived', data: { id: 'c_a' } } }],
      /not one of the five events/,
    ],
    [
      [{ json: { id: 'evt_1', createdAt: 'x', event: 'scan.recorded', data: {} } }],
      /scan\.recorded arrived without data\.codeId/,
    ],
    [
      [{ json: { id: 'evt_1', createdAt: 'x', event: 'code.created', data: { codeId: 'c_a' } } }],
      /code\.created arrived without data\.id/,
    ],
    [
      [{ json: { id: 'evt_1', createdAt: 'x', event: 'form.submitted', data: { formId: 'f_1' } } }],
      /form\.submitted arrived without data\.responseId/,
    ],
    [[{ json: { event: 'scan.recorded', createdAt: 'x', data: { codeId: 'c_a' } } }], /carries no event id/],
    [[{ json: { id: 'evt_1', event: 'scan.recorded', data: { codeId: 'c_a' } } }], /carries no createdAt/],
  ]) {
    const r = runTrigger(items)
    assert.equal(r.passed, false, `this should not have passed: ${r.result}`)
    assert.match(r.report, /^RESULT: FAILED/)
    assert.match(r.report, expected)
    assert.match(r.result, /^FAILED — /)
    assert.doesNotMatch(r.report, /\?\s*$/)
  }
})

/** A failed delivery must not tick its event off the checklist. */
test('a broken delivery does not count as its event having been seen', () => {
  const store = {}
  runTrigger([{ json: { id: 'evt_1', createdAt: 'x', event: 'scan.recorded', data: {} } }], store)
  assert.deepEqual(store.eventsSeen, [])
})

test('a test delivery from the dashboard passes but is labelled as a test', () => {
  const scan = DELIVERIES['scan.recorded']
  const r = runTrigger([{ json: { ...scan, id: 'evt_test_abc', data: { ...scan.data, test: true } } }])
  assert.equal(r.passed, true)
  assert.equal(r.isTest, true)
  assert.match(r.result, /\(test event\)$/)
  assert.match(r.report, /a test delivery from Settings/)
})

/**
 * The branches are what makes the execution readable: exactly one of them holds
 * an item, and it is the one named after the event that arrived.
 */
test('one branch per event takes its own delivery and no other', () => {
  const branches = trigger.nodes
    .filter((n) => n.type === 'n8n-nodes-base.code' && n.name !== 'Delivery Received')
    .map((n) => n.name)
  assert.equal(branches.length, Object.keys(DELIVERIES).length + 1, 'there is not one branch per event plus a fallback')

  for (const [event, body] of Object.entries(DELIVERIES)) {
    const judged = [{ json: runTrigger([{ json: body }]) }]
    const took = branches.filter((name) => runBranch(name, judged).length === 1)
    assert.equal(took.length, 1, `${event} was taken by ${took.length} branches: ${took.join(', ')}`)
    assert.ok(took[0].includes(event), `${event} ended in a branch called "${took[0]}"`)
  }

  // An event nobody subscribed to lands in the fallback and nowhere else.
  const stray = [{ json: runTrigger([{ json: { id: 'e', createdAt: 'x', event: 'code.archived', data: {} } }]) }]
  const caught = branches.filter((name) => runBranch(name, stray).length === 1)
  assert.deepEqual(caught, ['Something else — not subscribed'])
})

/** Every name the report reads has to be a node that ran before it. */
test('every node the Summary judges exists and is upstream of it', () => {
  const names = new Set(full.nodes.map((n) => n.name))
  const parents = new Map(full.nodes.map((n) => [n.name, []]))
  for (const [from, conn] of Object.entries(full.connections))
    for (const branch of conn.main || [])
      for (const link of branch || []) {
        assert.ok(names.has(link.node), `${from} is wired to "${link.node}", which does not exist`)
        parents.get(link.node).push(from)
      }

  const upstream = (node, seen = new Set()) => {
    for (const p of parents.get(node) || []) {
      if (seen.has(p)) continue
      seen.add(p)
      upstream(p, seen)
    }
    return seen
  }
  const above = upstream('Summary')

  const code = codeOf(full, 'Summary')
  const judged = new Set()
  for (const m of code.matchAll(/\bout\(\s*'([^']+)'\s*\)/g)) judged.add(m[1])
  for (const m of code.matchAll(/\b(?:step|listStep)\(\s*'[^']+'\s*,\s*'([^']+)'/g)) judged.add(m[1])
  assert.ok(judged.size > 20, 'the Summary should judge every step')

  for (const name of judged) {
    assert.ok(names.has(name), `the Summary judges "${name}", which is not a node`)
    assert.ok(above.has(name), `the Summary judges "${name}", which is not upstream of it`)
  }
  for (const node of full.nodes)
    if (node.type.startsWith('n8n-nodes-qrsalt'))
      assert.ok(judged.has(node.name), `"${node.name}" runs but no line of the report judges it`)
})

/** Expressions inside nodes have the same problem, one node at a time. */
test('every $() reference in the test workflows names a node upstream of the reader', () => {
  for (const wf of [full, trigger]) {
    const names = new Set(wf.nodes.map((n) => n.name))
    const parents = new Map(wf.nodes.map((n) => [n.name, []]))
    for (const [from, conn] of Object.entries(wf.connections))
      for (const branch of conn.main || []) for (const link of branch || []) parents.get(link.node).push(from)
    const upstream = (node, seen = new Set()) => {
      for (const p of parents.get(node) || []) {
        if (seen.has(p)) continue
        seen.add(p)
        upstream(p, seen)
      }
      return seen
    }
    for (const node of wf.nodes) {
      if (node.name === 'Summary' || node.name === 'Delivery Received') continue
      const above = upstream(node.name)
      for (const m of JSON.stringify(node.parameters || {}).matchAll(/\$\(\s*'([^']+)'\s*\)/g)) {
        assert.ok(names.has(m[1]), `${node.name} reads $('${m[1]}'), which is not a node`)
        assert.ok(above.has(m[1]), `${node.name} reads $('${m[1]}'), which is not upstream of it`)
      }
    }
  }
})

/**
 * A credential in an exported workflow is a reference to one on the instance
 * the file is opened on, so the file cannot carry a useful one. n8n keeps an
 * entry whose id is null (`removeUnknownCredentials` skips it) and then refuses
 * the run with "Found credential with no ID" — which stops even the keyless
 * nodes. Carrying none at all is what lets n8n bind the reader's own credential
 * on import: it only auto-selects for a node whose credentials are empty.
 */
test('no workflow ships a credential of its own', () => {
  for (const [name, wf] of [
    ['zzz-full-test.json', full],
    ['zzz-trigger-test.json', trigger],
    ...['print-batch-from-spreadsheet.json', 'repoint-a-printed-code.json', 'slack-on-scan.json'].map(
      (file) => [file, read(file)],
    ),
  ]) {
    for (const node of wf.nodes) {
      assert.equal(
        node.credentials,
        undefined,
        `${name}: ${node.name} ships a credential, which n8n cannot resolve`,
      )
    }
  }
})

/**
 * An example is a file someone imports and runs. A node type that does not
 * exist, a typeVersion the node never had, a parameter under a name the node
 * does not read, or an event value the API no longer sends all import without
 * complaint and then do nothing — so every QRSalt node in every example is
 * checked against the built node description here, not against this file's
 * idea of it.
 */
const DESCRIPTIONS = Object.fromEntries(
  [new QrSalt().description, new QrSaltTrigger().description].map((d) => [`n8n-nodes-qrsalt.${d.name}`, d]),
)

const EXAMPLES = [
  'zzz-full-test.json',
  'zzz-trigger-test.json',
  'print-batch-from-spreadsheet.json',
  'repoint-a-printed-code.json',
  'slack-on-scan.json',
]

test('every QRSalt node in every example exists, at a version and with parameters the node has', () => {
  let checked = 0
  for (const file of EXAMPLES) {
    for (const node of read(file).nodes) {
      if (!node.type.startsWith('n8n-nodes-qrsalt')) continue
      const description = DESCRIPTIONS[node.type]
      assert.ok(description, `${file}: ${node.name} is a "${node.type}", which this package does not publish`)

      const versions = Array.isArray(description.version) ? description.version : [description.version]
      assert.ok(
        versions.includes(node.typeVersion),
        `${file}: ${node.name} is typeVersion ${node.typeVersion}; the node has ${versions.join(', ')}`,
      )

      const names = new Set(description.properties.map((p) => p.name))
      for (const key of Object.keys(node.parameters ?? {})) {
        assert.ok(names.has(key), `${file}: ${node.name} sets "${key}", which is not a parameter of ${node.type}`)
      }
      checked += 1
    }
  }
  assert.ok(checked > 20, 'no QRSalt nodes were checked, so this test proves nothing')
})

test('every event value an example subscribes to is one the trigger offers', () => {
  const offered = new Set(
    new QrSaltTrigger().description.properties.find((p) => p.name === 'events').options.map((o) => o.value),
  )
  let checked = 0
  for (const file of EXAMPLES) {
    for (const node of read(file).nodes) {
      if (node.type !== 'n8n-nodes-qrsalt.qrSaltTrigger') continue
      const events = node.parameters.events ?? []
      assert.ok(events.length > 0, `${file}: ${node.name} subscribes to no event at all`)
      for (const event of events) {
        assert.ok(offered.has(event), `${file}: ${node.name} subscribes to "${event}", which the node does not offer`)
      }
      checked += 1
    }
  }
  assert.ok(checked > 0, 'no trigger node was checked')
})

/** The point of the file: it has to cover every event, or it proves only one. */
test('the trigger example subscribes to every event the node supports', () => {
  const offered = new QrSaltTrigger()
    .description.properties.find((p) => p.name === 'events')
    .options.map((o) => o.value)
  const triggers = trigger.nodes.filter((n) => n.type === 'n8n-nodes-qrsalt.qrSaltTrigger')
  assert.equal(triggers.length, 1, 'one node subscribes to all five, so there should be exactly one')
  assert.deepEqual([...triggers[0].parameters.events].sort(), [...offered].sort())
})

/** The judge has to know the same five events the node subscribes to. */
test('the trigger example judges exactly the events it subscribes to', () => {
  const code = codeOf(trigger, 'Delivery Received')
  const judged = [...code.matchAll(/^ {2}'([a-z]+\.[a-z]+)':/gm)].map((m) => m[1])
  const subscribed = trigger.nodes.find((n) => n.type === 'n8n-nodes-qrsalt.qrSaltTrigger').parameters.events
  assert.deepEqual([...judged].sort(), [...subscribed].sort())
})

/** The run has to start by proving the key, or a broken key looks like a pass. */
test('the full test checks the credential before anything that needs it', () => {
  const check = full.nodes.find((n) => n.name === 'Check Credential')
  assert.ok(check, 'there is no Check Credential node')
  assert.equal(check.type, 'n8n-nodes-base.httpRequest')
  assert.equal(check.parameters.nodeCredentialType, 'qrSaltApi')
  assert.match(check.parameters.url, /\/api\/v1\/me$/)
  // Answered whatever the status, so a 401 arrives as a 401 and not as nothing.
  assert.equal(check.parameters.options.response.response.neverError, true)
  assert.equal(check.parameters.options.response.response.fullResponse, true)
  // `neverError` keeps a 401 flowing as data so the report can name it, but the
  // node still fails hard on anything else — above all on having no credential
  // at all, which must stop the run rather than hand its input to the next node.
  assert.equal(check.onError, undefined)
  assert.deepEqual(full.connections.Prepare.main[0], [{ node: 'Check Credential', type: 'main', index: 0 }])
})

/**
 * The Summary spots a node that never ran by comparing its item with the item
 * of the step before it, so its idea of the order has to be the real one.
 */
test('the order the Summary believes in is the order the nodes are wired in', () => {
  const code = codeOf(full, 'Summary')
  const chainSource = code.match(/const CHAIN = \[([\s\S]*?)\]/)
  assert.ok(chainSource, 'the Summary has no CHAIN')
  const chain = [...chainSource[1].matchAll(/'([^']+)'/g)].map((m) => m[1])

  const wired = []
  let node = 'Prepare'
  while (node) {
    wired.push(node)
    const next = full.connections[node]?.main?.[0]?.[0]?.node
    node = next === 'Summary' ? null : next
  }
  assert.deepEqual(chain, wired)
})

/** No step may pass an unset value off as a fact. */
test('the reports never print a bare question mark for a missing value', () => {
  for (const code of [codeOf(full, 'Summary'), codeOf(trigger, 'Delivery Received')]) {
    assert.doesNotMatch(code, /'\?'/, 'a missing value must read MISSING, not ?')
    assert.match(code, /MISSING/)
  }
})
