import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow'
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow'

import { credentialOrigin } from './origin'
import { PRICING } from './plans'
import { SIGNATURE_HEADER, verifySignature } from './signature'

/** Delivery is at-least-once: a workflow must not assume it has seen every scan. */

/**
 * The trigger builds its own calls rather than routing them, so nothing fills
 * in an origin for it: every URL here is absolute, taken from the credential.
 */
async function apiUrl(context: IHookFunctions, path: string): Promise<string> {
  const credentials = (await context.getCredentials('qrSaltApi')) as { baseUrl?: unknown }
  return `${credentialOrigin(credentials)}${path}`
}

interface Me {
  data?: {
    workspace?: { plan?: string; planName?: string }
    features?: { webhooks?: boolean }
  }
}

interface EndpointList {
  data?: Array<{ id: string; url: string; disabledAt: string | null; disabledReason: string | null }>
}

interface CreatedEndpoint {
  data?: { id?: string; secret?: string; events?: string[] }
}

export class QrSaltTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'QRSalt Trigger',
    name: 'qrSaltTrigger',
    icon: { light: 'file:../../icons/qrsalt.svg', dark: 'file:../../icons/qrsalt.dark.svg' },
    group: ['trigger'],
    version: 1,
    subtitle: '={{$parameter["events"].join(", ")}}',
    description:
      'Starts a workflow when a QR code or short link is scanned, created or changed. Needs an API key on a plan that includes webhooks.',
    defaults: { name: 'QRSalt Trigger' },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'qrSaltApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
        // The signature covers the raw bytes; a re-serialised body never matches.
        rawBody: true,
      },
    ],
    properties: [
      {
        displayName: `This trigger needs a QRSalt plan that includes webhooks. <a href="${PRICING}" target="_blank">Plans and prices</a>.`,
        name: 'planNotice',
        type: 'notice',
        default: '',
      },
      {
        displayName: 'Events',
        name: 'events',
        type: 'multiOptions',
        required: true,
        default: ['scan.recorded'],
        description:
          'Which events start this workflow. Webhooks need a plan that includes them; the node says so when they are not on yours.',
        options: [
          {
            name: 'Code Created',
            value: 'code.created',
            description: 'A code or short link was made',
          },
          {
            name: 'Code Disabled',
            value: 'code.disabled',
            description: 'A code was paused, deleted or disabled',
          },
          {
            name: 'Code Scanned',
            value: 'scan.recorded',
            description: 'Someone scanned a code or opened a short link',
          },
          {
            name: 'Code Updated',
            value: 'code.updated',
            description: 'A code was re-pointed, or its link, domain or campaign tags changed',
          },
          {
            name: 'Form Answered',
            value: 'form.submitted',
            description: 'A QR Form was answered; the answers are included',
          },
        ],
      },
    ],
  }

  webhookMethods = {
    default: {
      // Matched on URL, not a stored id: endpoints can also be deleted from the dashboard.
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl('default')
        let existing: EndpointList
        try {
          existing = (await this.helpers.httpRequestWithAuthentication.call(this, 'qrSaltApi', {
            method: 'GET',
            url: await apiUrl(this, '/api/v1/webhooks'),
            json: true,
          })) as EndpointList
        } catch (error) {
          throw new NodeApiError(this.getNode(), error as never, {
            message: 'QRSalt would not list this workspace’s webhook endpoints.',
          })
        }

        const mine = (existing.data ?? []).find((endpoint) => endpoint.url === webhookUrl)
        if (!mine) return false

        // Registered but switched off: delivery gave up on it. Say so rather
        // than reporting a healthy trigger that will never fire again.
        if (mine.disabledAt) {
          throw new NodeOperationError(
            this.getNode(),
            'QRSalt switched this endpoint off after repeated delivery failures.',
            {
              description:
                mine.disabledReason ??
                'Deactivate and reactivate the workflow to register it again, once whatever was failing is fixed.',
            },
          )
        }
        this.getWorkflowStaticData('node').endpointId = mine.id
        return true
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const webhookUrl = this.getNodeWebhookUrl('default')
        const events = this.getNodeParameter('events') as string[]

        // Check the plan first, so activation reports the real reason rather
        // than a 403 from a call the user never made.
        let me: Me
        try {
          me = (await this.helpers.httpRequestWithAuthentication.call(this, 'qrSaltApi', {
            method: 'GET',
            url: await apiUrl(this, '/api/v1/me'),
            json: true,
          })) as Me
        } catch (error) {
          throw new NodeApiError(this.getNode(), error as never, {
            message: 'QRSalt would not accept this API key.',
            description: `Check the key in the credential, and that its workspace still has a plan with API access: ${PRICING}`,
          })
        }

        if (me.data?.features?.webhooks !== true) {
          const plan = me.data?.workspace?.planName ?? me.data?.workspace?.plan ?? 'your plan'
          throw new NodeOperationError(
            this.getNode(),
            `Webhooks are not included in ${plan}, so this trigger cannot subscribe.`,
            {
              description:
                `Webhooks are a Business feature. Plans and prices: ${PRICING}. Or read scans on a schedule with the QRSalt node instead.`,
            },
          )
        }

        let created: CreatedEndpoint
        try {
          created = (await this.helpers.httpRequestWithAuthentication.call(this, 'qrSaltApi', {
            method: 'POST',
            url: await apiUrl(this, '/api/v1/webhooks'),
            body: { url: webhookUrl, events },
            json: true,
          })) as CreatedEndpoint
        } catch (error) {
          throw new NodeApiError(this.getNode(), error as never, {
            message: 'QRSalt would not register this workflow’s webhook URL.',
            description:
              'The URL has to be one QRSalt can reach from the internet, so a localhost or private-network n8n is refused. Check too that the workspace is not already at its limit of endpoints.',
          })
        }

        const endpoint = created.data
        if (!endpoint?.id || !endpoint.secret) {
          throw new NodeOperationError(
            this.getNode(),
            'QRSalt did not return an endpoint ID and signing secret.',
            {
              description:
                'The workflow cannot verify deliveries without them, so it will not start on an unverified request.',
            },
          )
        }

        // Compare against the events the API echoed back: an event it no longer
        // sends would otherwise look subscribed and never fire.
        const subscribed = new Set(endpoint.events ?? [])
        const missing = events.filter((event) => !subscribed.has(event))
        if (missing.length > 0) {
          // Best effort: the event error below is the one to act on, so a failed
          // cleanup must not replace it. The description says what it can leave.
          await this.helpers.httpRequestWithAuthentication
            .call(this, 'qrSaltApi', {
              method: 'DELETE',
              url: await apiUrl(this, `/api/v1/webhooks/${endpoint.id}`),
              json: true,
            })
            .catch(() => undefined)
          throw new NodeOperationError(
            this.getNode(),
            `QRSalt no longer has these events: ${missing.join(', ')}.`,
            {
              description:
                'Remove them under Events and activate the workflow again. The endpoint just registered is removed again, but if that removal did not go through it is still listed under Settings → Webhooks in QRSalt.',
            },
          )
        }

        // The secret is returned only by this call; losing it means recreating the endpoint.
        const data = this.getWorkflowStaticData('node')
        data.endpointId = endpoint.id
        data.secret = endpoint.secret
        return true
      },

      // Leaving the endpoint registered would leave it failing after the
      // workflow is switched off.
      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node')
        const endpointId = data.endpointId as string | undefined
        if (!endpointId) return true

        try {
          await this.helpers.httpRequestWithAuthentication.call(this, 'qrSaltApi', {
            method: 'DELETE',
            url: await apiUrl(this, `/api/v1/webhooks/${endpointId}`),
            json: true,
          })
        } catch (error) {
          // 404 means it is already gone; anything else leaves a live endpoint behind.
          const status = (error as { httpCode?: string; statusCode?: number } | undefined) ?? {}
          const code = Number(status.httpCode ?? status.statusCode ?? 0)
          if (code !== 404) {
            delete data.endpointId
            delete data.secret
            throw new NodeApiError(this.getNode(), error as never, {
              message: 'QRSalt would not remove this workflow’s webhook endpoint.',
              description:
                'The workflow is deactivated, but the endpoint may still be registered. Remove it under Settings → Webhooks in the QRSalt dashboard.',
            })
          }
        }
        delete data.endpointId
        delete data.secret
        return true
      },
    },
  }

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const request = this.getRequestObject()
    const headers = this.getHeaderData() as Record<string, string | undefined>
    const secret = this.getWorkflowStaticData('node').secret as string | undefined

    const rawBody = (request as { rawBody?: unknown }).rawBody
    const raw: string =
      typeof rawBody === 'string'
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString('utf8')
          : JSON.stringify(this.getBodyData())

    const verified = verifySignature({
      body: raw,
      header: headers[SIGNATURE_HEADER],
      secret: secret ?? '',
    })

    if (!verified.ok) {
      // 401 rather than an error: the sender stops retrying a refused payload.
      return {
        noWebhookResponse: false,
        webhookResponse: { status: 401, body: { error: verified.reason } },
        workflowData: undefined,
      } as unknown as IWebhookResponseData
    }

    const body = this.getBodyData() as IDataObject
    return { workflowData: [this.helpers.returnJsonArray([body])] }
  }
}
