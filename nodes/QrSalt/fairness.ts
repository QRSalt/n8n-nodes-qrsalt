import { createHash } from 'node:crypto'
import type { IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow'

/**
 * A fairness id for the keyless calls.
 *
 * QRSalt limits its free endpoints per source address, and on n8n Cloud that
 * address belongs to n8n rather than to you: everybody's workflows leave
 * through a handful of them. Counted per address alone, the first busy
 * workflow of the day would spend the allowance of every other n8n user, and
 * the people refused would have made no calls at all.
 *
 * So the free calls carry an id, and QRSalt counts each id separately under a
 * ceiling for the address. The id is fairness, never identity: it authenticates
 * nothing, anyone could send any value, and QRSalt grants nothing on the
 * strength of it. The header is documented, so other integrations behind a
 * shared address can send one too.
 *
 * What is in it: a hash of this n8n instance's id, which is itself an opaque
 * token — no hostname, no workspace name, no address, nothing about you, and
 * nothing that identifies the instance to anyone who does not already have it.
 * It is hashed rather than sent as it stands because the instance id is n8n's
 * own identifier and not ours to pass on.
 *
 * Stable, not per execution: the same instance sends the same id every time,
 * which is what makes it an allowance rather than a fresh bucket each call.
 */

export const FAIRNESS_HEADER = 'X-QRSalt-Client'

export function fairnessId(seed: string): string {
  const digest = createHash('sha256').update(`qrsalt-n8n:${seed}`).digest('hex')
  return `n8n-${digest.slice(0, 16)}`
}

/**
 * The instance, or the workflow if this n8n is too old to have one.
 *
 * Either is stable across executions. Falling back to the workflow means a
 * busy workflow no longer spends a quiet one's allowance, which is the same
 * bargain one level down.
 */
function seedFor(context: IExecuteSingleFunctions): string {
  try {
    const instance = context.getInstanceId()
    if (instance) return instance
  } catch {
    // Older n8n versions do not offer it.
  }
  return context.getWorkflow().id ?? ''
}

export async function sendFairnessId(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const seed = seedFor(this)
  if (!seed) return requestOptions
  requestOptions.headers = { ...requestOptions.headers, [FAIRNESS_HEADER]: fairnessId(seed) }
  return requestOptions
}
