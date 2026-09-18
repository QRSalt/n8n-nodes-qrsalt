import type {
  IExecuteSingleFunctions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  INodePropertyOptions,
  INodeTypeDescription,
} from 'n8n-workflow'
import { NodeApiError } from 'n8n-workflow'

/**
 * What each operation needs, said where the operation is chosen. Three answers:
 * no account, any API key, or an API key on a plan with API access.
 */

export const PRICING = 'https://qrsalt.com/pricing'

/** Keyless: QR Image → Render (Free) and Read (Free). */
export const NO_ACCOUNT = 'No account needed: this calls a public endpoint.'

/** Needs a key, not a paid plan. Any key can render, including a Free one. */
export const FREE_KEY = 'Needs an API key. A key made on the Free plan can do this one.'

/** Needs a key on a plan that includes API access. */
export const PAID_PLAN = `Needs an API key on a plan with API access: ${PRICING}`

/** Needs the Delete permission as well, which is never ticked for a new key. */
export const DELETE_PERMISSION =
  'Permanent, and there is no undo. Deleting a dynamic code stops the printed one working; deleting a static ' +
  'code only removes the saved record, because printed static codes never reach QRSalt. ' +
  `Needs an API key with the Delete permission, on a plan with API access: ${PRICING}`

/** One refusal, read out of either envelope and said the same way. */
interface Refusal {
  /** The API's own sentence. */
  message?: string
  code?: string
  /** 403 only: the scope the key was missing, and the ones it holds. */
  scope?: string
  scopes?: string[]
  /** The flat envelope's follow-up sentence, which usually says how to fix it. */
  hint?: string
}

type Body = Record<string, unknown>

/**
 * The body as an object, whatever it arrived as. The image operations ask for
 * raw bytes (`json: false`), so a refusal there turns up as a Buffer of JSON,
 * and anything in front of the API can answer with an HTML page instead.
 */
function bodyOf(value: unknown): Body | null {
  let parsed: unknown = value
  try {
    if (Buffer.isBuffer(value)) parsed = JSON.parse(value.toString('utf8'))
    else if (typeof value === 'string') parsed = JSON.parse(value)
  } catch {
    // Not JSON: an HTML error page from something in front of the API.
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return parsed as Body
}

const text = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * QRSalt answers a refusal in one of two envelopes, and both have to be read.
 *
 * `/api/v1/*` nests it:      {"error":{"code","message","scope","scopes"}}
 * `/api/qr`, `/api/qr/free`
 * and `/api/qr/decode` flatten it: {"error":"the sentence","hint":"…"}
 *
 * In the flat one the message *is* the value of `error`, so reading only
 * `error.message` leaves the keyless operations — the ones people try first —
 * reporting a bare "HTTP 400" instead of QRSalt's own sentence.
 */
function refusalIn(value: unknown): Refusal | null {
  const body = bodyOf(value)
  if (!body) return null

  const error = body.error
  const hint = text(body.hint)

  if (typeof error === 'string') {
    const message = text(error)
    return message || hint ? { message, hint } : null
  }

  if (error && typeof error === 'object' && !Array.isArray(error)) {
    const nested = error as Body
    const scopes = Array.isArray(nested.scopes)
      ? nested.scopes.filter((scope): scope is string => typeof scope === 'string')
      : undefined
    return {
      message: text(nested.message),
      code: text(nested.code),
      scope: text(nested.scope),
      ...(scopes?.length ? { scopes } : {}),
      hint: hint ?? text(nested.hint),
    }
  }

  // A JSON body with no `error` at all still counts as a refusal at this status,
  // but it says nothing we can quote.
  return hint ? { hint } : null
}

/**
 * Whether this node has a key to send at all.
 *
 * A keyed operation with no credential goes out unauthenticated and comes back
 * 401, exactly like a revoked key does — the two need different sentences, and
 * this is what tells them apart. n8n throws rather than returning nothing when
 * the node has no credential bound, so the throw is the answer. The key itself
 * is never read out of here.
 */
async function hasApiKey(context: IExecuteSingleFunctions): Promise<boolean> {
  try {
    const credentials = await context.getCredentials<{ apiKey?: unknown }>('qrSaltApi')
    return typeof credentials?.apiKey === 'string' && credentials.apiKey.trim() !== ''
  } catch {
    return false
  }
}

/** The name of the operation that was run, or '' if it cannot be read. */
function operationOf(context: IExecuteSingleFunctions): string {
  try {
    return String(context.getNodeParameter('operation', '') ?? '')
  } catch {
    return ''
  }
}

interface Words {
  message: string
  description?: string
}

const ADD_CREDENTIAL =
  'Add a QRSalt API credential to this node: open the node and, under “Credential to connect with”, ' +
  'pick one or choose Create new. The key is made in the QRSalt dashboard under Settings → API keys. ' +
  'QR Image → Render (Free) and Read (Free) are the only two operations that run without one.'

/** What to say about a refusal, by what QRSalt refused it for. */
async function refusalWords(
  context: IExecuteSingleFunctions,
  status: number,
  refusal: Refusal | null,
): Promise<Words> {
  const said = refusal?.message
  const code = refusal?.code

  if (status === 401 && !KEYLESS.has(operationOf(context))) {
    if (!(await hasApiKey(context))) {
      return {
        message: 'This operation needs a QRSalt API key, and this node has none.',
        description: ADD_CREDENTIAL,
      }
    }
    return {
      message: 'QRSalt refused this API key.',
      description:
        'The key in the QRSalt API credential is wrong, or it has been revoked. Check it in the QRSalt ' +
        'dashboard under Settings → API keys, and check that the credential’s Base URL is the instance the ' +
        `key was made on. QRSalt said: ${said ?? 'that API key is not valid'}`,
    }
  }

  // 402 is the plan wall — `limit_reached` shares the status, and `plan_required`
  // is checked by name in case the status ever moves.
  if (status === 402 || code === 'plan_required' || code === 'limit_reached') {
    return {
      message: said ?? 'QRSalt refused this call: the plan does not include it.',
      description: `This operation needs a QRSalt plan that includes API access. Plans and prices: ${PRICING}`,
    }
  }

  // 403 is the key's own permissions: the plan is fine, the key was made narrower.
  if (status === 403) {
    const scope = refusal?.scope
    const held = refusal?.scopes
    return {
      message: said ?? 'QRSalt refused this call.',
      description: scope
        ? `The API key does not have the “${scope}” permission` +
          (held?.length ? `; it has ${held.map((s) => `“${s}”`).join(', ')}` : '') +
          `. Make a key with “${scope}” ticked in the QRSalt dashboard under Settings → API keys, and put ` +
          'that key in the credential. Delete is never ticked for a new key.'
        : 'The API key is not allowed to do this. Check its permissions in the QRSalt dashboard under ' +
          'Settings → API keys.',
    }
  }

  return { message: said ?? `QRSalt refused this call with HTTP ${status}.` }
}

/**
 * Turn a refusal into the sentence that says what to do about it, keeping the
 * API's own message, and fail the step with it. Anything that is not a refusal
 * passes straight through.
 *
 * It has to throw. `ignoreHttpStatusErrors` is set on every operation so that
 * this hook can read QRSalt's own sentence off the body before n8n throws its
 * generic one — but that switch also means nothing else will fail the step, so
 * returning the refusal here would hand the workflow the error text dressed as
 * a successful item.
 */
export async function explainRefusal(
  this: IExecuteSingleFunctions,
  items: INodeExecutionData[],
  response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
  const status = response.statusCode
  if (status < 400) return items

  const refusal = refusalIn(response.body)
  const words = await refusalWords(this, status, refusal)
  const { message } = words

  // The flat envelope's `hint` usually says how to fix it, so it is kept rather
  // than dropped — behind whatever the status already had to say, and never
  // twice if the sentence above already carries it.
  const hint = refusal?.hint
  const description =
    hint && !message.includes(hint) && !words.description?.includes(hint)
      ? words.description
        ? `${words.description} ${hint}`
        : hint
      : words.description

  const error = new NodeApiError(this.getNode(), (bodyOf(response.body) ?? {}) as never, {
    httpCode: String(status),
    message,
    ...(description ? { description } : {}),
  })

  // "Continue on fail" must still say what went wrong. Left to itself n8n's
  // declarative router answers a thrown error with `{ json: {} }` and the error
  // tucked beside it, which reads downstream as an empty success — so put the
  // sentence in the item as well, which is where a node that continues is
  // expected to leave it.
  if (typeof this.continueOnFail === 'function' && this.continueOnFail()) {
    return [
      {
        json: {
          error: message,
          ...(description ? { description } : {}),
          httpCode: status,
        },
        error,
      },
    ]
  }

  throw error
}

/** The two keyless operations. Everything else carries the credential. */
const KEYLESS = new Set(['renderFree', 'readFree'])

/** Keyed, but on every plan: any API key can render. */
const FREE_KEYED = new Set(['render'])

/** Operations that need the Delete permission on the key. */
const DELETES = new Set(['delete'])

type Operation = INodePropertyOptions & {
  routing?: {
    request?: { ignoreHttpStatusErrors?: boolean }
    output?: { postReceive?: unknown[] }
  }
}

/** Give every operation its requirement note and its refusal handling. */
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
      // Without this n8n throws on the status code before the hook above ever
      // sees the API's own sentence.
      routing.request.ignoreHttpStatusErrors = true
      routing.output ??= {}
      const already = routing.output.postReceive ?? []
      // Idempotent: walking the same description twice must not run the hook
      // twice, and must never leave an operation without it.
      routing.output.postReceive = [
        explainRefusal,
        ...already.filter((action) => action !== explainRefusal),
      ]
    }
  }
  return description
}
