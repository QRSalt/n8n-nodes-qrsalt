import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from 'node:test'

/**
 * Runs against `dist/`, not the TypeScript source: n8n's lint rules refuse
 * `node:` imports in a `.ts` file in the package. `npm test` builds first.
 */

const require = createRequire(import.meta.url)
const { verifySignature, DEFAULT_TOLERANCE_SECONDS } = require('../dist/nodes/QrSalt/signature.js')

// Fixed so the digests are the same on every machine.
const ENDPOINT_KEY = 'not-a-real-signing-secret'
const NOW = 1_789_000_000
const BODY = JSON.stringify({ event: 'scan.recorded', data: { code: 'abc123' } })

function sign(body, secret = ENDPOINT_KEY, timestamp = NOW) {
  const mac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

test('a genuine delivery verifies', () => {
  const result = verifySignature({
    body: BODY,
    header: sign(BODY),
    secret: ENDPOINT_KEY,
    nowSeconds: NOW,
  })
  assert.deepEqual(result, { ok: true })
})

test('a changed body is refused, even by one character', () => {
  const header = sign(BODY)
  const tampered = BODY.replace('abc123', 'abc124')
  const result = verifySignature({
    body: tampered,
    header,
    secret: ENDPOINT_KEY,
    nowSeconds: NOW,
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'signature mismatch')
})

test('the raw body is what is signed, so re-serialising it breaks the check', () => {
  // Guards against verifying a re-serialised body: key order and spacing change the digest.
  const header = sign(BODY)
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 2)
  const result = verifySignature({
    body: reserialised,
    header,
    secret: ENDPOINT_KEY,
    nowSeconds: NOW,
  })
  assert.equal(result.ok, false)
})

test('another workspace’s secret does not verify ours', () => {
  const header = sign(BODY, 'a-different-signing-secret')
  const result = verifySignature({ body: BODY, header, secret: ENDPOINT_KEY, nowSeconds: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'signature mismatch')
})

test('a replay is refused even though its signature is genuinely ours', () => {
  // Without this a captured request replays forever with a genuine signature.
  const header = sign(BODY, ENDPOINT_KEY, NOW - DEFAULT_TOLERANCE_SECONDS - 1)
  const result = verifySignature({ body: BODY, header, secret: ENDPOINT_KEY, nowSeconds: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timestamp outside tolerance')
})

test('a timestamp from the future is refused too, not just an old one', () => {
  const header = sign(BODY, ENDPOINT_KEY, NOW + DEFAULT_TOLERANCE_SECONDS + 1)
  const result = verifySignature({ body: BODY, header, secret: ENDPOINT_KEY, nowSeconds: NOW })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'timestamp outside tolerance')
})

test('a delivery inside the tolerance still verifies, so a slow queue is not an outage', () => {
  const header = sign(BODY, ENDPOINT_KEY, NOW - (DEFAULT_TOLERANCE_SECONDS - 5))
  assert.deepEqual(verifySignature({ body: BODY, header, secret: ENDPOINT_KEY, nowSeconds: NOW }), {
    ok: true,
  })
})

test('the tolerance matches what QRSalt signs with: five minutes', () => {
  // Must match the sender's tolerance: stricter drops genuine deliveries, looser widens replays.
  assert.equal(DEFAULT_TOLERANCE_SECONDS, 300)
})

test('no header, no secret, and a malformed header are each refused with a reason', () => {
  const header = sign(BODY)
  assert.equal(
    verifySignature({ body: BODY, header: undefined, secret: ENDPOINT_KEY, nowSeconds: NOW }).ok,
    false,
  )
  assert.equal(verifySignature({ body: BODY, header, secret: '', nowSeconds: NOW }).ok, false)
  for (const bad of ['', 'nonsense', 't=abc,v1=zz', 'v1=deadbeef', 't=1789000000']) {
    const result = verifySignature({
      body: BODY,
      header: bad,
      secret: ENDPOINT_KEY,
      nowSeconds: NOW,
    })
    assert.equal(result.ok, false, `header ${JSON.stringify(bad)} must not verify`)
  }
})

test('a non-hex signature is refused rather than throwing', () => {
  // `timingSafeEqual` throws on unequal lengths and `Buffer.from(_, 'hex')` truncates garbage.
  const result = verifySignature({
    body: BODY,
    header: `t=${NOW},v1=not-hex-at-all`,
    secret: ENDPOINT_KEY,
    nowSeconds: NOW,
  })
  assert.equal(result.ok, false)
})

test('during a secret rotation, one of several offered signatures is enough', () => {
  // More than one v1 value is sent while a secret is being rotated.
  const good = createHmac('sha256', ENDPOINT_KEY).update(`${NOW}.${BODY}`).digest('hex')
  const header = `t=${NOW},v1=00000000000000000000000000000000,v1=${good}`
  assert.deepEqual(verifySignature({ body: BODY, header, secret: ENDPOINT_KEY, nowSeconds: NOW }), {
    ok: true,
  })
})
