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
        'Made in the QRSalt dashboard under Settings → API keys. It is shown once, so store it here when you create it. An API key needs a plan that includes API access.',
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

  // `/me` succeeds for any valid key; listing codes would call an empty workspace broken.
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.baseUrl}}',
      url: '/api/v1/me',
      method: 'GET',
    },
  }
}
