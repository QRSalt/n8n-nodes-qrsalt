import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Webhook signature scheme (https://qrsalt.com/qr-code-api):
 *
 *   x-qr-signature: t=<unix seconds>,v1=<hex hmac-sha256>
 *
 * The signed material is `${timestamp}.${body}`, using the raw body exactly as
 * delivered — a re-serialised object will not match.
 */

export const SIGNATURE_HEADER = 'x-qr-signature'

/** Five minutes: enough for a slow queue and clock skew, short enough to limit replays. */
export const DEFAULT_TOLERANCE_SECONDS = 300

export type VerifyResult = { ok: true } | { ok: false; reason: string }

/** Constant-time compare of two hex digests; `===` leaks a byte at a time. */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

export interface VerifyInput {
  /** Raw request body, byte for byte as delivered. */
  body: string
  header: string | undefined
  secret: string
  toleranceSeconds?: number
  /** Unix seconds; injectable so the tolerance rule can be tested. */
  nowSeconds?: number
}

export function verifySignature({
  body,
  header,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = Math.floor(Date.now() / 1000),
}: VerifyInput): VerifyResult {
  if (!header) return { ok: false, reason: 'no signature header' }
  if (!secret) return { ok: false, reason: 'no signing secret configured' }

  let timestamp = Number.NaN
  const offered: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.trim().split('=', 2)
    if (!key || value === undefined) continue
    if (key === 't' && /^\d+$/.test(value)) timestamp = Number(value)
    if (key === 'v1') offered.push(value)
  }

  if (!Number.isFinite(timestamp) || offered.length === 0) {
    return { ok: false, reason: 'malformed signature header' }
  }

  // Before the digest: a replay carries a genuine signature, only a stale timestamp.
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp outside tolerance' }
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  for (const candidate of offered) {
    if (sameDigest(expected, candidate)) return { ok: true }
  }
  return { ok: false, reason: 'signature mismatch' }
}
