import { createHash } from 'node:crypto'
import type { IExecuteSingleFunctions, IHttpRequestOptions } from 'n8n-workflow'

/**
 * A client id for the keyless calls, so one n8n instance's free allowance is
 * kept apart from another's when both leave through the same address.
 *
 * It is a hash of this n8n instance's id: opaque, stable across executions, and
 * carrying no hostname, workspace name or address. It authenticates nothing.
 */

export const FAIRNESS_HEADER = 'X-QRSalt-Client'

export function fairnessId(seed: string): string {
  const digest = createHash('sha256').update(`qrsalt-n8n:${seed}`).digest('hex')
  return `n8n-${digest.slice(0, 16)}`
}

/** The instance id, or the workflow id if this n8n is too old to have one. */
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
