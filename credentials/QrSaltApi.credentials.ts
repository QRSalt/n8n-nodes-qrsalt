import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  Icon,
  INodeProperties,
} from 'n8n-workflow'

export class QrSaltApi implements ICredentialType {
  name = 'qrSaltApi'

  displayName = 'QRSalt API'

  documentationUrl = 'https://qrsalt.com/qr-code-api'

  icon: Icon = {
    light: 'file:../icons/qrsalt.svg',
    dark: 'file:../icons/qrsalt.dark.svg',
  }

  properties: INodeProperties[] = [
    {
      displayName: 'API Key',
      name: 'apiKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'e.g. qr_live_...',
      description:
        'Made in the QRSalt dashboard under Settings → API keys. It is shown once, so store it here when you create it. Any plan can make a key, but a key only renders images unless the plan includes API access: https://qrsalt.com/pricing.',
    },
    {
      displayName: 'Base URL',
      name: 'baseUrl',
      type: 'string',
      default: 'https://app.qrsalt.com',
      required: true,
      description:
        'Leave this alone unless you are pointing at a self-hosted or staging instance. It is the origin the API is served from, without a trailing slash.',
    },
  ]

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.apiKey}}',
      },
    },
  }

  /**
   * `/me` succeeds for any valid key, including a render-only one, so a Free
   * key proves itself here instead of being reported as wrong. The rules below
   * say that the key works but the plan does not cover the rest of the node.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/me',
      method: 'GET',
    },
    rules: [
      {
        type: 'responseSuccessBody',
        properties: {
          key: 'data.workspace.plan',
          value: 'FREE',
          message:
            'This key works, but the Free plan does not include API access, so only QR Image → Render will run. Plans and prices: https://qrsalt.com/pricing',
        },
      },
      {
        type: 'responseSuccessBody',
        properties: {
          key: 'data.workspace.plan',
          value: 'STARTER',
          message:
            'This key works, but Starter does not include API access, so only QR Image → Render will run. Plans and prices: https://qrsalt.com/pricing',
        },
      },
    ],
  }
}
