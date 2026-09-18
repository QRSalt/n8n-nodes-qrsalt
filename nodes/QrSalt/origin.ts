/**
 * Where QRSalt answers. The keyless calls name this origin outright, because
 * there is no credential to read one from; a credential may name another for a
 * self-hosted or staging instance.
 */

export const PUBLIC_ORIGIN = 'https://app.qrsalt.com'

/** The origin a credential points at, without its trailing slash. */
export function credentialOrigin(credentials: { baseUrl?: unknown } | undefined): string {
  const named = typeof credentials?.baseUrl === 'string' ? credentials.baseUrl.trim() : ''
  return (named || PUBLIC_ORIGIN).replace(/\/+$/, '')
}
