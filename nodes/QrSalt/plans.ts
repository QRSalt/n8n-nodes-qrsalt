import type {
  IExecuteSingleFunctions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  INodePropertyOptions,
  INodeTypeDescription,
} from 'n8n-workflow'
import { NodeApiError } from 'n8n-workflow'

/**
 * What each operation costs the person running it, said where they choose it.
 *
 * Three answers, and only three. QRSalt's keyless endpoints need no account at
 * all; `GET /api/qr` needs a key but not a paid plan, because every key carries
 * the `render` scope and the Free plan mints one; everything under `/api/v1`
 * needs the `read`, `write` or `delete` scope, and those are sold — the API
 * refuses them on any plan without `apiAccess`.
 *
 * The three sentences live here rather than being retyped twenty times, so the
 * node, the README and the tests cannot end up disagreeing about which
 * operations are which.
 */

export const PRICING = 'https://qrsalt.com/pricing'

/** Keyless: QR Image → Render (Free) and Read (Free). */
export const NO_ACCOUNT = 'No account needed: this calls a public endpoint.'

/** Needs a key, not a paid plan. Every key can render, including a Free one. */
export const FREE_KEY = 'Needs an API key. A key made on the Free plan can do this one.'

/** Needs a key on a plan that includes API access. */
export const PAID_PLAN = `Needs an API key on a plan with API access: ${PRICING}`

/**
 * Needs the Delete permission as well, which is never ticked for a new key.
 *
 * Said here rather than only in the operation's own fields, because the
 * dropdown is where somebody picks it and the dropdown is the last moment the
 * choice is still free.
 */
export const DELETE_PERMISSION =
  'Permanent, and there is no undo. Deleting a dynamic code stops the printed one working; deleting a static ' +
  'code only removes the saved record, because printed static codes never reach QRSalt. ' +
  `Needs an API key with the Delete permission, on a plan with API access: ${PRICING}`

interface Refusal {
  error?: { code?: string; message?: string }
}

/**
 * The API's error envelope, whatever shape it arrived in.
 *
 * The image operations ask for raw bytes (`json: false`), so a refusal on one
 * of those turns up as a Buffer of JSON rather than an object.
 */
function refusalIn(body: unknown): Refusal | null {
  try {
    if (Buffer.isBuffer(body)) return JSON.parse(body.toString('utf8')) as Refusal
    if (typeof body === 'string') return JSON.parse(body) as Refusal
    if (body && typeof body === 'object') return body as Refusal
  } catch {
    // Not JSON: an HTML error page from something in front of the API.
  }
  return null
}

/**
 * Turn a refusal into the sentence that says what to do about it.
 *
 * The keyed operations ignore HTTP status errors so this hook sees the answer
 * instead of n8n throwing first. That is the only way to keep QRSalt's own
 * message — which names the plan and what the key *can* still do — and add the
 * link to it. Anything that is not a refusal passes straight through.
 */
export async function explainRefusal(
  this: IExecuteSingleFunctions,
  items: INodeExecutionData[],
  response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
  const status = response.statusCode
  if (status < 400) return items

  const refusal = refusalIn(response.body)
  const said = refusal?.error?.message
  const code = refusal?.error?.code

  const plan = status === 402 || status === 403 || code === 'plan_required'
  const key = status === 401

  throw new NodeApiError(this.getNode(), (refusal ?? {}) as never, {
    httpCode: String(status),
    message: said ?? `QRSalt refused this call with HTTP ${status}.`,
    description: plan
      ? `This operation needs a plan that includes API access. Plans and prices: ${PRICING}`
      : key
        ? 'Check the API key in the QRSalt API credential. Keys are made in the QRSalt dashboard under Settings → API keys.'
        : undefined,
  })
}

/** The two keyless operations. Everything else carries the credential. */
const KEYLESS = new Set(['renderFree', 'readFree'])

/** Keyed, but sold to nobody: `render` is the one scope every key holds. */
const FREE_KEYED = new Set(['render'])

/** Operations behind the `delete` scope, which is sold and also opted into. */
const DELETES = new Set(['delete'])

type Operation = INodePropertyOptions & {
  routing?: {
    request?: { ignoreHttpStatusErrors?: boolean }
    output?: { postReceive?: unknown[] }
  }
}

/**
 * Give every operation its requirement note and its refusal handling.
 *
 * Walked rather than written out beside each operation, because the one thing
 * that must not happen is a new operation arriving without a note — an
 * unlabelled option reads as "free like the one above it", and the person finds
 * out otherwise from a 402 in a live workflow.
 */
export function withPlanNotes(description: INodeTypeDescription): INodeTypeDescription {
  for (const property of description.properties) {
    if (property.name !== 'operation') continue

    for (const option of (property.options ?? []) as Operation[]) {
      const value = String(option.value)
      option.description = KEYLESS.has(value)
        ? NO_ACCOUNT
        : FREE_KEYED.has(value)
          ? FREE_KEY
          : DELETES.has(value)
            ? DELETE_PERMISSION
            : PAID_PLAN

      const routing = option.routing
      if (!routing?.request) continue
      // Without this n8n throws on the status code before the hook below ever
      // sees QRSalt's own sentence.
      routing.request.ignoreHttpStatusErrors = true
      routing.output ??= {}
      routing.output.postReceive = [explainRefusal, ...(routing.output.postReceive ?? [])]
    }
  }
  return description
}
