import type {
  IExecuteSingleFunctions,
  IHttpRequestOptions,
  IN8nHttpFullResponse,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow'
import { NodeConnectionTypes } from 'n8n-workflow'
import { sendFairnessId } from './fairness'
import { PRICING, withPlanNotes } from './plans'

/** Where the keyless calls live. Not the credential's base URL: there is no credential. */
const FREE_RENDER_ORIGIN = 'https://app.qrsalt.com'

/** Put the chosen binary field in the request body: the read endpoint takes the image itself. */
async function sendBinaryImage(
  this: IExecuteSingleFunctions,
  requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
  const field = this.getNodeParameter('readBinaryProperty') as string
  requestOptions.body = await this.helpers.getBinaryDataBuffer(field)
  return requestOptions
}

interface DecodeAnswer {
  data?: {
    text?: string
    format?: string
    version?: number | null
    errorCorrection?: string | null
    mask?: number | null
  }
}

/**
 * The decoded text as the output item. `data` holds the text; the rest is what
 * the symbol says about itself, and is null where the symbology carries none.
 */
async function decodedQr(
  this: IExecuteSingleFunctions,
  _items: INodeExecutionData[],
  response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
  const body: DecodeAnswer =
    typeof response.body === 'string' ? JSON.parse(response.body) : (response.body as DecodeAnswer)
  const code = body.data ?? {}
  return [
    {
      json: {
        success: true,
        data: code.text ?? '',
        format: code.format ?? null,
        version: code.version ?? null,
        errorCorrection: code.errorCorrection ?? null,
        mask: code.mask ?? null,
      },
    },
  ]
}

export class QrSalt implements INodeType {
  /** Every operation is given its plan note and refusal handling on the way out. */
  constructor() {
    withPlanNotes(this.description)
  }

  description: INodeTypeDescription = {
    displayName: 'QRSalt',
    name: 'qrSalt',
    icon: { light: 'file:../../icons/qrsalt.svg', dark: 'file:../../icons/qrsalt.dark.svg' },
    group: ['output'],
    version: 1,
    subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
    description:
      'Generate QR codes and short links, render and read QR code images, re-point a printed QR code, and read its scans. Rendering and reading an image need no account; everything else needs an API key on a plan with API access.',
    defaults: { name: 'QRSalt' },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    // Render (Free) and Read (Free) call public endpoints, so the credential is
    // hidden on those two and required everywhere else. Named by operation
    // alone: n8n hides as soon as *any* key in `hide` matches, so adding
    // `resource: ['image']` would take the credential away from Render as well,
    // and Render is the one image operation that needs a key.
    credentials: [
      {
        name: 'qrSaltApi',
        required: true,
        displayOptions: { hide: { operation: ['renderFree', 'readFree'] } },
      },
    ],
    requestDefaults: {
      baseURL: '={{$credentials.baseUrl}}',
      headers: { Accept: 'application/json' },
    },
    properties: [
      {
        displayName: 'Resource',
        name: 'resource',
        type: 'options',
        noDataExpression: true,
        default: 'code',
        options: [
          { name: 'Analytics', value: 'analytics' },
          { name: 'Folder', value: 'folder' },
          { name: 'QR Code', value: 'code' },
          { name: 'QR Form', value: 'form' },
          { name: 'QR Image', value: 'image' },
          { name: 'QR Menu', value: 'page' },
          { name: 'Short Link', value: 'link' },
          { name: 'Tag', value: 'tag' },
          { name: 'UTM Preset', value: 'utmPreset' },
        ],
      },
      {
        // Above the operation picker, so it is read before an operation is chosen.
        displayName: `This operation needs a QRSalt API key on a plan that includes API access. <a href="${PRICING}" target="_blank">Plans and prices</a>. QR Image → Render (Free) and Read (Free) need no account at all, and Render works with a key made on the Free plan.`,
        name: 'planNotice',
        type: 'notice',
        default: '',
        // By operation alone, for the same reason as the credential above.
        displayOptions: { hide: { operation: ['renderFree', 'readFree'] } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['code'] } },
        default: 'create',
        options: [
          {
            name: 'Change Many',
            value: 'bulk',
            action: 'Change many QR codes at once',
            routing: { request: { method: 'POST', url: '/api/v1/codes/bulk' } },
          },
          {
            name: 'Create',
            value: 'create',
            action: 'Create a QR code',
            routing: { request: { method: 'POST', url: '/api/v1/codes' } },
          },
          {
            name: 'Delete',
            value: 'delete',
            action: 'Delete a QR code',
            routing: {
              request: { method: 'DELETE', url: '=/api/v1/codes/{{$parameter["codeId"]}}' },
            },
          },
          {
            name: 'Get',
            value: 'get',
            action: 'Get a QR code',
            routing: { request: { method: 'GET', url: '=/api/v1/codes/{{$parameter["codeId"]}}' } },
          },
          {
            name: 'Get Image',
            value: 'getImage',
            action: 'Download a saved QR code image as a file',
            routing: {
              request: {
                method: 'GET',
                url: '=/api/v1/codes/{{$parameter["codeId"]}}/image',
                headers: { Accept: '*/*' },
                encoding: 'arraybuffer',
                json: false,
              },
              output: {
                postReceive: [
                  {
                    type: 'binaryData',
                    properties: { destinationProperty: '={{$parameter["binaryProperty"]}}' },
                  },
                ],
              },
            },
          },
          {
            name: 'Get Many',
            value: 'getAll',
            action: 'Get many QR codes',
            routing: { request: { method: 'GET', url: '/api/v1/codes' } },
          },
          {
            name: 'Get Scans',
            value: 'scans',
            action: 'Get the scans of a QR code',
            routing: {
              request: { method: 'GET', url: '=/api/v1/codes/{{$parameter["codeId"]}}/scans' },
            },
          },
          {
            name: 'Update',
            value: 'update',
            action: 'Update a QR code',
            routing: {
              request: { method: 'PATCH', url: '=/api/v1/codes/{{$parameter["codeId"]}}' },
            },
          },
        ],
      },
      {
        displayName: 'Code ID',
        name: 'codeId',
        type: 'string',
        required: true,
        default: '',
        description: 'The ID QRSalt gave the code when it was created',
        displayOptions: {
          show: { resource: ['code'], operation: ['get', 'update', 'delete', 'scans', 'getImage'] },
        },
      },
      {
        displayName: `Deleting is permanent and the record cannot be restored. A <b>dynamic</b> code stops working straight away: the scan comes through QRSalt, so it reaches a not-found page, and its short link is never given to anyone else — pause it instead if you only want it to stop for now. A <b>static</b> code carries its destination inside the printed pattern and never reaches QRSalt, so deleting one removes the saved record, name and design and nothing more; every copy already printed keeps working and there is no way to stop it. This needs an API key with the Delete permission, which is never ticked for a new key. <a href="${PRICING}" target="_blank">Plans and prices</a>.`,
        name: 'deleteNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['code'], operation: ['delete'] } },
      },
      {
        displayName: 'Destination',
        name: 'destination',
        type: 'string',
        default: '',
        placeholder: 'e.g. https://example.com/spring-menu',
        description:
          'Where the code opens. For a dynamic code this is what you change later. Leave it empty only if you are sending a Payload instead.',
        displayOptions: { show: { resource: ['code'], operation: ['create'] } },
        routing: { send: { type: 'body', property: 'destination' } },
      },
      {
        displayName: 'Name',
        name: 'name',
        type: 'string',
        default: '',
        description:
          'What the code is called in the dashboard. Not visible to anyone scanning it.',
        displayOptions: { show: { resource: ['code'], operation: ['create'] } },
        routing: { send: { type: 'body', property: 'name' } },
      },
      {
        displayName: 'Type',
        name: 'type',
        type: 'options',
        default: 'URL',
        description:
          'What the code encodes. Types beyond URL need a Payload; the API validates its shape and says what is missing.',
        displayOptions: { show: { resource: ['code'], operation: ['create'] } },
        options: [
          { name: 'App Store', value: 'APP_STORE' },
          { name: 'Audio', value: 'AUDIO' },
          { name: 'Calendar Event', value: 'EVENT' },
          { name: 'Contact Card (vCard)', value: 'VCARD' },
          { name: 'Email', value: 'EMAIL' },
          { name: 'Gallery', value: 'GALLERY' },
          { name: 'GS1 Digital Link', value: 'GS1' },
          { name: 'Landing Page', value: 'LANDING' },
          { name: 'Location', value: 'LOCATION' },
          { name: 'Payment', value: 'PAYMENT' },
          { name: 'PDF', value: 'PDF' },
          { name: 'Phone', value: 'PHONE' },
          { name: 'Review', value: 'REVIEW' },
          { name: 'SMS', value: 'SMS' },
          { name: 'Text', value: 'TEXT' },
          { name: 'URL', value: 'URL' },
          { name: 'Wi-Fi', value: 'WIFI' },
        ],
        routing: { send: { type: 'body', property: 'type' } },
      },
      {
        displayName: 'Additional Fields',
        name: 'additionalFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['code'], operation: ['create'] } },
        options: [
          {
            displayName: 'Custom Ending (Slug)',
            name: 'slug',
            type: 'string',
            default: '',
            description: 'The ending of the short link. Needs a plan that allows chosen endings.',
            routing: { send: { type: 'body', property: 'slug' } },
          },
          {
            displayName: 'Domain',
            name: 'domain',
            type: 'string',
            default: '',
            description:
              'A verified custom domain of the workspace, by hostname. Leave empty for the default.',
            routing: { send: { type: 'body', property: 'domain' } },
          },
          {
            displayName: 'Folder ID',
            name: 'folderId',
            type: 'string',
            default: '',
            description: 'The folder to file the code in',
            routing: { send: { type: 'body', property: 'folderId' } },
          },
          {
            displayName: 'Kind',
            name: 'kind',
            type: 'options',
            default: 'DYNAMIC',
            description:
              'A static code carries its link in the pattern and can never be changed. A dynamic one can be re-pointed after printing.',
            options: [
              { name: 'Dynamic (Editable After Printing)', value: 'DYNAMIC' },
              { name: 'Static (Fixed Forever)', value: 'STATIC' },
            ],
            routing: { send: { type: 'body', property: 'kind' } },
          },
          {
            displayName: 'Payload (JSON)',
            name: 'payload',
            type: 'json',
            default: '',
            description:
              'For types other than URL. Its shape depends on the type and is validated by the API.',
            routing: { send: { type: 'body', property: 'payload' } },
          },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            default: 'ACTIVE',
            description: 'Whether the code redirects, or shows a paused page instead',
            options: [
              { name: 'Active', value: 'ACTIVE' },
              { name: 'Paused', value: 'PAUSED' },
            ],
            routing: { send: { type: 'body', property: 'status' } },
          },
          {
            displayName: 'Tag Names',
            name: 'tags',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Tag names to file the code under. They are created if they do not exist.',
            routing: { send: { type: 'body', property: 'tags' } },
          },
        ],
      },
      {
        displayName: 'Update Fields',
        name: 'updateFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['code'], operation: ['update'] } },
        options: [
          {
            displayName: 'Custom Ending (Slug)',
            name: 'slug',
            type: 'string',
            default: '',
            description: 'The ending of the short link. An empty value puts it back to the short code.',
            routing: { send: { type: 'body', property: 'slug' } },
          },
          {
            displayName: 'Destination',
            name: 'destination',
            type: 'string',
            default: '',
            description: 'The new address. Every printed copy opens it from the next scan.',
            routing: { send: { type: 'body', property: 'destination' } },
          },
          {
            displayName: 'Domain',
            name: 'domain',
            type: 'string',
            default: '',
            description:
              'Move the short link to this verified domain of the workspace, by hostname',
            routing: { send: { type: 'body', property: 'domain' } },
          },
          {
            displayName: 'Folder ID',
            name: 'folderId',
            type: 'string',
            default: '',
            description: 'The folder to move the code to',
            routing: { send: { type: 'body', property: 'folderId' } },
          },
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            default: '',
            description: 'What the code is called in the dashboard',
            routing: { send: { type: 'body', property: 'name' } },
          },
          {
            displayName: 'Note',
            name: 'note',
            type: 'string',
            default: '',
            description: 'Why it was re-pointed. Kept in the code’s history.',
            routing: { send: { type: 'body', property: 'note' } },
          },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            default: 'ACTIVE',
            description: 'Whether the code redirects, or shows a paused page instead',
            options: [
              { name: 'Active', value: 'ACTIVE' },
              { name: 'Paused', value: 'PAUSED' },
            ],
            routing: { send: { type: 'body', property: 'status' } },
          },
          {
            displayName: 'Tag Names',
            name: 'tags',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Replaces the code’s tags with these',
            routing: { send: { type: 'body', property: 'tags' } },
          },
        ],
      },

      {
        displayName: 'Code IDs',
        name: 'bulkIds',
        type: 'string',
        typeOptions: { multipleValues: true },
        required: true,
        default: [],
        description: 'The codes to change, up to 500 in one call',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'] } },
        routing: { send: { type: 'body', property: 'ids' } },
      },
      {
        displayName: 'Action',
        name: 'bulkAction',
        type: 'options',
        default: 'status',
        description:
          'What to do to all of them. Each code is reported back as done, unchanged or skipped with a reason.',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'] } },
        options: [
          { name: 'Add or Remove Tags', value: 'tags' },
          { name: 'Apply UTM Preset', value: 'utm' },
          { name: 'Delete Them', value: 'delete' },
          { name: 'Move to Domain', value: 'domain' },
          { name: 'Move to Folder', value: 'folder' },
          { name: 'Set Status', value: 'status' },
        ],
        routing: { send: { type: 'body', property: 'action' } },
      },
      {
        displayName: `Every code listed above is deleted permanently and none of them can be restored. A <b>dynamic</b> code stops working straight away and its short link is never given to anyone else; a <b>static</b> code loses its saved record only, and copies already printed keep working. Pause them instead if you only want them to stop for now. This needs an API key with the Delete permission — the <i>Write</i> permission is not enough, and neither is ticked for a new key. <a href="${PRICING}" target="_blank">Plans and prices</a>.`,
        name: 'bulkDeleteNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['delete'] } },
      },
      {
        displayName: 'Status',
        name: 'bulkStatus',
        type: 'options',
        default: 'ACTIVE',
        description: 'Whether the codes redirect, or show a paused page instead',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['status'] } },
        options: [
          { name: 'Active', value: 'ACTIVE' },
          { name: 'Paused', value: 'PAUSED' },
        ],
        routing: { send: { type: 'body', property: 'status' } },
      },
      {
        displayName: 'Folder ID',
        name: 'bulkFolderId',
        type: 'string',
        default: '',
        description: 'The folder to move them to. Leave empty to take them out of every folder.',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['folder'] } },
        routing: { send: { type: 'body', property: 'folderId', value: '={{$value || null}}' } },
      },
      {
        displayName: 'Domain',
        name: 'bulkDomain',
        type: 'string',
        default: '',
        description:
          'A verified custom domain of the workspace, by hostname. Leave empty to move them back to the QRSalt domain.',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['domain'] } },
        routing: { send: { type: 'body', property: 'domain', value: '={{$value || null}}' } },
      },
      {
        displayName: 'UTM Preset ID',
        name: 'bulkPresetId',
        type: 'string',
        required: true,
        default: '',
        description: 'The campaign-tag preset to apply, from the workspace’s presets',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['utm'] } },
        routing: { send: { type: 'body', property: 'presetId' } },
      },
      {
        displayName: 'Tags to Add',
        name: 'bulkAddTags',
        type: 'string',
        typeOptions: { multipleValues: true },
        default: [],
        description: 'Tag names to add. They are created if they do not exist.',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['tags'] } },
        routing: { send: { type: 'body', property: 'add' } },
      },
      {
        displayName: 'Tags to Remove',
        name: 'bulkRemoveTags',
        type: 'string',
        typeOptions: { multipleValues: true },
        default: [],
        description: 'Tag names to take off these codes',
        displayOptions: { show: { resource: ['code'], operation: ['bulk'], bulkAction: ['tags'] } },
        routing: { send: { type: 'body', property: 'remove' } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['image'] } },
        default: 'render',
        options: [
          {
            name: 'Render',
            value: 'render',
            action: 'Render a QR code image',
            routing: {
              request: {
                method: 'GET',
                url: '/api/qr',
                headers: { Accept: '*/*' },
                encoding: 'arraybuffer',
                json: false,
              },
              output: {
                postReceive: [
                  {
                    type: 'binaryData',
                    properties: { destinationProperty: '={{$parameter["binaryProperty"]}}' },
                  },
                ],
              },
            },
          },
          {
            name: 'Read (Free)',
            value: 'readFree',
            action: 'Read a QR code or barcode from an image without an account',
            routing: {
              request: {
                method: 'POST',
                baseURL: FREE_RENDER_ORIGIN,
                url: '/api/qr/decode',
                headers: { Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
                // The body is the image, so n8n must neither serialise it nor
                // parse the answer.
                json: false,
              },
              send: { preSend: [sendBinaryImage, sendFairnessId] },
              output: { postReceive: [decodedQr] },
            },
          },
          {
            name: 'Render (Free)',
            value: 'renderFree',
            action: 'Render a QR code image without an account',
            routing: {
              request: {
                method: 'GET',
                // No credential here, so the origin is named rather than read
                // off the key.
                baseURL: FREE_RENDER_ORIGIN,
                url: '/api/qr/free',
                headers: { Accept: '*/*' },
                encoding: 'arraybuffer',
                json: false,
              },
              send: { preSend: [sendFairnessId] },
              output: {
                postReceive: [
                  {
                    type: 'binaryData',
                    properties: { destinationProperty: '={{$parameter["binaryProperty"]}}' },
                  },
                ],
              },
            },
          },
        ],
      },
      {
        displayName: 'Content',
        name: 'content',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. https://example.com',
        description:
          'The exact text inside the pattern, up to 2000 bytes. Nothing is stored and nothing can be changed afterwards — for a code you can re-point, use QR Code → Create.',
        displayOptions: { show: { resource: ['image'], operation: ['render'] } },
        routing: { send: { type: 'query', property: 'data' } },
      },
      {
        displayName: 'Format',
        name: 'format',
        type: 'options',
        default: 'png',
        description: 'The file that comes back',
        displayOptions: {
          show: { resource: ['code', 'image'], operation: ['getImage', 'render'] },
        },
        options: [
          { name: 'JPG', value: 'jpg' },
          { name: 'PDF', value: 'pdf' },
          { name: 'PNG', value: 'png' },
          { name: 'SVG', value: 'svg' },
          { name: 'WebP', value: 'webp' },
        ],
        routing: { send: { type: 'query', property: 'format' } },
      },
      {
        displayName: 'Put Output File in Field',
        name: 'binaryProperty',
        type: 'string',
        required: true,
        default: 'data',
        hint: 'The name of the output binary field to put the file in',
        displayOptions: {
          show: { resource: ['code', 'image'], operation: ['getImage', 'render', 'renderFree'] },
        },
      },
      {
        displayName: 'Options',
        name: 'imageOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        displayOptions: {
          show: { resource: ['code', 'image'], operation: ['getImage', 'render'] },
        },
        options: [
          {
            displayName: 'Printed Width (Mm)',
            name: 'mm',
            type: 'number',
            typeOptions: { minValue: 5, maxValue: 1000 },
            default: 40,
            description: 'How wide the code is printed, in millimetres. PDF only.',
            routing: { send: { type: 'query', property: 'mm' } },
          },
          {
            displayName: 'Size (Px)',
            name: 'size',
            type: 'number',
            typeOptions: { minValue: 64, maxValue: 2000 },
            default: 512,
            description: 'Width and height in pixels. Ignored for PDF, which is measured in millimetres.',
            routing: { send: { type: 'query', property: 'size' } },
          },
        ],
      },
      {
        displayName: 'Design',
        name: 'design',
        type: 'collection',
        placeholder: 'Add Design Option',
        default: {},
        description: 'How the code is drawn. Leave a field out and QRSalt draws its default.',
        displayOptions: { show: { resource: ['image'], operation: ['render'] } },
        options: [
          {
            displayName: 'Background Colour',
            name: 'bgcolor',
            type: 'color',
            default: '#FFFFFF',
            description: 'The colour behind the pattern, as a hex value',
            routing: { send: { type: 'query', property: 'bgcolor' } },
          },
          {
            displayName: 'Error Correction',
            name: 'ecc',
            type: 'options',
            default: 'M',
            description:
              'How much of the code can be damaged and still read. Higher levels hold less data in the same size.',
            options: [
              { name: 'H (30%)', value: 'H' },
              { name: 'L (7%)', value: 'L' },
              { name: 'M (15%)', value: 'M' },
              { name: 'Q (25%)', value: 'Q' },
            ],
            routing: { send: { type: 'query', property: 'ecc' } },
          },
          {
            displayName: 'Eye Ball Shape',
            name: 'eyeball',
            type: 'options',
            default: 'square',
            description: 'The centre of each of the three corner squares',
            options: [
              { name: 'Circle', value: 'circle' },
              { name: 'Drop', value: 'drop' },
              { name: 'Leaf', value: 'leaf' },
              { name: 'Leaf (Flipped)', value: 'leaf-flip' },
              { name: 'Rounded', value: 'rounded' },
              { name: 'Square', value: 'square' },
            ],
            routing: { send: { type: 'query', property: 'eyeball' } },
          },
          {
            displayName: 'Eye Colour',
            name: 'eyecolor',
            type: 'color',
            default: '#000000',
            description: 'The colour of the three corner squares, as a hex value',
            routing: { send: { type: 'query', property: 'eyecolor' } },
          },
          {
            displayName: 'Eye Frame Shape',
            name: 'eyeframe',
            type: 'options',
            default: 'square',
            description: 'The ring around each of the three corner squares',
            options: [
              { name: 'Circle', value: 'circle' },
              { name: 'Drop', value: 'drop' },
              { name: 'Leaf', value: 'leaf' },
              { name: 'Leaf (Flipped)', value: 'leaf-flip' },
              { name: 'Rounded', value: 'rounded' },
              { name: 'Square', value: 'square' },
            ],
            routing: { send: { type: 'query', property: 'eyeframe' } },
          },
          {
            displayName: 'Eye Rotation',
            name: 'eyeturn',
            type: 'options',
            default: '0',
            description:
              'Turn the corner shapes half round. Quarter turns are not offered: they stop some scanners reading the code.',
            options: [
              { name: 'Half Turn (180°)', value: '180' },
              { name: 'Upright', value: '0' },
            ],
            routing: { send: { type: 'query', property: 'eyeturn' } },
          },
          {
            displayName: 'Eye Shape',
            name: 'eyes',
            type: 'options',
            default: 'square',
            description: 'A matching shape for the ring and the centre. Eye Frame and Eye Ball override it.',
            options: [
              { name: 'Circle', value: 'circle' },
              { name: 'Rounded', value: 'rounded' },
              { name: 'Square', value: 'square' },
            ],
            routing: { send: { type: 'query', property: 'eyes' } },
          },
          {
            displayName: 'Foreground Colour',
            name: 'color',
            type: 'color',
            default: '#000000',
            description: 'The colour of the pattern, as a hex value. Keep it dark on a light background.',
            routing: { send: { type: 'query', property: 'color' } },
          },
          {
            displayName: 'Margin',
            name: 'margin',
            type: 'number',
            typeOptions: { minValue: 0, maxValue: 20 },
            default: 4,
            description: 'The quiet zone around the code, in modules rather than pixels',
            routing: { send: { type: 'query', property: 'margin' } },
          },
          {
            displayName: 'Module Shape',
            name: 'style',
            type: 'options',
            default: 'square',
            description: 'The shape of the dots that make up the pattern',
            options: [
              { name: 'Classy', value: 'classy' },
              { name: 'Dots', value: 'dots' },
              { name: 'Rounded', value: 'rounded' },
              { name: 'Square', value: 'square' },
            ],
            routing: { send: { type: 'query', property: 'style' } },
          },
        ],
      },

      {
        displayName: 'Content',
        name: 'freeContent',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. https://example.com',
        description:
          'The exact text inside the pattern, up to 512 bytes. No account and no API key: the image comes straight back. Nothing is stored, so the code cannot be re-pointed later. There is an hourly limit on the free endpoint; a free API key gives you one of your own, and Render is the operation that uses it.',
        displayOptions: { show: { resource: ['image'], operation: ['renderFree'] } },
        routing: { send: { type: 'query', property: 'data' } },
      },
      {
        displayName: 'Format',
        name: 'freeFormat',
        type: 'options',
        default: 'png',
        description: 'The file that comes back. JPG, WebP and PDF are on Render, which uses an API key.',
        displayOptions: { show: { resource: ['image'], operation: ['renderFree'] } },
        options: [
          { name: 'PNG', value: 'png' },
          { name: 'SVG', value: 'svg' },
        ],
        routing: { send: { type: 'query', property: 'format' } },
      },
      {
        displayName: 'Options',
        name: 'freeOptions',
        type: 'collection',
        placeholder: 'Add Option',
        default: {},
        description:
          'The free endpoint draws colour, margin and error correction. Module shapes, eye shapes and logos are on Render, which uses an API key.',
        displayOptions: { show: { resource: ['image'], operation: ['renderFree'] } },
        options: [
          {
            displayName: 'Background Colour',
            name: 'bgcolor',
            type: 'color',
            default: '#FFFFFF',
            description: 'The colour behind the pattern, as a hex value',
            routing: { send: { type: 'query', property: 'bgcolor' } },
          },
          {
            displayName: 'Error Correction',
            name: 'ecc',
            type: 'options',
            default: 'M',
            description:
              'How much of the code can be damaged and still read. Higher levels hold less data in the same size.',
            options: [
              { name: 'H (30%)', value: 'H' },
              { name: 'L (7%)', value: 'L' },
              { name: 'M (15%)', value: 'M' },
              { name: 'Q (25%)', value: 'Q' },
            ],
            routing: { send: { type: 'query', property: 'ecc' } },
          },
          {
            displayName: 'Foreground Colour',
            name: 'color',
            type: 'color',
            default: '#000000',
            description: 'The colour of the pattern, as a hex value. Keep it dark on a light background.',
            routing: { send: { type: 'query', property: 'color' } },
          },
          {
            displayName: 'Margin',
            name: 'margin',
            type: 'number',
            typeOptions: { minValue: 0, maxValue: 20 },
            default: 4,
            description: 'The quiet zone around the code, in modules rather than pixels',
            routing: { send: { type: 'query', property: 'margin' } },
          },
          {
            displayName: 'Size (Px)',
            name: 'size',
            type: 'number',
            typeOptions: { minValue: 64, maxValue: 512 },
            default: 512,
            description: 'Width and height in pixels. Larger exports are on Render, which uses an API key.',
            routing: { send: { type: 'query', property: 'size' } },
          },
        ],
      },

      {
        displayName: 'Input Binary Field',
        name: 'readBinaryProperty',
        type: 'string',
        required: true,
        default: 'data',
        hint: 'The name of the input binary field holding the image to read',
        description:
          'The picture is posted to QRSalt and read there. PNG, JPEG or WebP, up to 12 MB. Nothing is kept: the image is read in memory, the text comes back, and the file is discarded — never written to disk and never logged.',
        displayOptions: { show: { resource: ['image'], operation: ['readFree'] } },
      },
      {
        displayName: 'Look For',
        name: 'readFormats',
        type: 'options',
        default: 'qr',
        description:
          'Which symbology to look for. QR alone is the fastest; each extra one is another pass over the same image.',
        displayOptions: { show: { resource: ['image'], operation: ['readFree'] } },
        options: [
          { name: 'Aztec', value: 'aztec' },
          { name: 'Code 128', value: 'code128' },
          { name: 'Code 39', value: 'code39' },
          { name: 'Data Matrix', value: 'datamatrix' },
          { name: 'EAN-13 (Also UPC-A and ISBN)', value: 'ean13' },
          { name: 'Every Symbology Below', value: 'all' },
          { name: 'ITF (Also ITF-14)', value: 'itf' },
          { name: 'PDF417', value: 'pdf417' },
          { name: 'QR Code', value: 'qr' },
        ],
        routing: { send: { type: 'query', property: 'formats' } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['link'] } },
        default: 'create',
        options: [
          {
            name: 'Create',
            value: 'create',
            action: 'Create a short link',
            routing: { request: { method: 'POST', url: '/api/v1/links' } },
          },
          {
            name: 'Get Many',
            value: 'getAll',
            action: 'Get many short links',
            description: 'Get the short links, newest first. QR codes are not included; use QR Code → Get Many for those.',
            routing: { request: { method: 'GET', url: '/api/v1/links' } },
          },
        ],
      },
      {
        // The links route reads `url`, not `destination`.
        displayName: 'URL',
        name: 'url',
        type: 'string',
        required: true,
        default: '',
        placeholder: 'e.g. https://example.com/spring-menu',
        description: 'The address the short link opens',
        displayOptions: { show: { resource: ['link'], operation: ['create'] } },
        routing: { send: { type: 'body', property: 'url' } },
      },
      {
        displayName: 'Additional Fields',
        name: 'linkFields',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: { show: { resource: ['link'], operation: ['create'] } },
        options: [
          {
            displayName: 'Custom Ending (Slug)',
            name: 'slug',
            type: 'string',
            default: '',
            description: 'The ending of the short link. Needs a plan that allows chosen endings.',
            routing: { send: { type: 'body', property: 'slug' } },
          },
          {
            displayName: 'Domain',
            name: 'domain',
            type: 'string',
            default: '',
            description:
              'A verified custom domain of the workspace, by hostname. Leave empty for the default.',
            routing: { send: { type: 'body', property: 'domain' } },
          },
          {
            displayName: 'Folder ID',
            name: 'folderId',
            type: 'string',
            default: '',
            description: 'The folder to file the link in',
            routing: { send: { type: 'body', property: 'folderId' } },
          },
          {
            displayName: 'Name',
            name: 'name',
            type: 'string',
            default: '',
            description: 'What the link is called in the dashboard',
            routing: { send: { type: 'body', property: 'name' } },
          },
          {
            displayName: 'Tag Names',
            name: 'tags',
            type: 'string',
            typeOptions: { multipleValues: true },
            default: [],
            description: 'Tag names to file the link under. They are created if they do not exist.',
            routing: { send: { type: 'body', property: 'tags' } },
          },
        ],
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['analytics'] } },
        default: 'get',
        options: [
          {
            name: 'Get',
            value: 'get',
            action: 'Get QR code and short link scan analytics',
            routing: { request: { method: 'GET', url: '/api/v1/analytics' } },
          },
        ],
      },

      // The same three fields as the code's scan range below, under their own
      // names: a parameter carries only one `displayOptions`.
      {
        displayName: 'From',
        name: 'from',
        type: 'string',
        default: '',
        placeholder: 'e.g. 2026-01-01',
        description:
          'The first day to count, as YYYY-MM-DD. Empty means 30 days back. At most 366 days at a time, and your plan’s retention can shorten it — the answer says when it did.',
        displayOptions: { show: { resource: ['analytics'], operation: ['get'] } },
        routing: { send: { type: 'query', property: 'from' } },
      },
      {
        displayName: 'To',
        name: 'to',
        type: 'string',
        default: '',
        placeholder: 'e.g. 2026-01-31',
        description: 'The last day to count, as YYYY-MM-DD. Empty means today.',
        displayOptions: {
          show: { resource: ['analytics'], operation: ['get'] },
        },
        routing: { send: { type: 'query', property: 'to' } },
      },
      {
        displayName: 'Breakdown',
        name: 'dimension',
        type: 'options',
        default: '',
        description:
          'One breakdown to include beside the totals. Some need a plan with advanced analytics; the API says which.',
        displayOptions: { show: { resource: ['analytics'], operation: ['get'] } },
        options: [
          { name: 'Browser', value: 'browser' },
          { name: 'City', value: 'city' },
          { name: 'Country', value: 'country' },
          { name: 'Device', value: 'device' },
          { name: 'Hour', value: 'hour' },
          { name: 'None', value: '' },
          { name: 'Operating System', value: 'os' },
          { name: 'Referrer', value: 'referrer' },
          // The values are subdivision codes (CA, 03), not names.
          { name: 'Region Code', value: 'region' },
          { name: 'Weekday', value: 'weekday' },
        ],
        routing: { send: { type: 'query', property: 'dimension' } },
      },
      {
        displayName: 'From',
        name: 'scansFrom',
        type: 'string',
        default: '',
        placeholder: 'e.g. 2026-01-01',
        description:
          'The first day to count, as YYYY-MM-DD. Empty means 30 days back. At most 366 days at a time.',
        displayOptions: { show: { resource: ['code'], operation: ['scans'] } },
        routing: { send: { type: 'query', property: 'from' } },
      },
      {
        displayName: 'To',
        name: 'scansTo',
        type: 'string',
        default: '',
        placeholder: 'e.g. 2026-01-31',
        description: 'The last day to count, as YYYY-MM-DD. Empty means today.',
        displayOptions: { show: { resource: ['code'], operation: ['scans'] } },
        routing: { send: { type: 'query', property: 'to' } },
      },
      {
        displayName: 'Breakdown',
        name: 'scansDimension',
        type: 'options',
        default: '',
        description:
          'One breakdown to include beside the totals. Some need a plan with advanced analytics; the API says which.',
        displayOptions: { show: { resource: ['code'], operation: ['scans'] } },
        options: [
          { name: 'Browser', value: 'browser' },
          { name: 'City', value: 'city' },
          { name: 'Country', value: 'country' },
          { name: 'Device', value: 'device' },
          { name: 'Hour', value: 'hour' },
          { name: 'None', value: '' },
          { name: 'Operating System', value: 'os' },
          { name: 'Referrer', value: 'referrer' },
          // The values are subdivision codes (CA, 03), not names.
          { name: 'Region Code', value: 'region' },
          { name: 'Weekday', value: 'weekday' },
        ],
        routing: { send: { type: 'query', property: 'dimension' } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['form'] } },
        default: 'getAllForms',
        options: [
          {
            name: 'Get Many',
            value: 'getAllForms',
            action: 'Get many QR forms',
            routing: { request: { method: 'GET', url: '/api/v1/forms' } },
          },
          {
            name: 'Get Responses',
            value: 'responses',
            action: 'Get the answers to a QR form',
            routing: {
              request: { method: 'GET', url: '=/api/v1/forms/{{$parameter["formId"]}}/responses' },
            },
          },
        ],
      },
      {
        displayName: 'Form ID',
        name: 'formId',
        type: 'string',
        required: true,
        default: '',
        description: 'The ID of the form, from Get Many or the dashboard',
        displayOptions: { show: { resource: ['form'], operation: ['responses'] } },
      },
      {
        displayName: 'Limit',
        name: 'responseLimit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 25,
        description: 'Max number of results to return',
        displayOptions: { show: { resource: ['form'], operation: ['responses'] } },
        routing: { send: { type: 'query', property: 'limit' } },
      },
      {
        displayName: 'Offset',
        name: 'responseOffset',
        type: 'number',
        default: 0,
        description:
          'Where to start. Answers are newest first, and meta.nextOffset says whether there are more.',
        displayOptions: { show: { resource: ['form'], operation: ['responses'] } },
        routing: { send: { type: 'query', property: 'offset' } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['page'] } },
        default: 'getAllPages',
        options: [
          {
            name: 'Get Many',
            value: 'getAllPages',
            action: 'Get many QR menus',
            routing: { request: { method: 'GET', url: '/api/v1/pages' } },
          },
        ],
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['folder'] } },
        default: 'getAllFolders',
        options: [
          {
            name: 'Create',
            value: 'createFolder',
            action: 'Create a folder',
            routing: { request: { method: 'POST', url: '/api/v1/folders' } },
          },
          {
            name: 'Delete',
            value: 'deleteFolder',
            action: 'Delete a folder',
            routing: {
              request: { method: 'DELETE', url: '=/api/v1/folders/{{$parameter["folderId"]}}' },
            },
          },
          {
            name: 'Get',
            value: 'getFolder',
            action: 'Get a folder',
            routing: {
              request: { method: 'GET', url: '=/api/v1/folders/{{$parameter["folderId"]}}' },
            },
          },
          {
            name: 'Get Many',
            value: 'getAllFolders',
            action: 'Get many folders',
            routing: { request: { method: 'GET', url: '/api/v1/folders' } },
          },
          {
            name: 'Update',
            value: 'updateFolder',
            action: 'Rename a folder',
            routing: {
              request: { method: 'PATCH', url: '=/api/v1/folders/{{$parameter["folderId"]}}' },
            },
          },
        ],
      },
      {
        displayName: 'Folder ID',
        name: 'folderId',
        type: 'string',
        required: true,
        default: '',
        description: 'The ID QRSalt gave the folder when it was created',
        displayOptions: {
          show: { resource: ['folder'], operation: ['getFolder', 'updateFolder', 'deleteFolder'] },
        },
      },
      {
        displayName: 'Name',
        name: 'folderName',
        type: 'string',
        required: true,
        default: '',
        description: 'What the folder is called',
        displayOptions: {
          show: { resource: ['folder'], operation: ['createFolder', 'updateFolder'] },
        },
        routing: { send: { type: 'body', property: 'name' } },
      },
      {
        displayName:
          'Deleting a folder does <b>not</b> delete the codes in it. They stay exactly as they are and simply end up in no folder, and the answer says how many moved. This needs an API key with the Delete permission, which is never ticked for a new key.',
        name: 'folderDeleteNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['folder'], operation: ['deleteFolder'] } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['tag'] } },
        default: 'getAllTags',
        options: [
          {
            name: 'Delete',
            value: 'deleteTag',
            action: 'Delete a tag',
            routing: {
              request: { method: 'DELETE', url: '=/api/v1/tags/{{$parameter["tagId"]}}' },
            },
          },
          {
            name: 'Get',
            value: 'getTag',
            action: 'Get a tag',
            routing: { request: { method: 'GET', url: '=/api/v1/tags/{{$parameter["tagId"]}}' } },
          },
          {
            name: 'Get Many',
            value: 'getAllTags',
            action: 'Get many tags',
            routing: { request: { method: 'GET', url: '/api/v1/tags' } },
          },
          {
            name: 'Update',
            value: 'updateTag',
            action: 'Rename a tag',
            routing: { request: { method: 'PATCH', url: '=/api/v1/tags/{{$parameter["tagId"]}}' } },
          },
        ],
      },
      {
        displayName: 'Tag ID',
        name: 'tagId',
        type: 'string',
        required: true,
        default: '',
        description: 'The ID from Tag → Get Many. Tags are created by naming them on a code.',
        displayOptions: {
          show: { resource: ['tag'], operation: ['getTag', 'updateTag', 'deleteTag'] },
        },
      },
      {
        displayName: 'Name',
        name: 'tagName',
        type: 'string',
        required: true,
        default: '',
        description:
          'What the tag is called. Every code carrying it shows the new name; a name another tag already has is refused rather than merged.',
        displayOptions: { show: { resource: ['tag'], operation: ['updateTag'] } },
        routing: { send: { type: 'body', property: 'name' } },
      },
      {
        displayName:
          'Deleting a tag does <b>not</b> delete the codes carrying it. They lose the word and nothing else, and the answer says how many they were. This needs an API key with the Delete permission, which is never ticked for a new key.',
        name: 'tagDeleteNotice',
        type: 'notice',
        default: '',
        displayOptions: { show: { resource: ['tag'], operation: ['deleteTag'] } },
      },

      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        displayOptions: { show: { resource: ['utmPreset'] } },
        default: 'getAllUtmPresets',
        options: [
          {
            name: 'Get Many',
            value: 'getAllUtmPresets',
            action: 'Get many UTM presets',
            routing: { request: { method: 'GET', url: '/api/v1/utm-presets' } },
          },
        ],
      },

      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        typeOptions: { minValue: 1, maxValue: 100 },
        default: 50,
        description: 'Max number of results to return',
        displayOptions: {
          show: { resource: ['code', 'link'], operation: ['getAll'] },
        },
        routing: { send: { type: 'query', property: 'limit' } },
      },
      {
        displayName: 'Offset',
        name: 'offset',
        type: 'number',
        default: 0,
        description:
          'Where to start. The answer carries meta.nextOffset; when it is null there is nothing more.',
        displayOptions: {
          show: { resource: ['code', 'link'], operation: ['getAll'] },
        },
        routing: { send: { type: 'query', property: 'offset' } },
      },
      {
        displayName: 'Search',
        name: 'q',
        type: 'string',
        default: '',
        description: 'Only codes whose name or destination contains this',
        displayOptions: { show: { resource: ['code', 'link'], operation: ['getAll'] } },
        routing: { send: { type: 'query', property: 'q' } },
      },
      {
        displayName: 'Filters',
        name: 'filters',
        type: 'collection',
        placeholder: 'Add Filter',
        default: {},
        displayOptions: { show: { resource: ['code'], operation: ['getAll'] } },
        options: [
          {
            displayName: 'Domain',
            name: 'domain',
            type: 'string',
            default: '',
            description: 'A verified domain by hostname, or "none" for codes on the default domain',
            routing: { send: { type: 'query', property: 'domain' } },
          },
          {
            displayName: 'Folder ID',
            name: 'folder',
            type: 'string',
            default: '',
            description: 'A folder ID, or "none" for codes in no folder',
            routing: { send: { type: 'query', property: 'folder' } },
          },
          {
            displayName: 'Output',
            name: 'output',
            type: 'options',
            default: 'link',
            description:
              'Has A Short Link: every dynamic code, since each one has a short link. Every Code: no filter. For the codes made as short links, use Short Link → Get Many.',
            options: [
              { name: 'Every Code', value: 'qr' },
              { name: 'Has A Short Link', value: 'link' },
            ],
            routing: { send: { type: 'query', property: 'output' } },
          },
          {
            displayName: 'Status',
            name: 'status',
            type: 'options',
            default: 'ACTIVE',
            description: 'Only codes in this state',
            options: [
              { name: 'Active', value: 'ACTIVE' },
              { name: 'Archived', value: 'ARCHIVED' },
              { name: 'Disabled', value: 'DISABLED' },
              { name: 'Lapsed', value: 'LAPSED' },
              { name: 'Paused', value: 'PAUSED' },
            ],
            routing: { send: { type: 'query', property: 'status' } },
          },
          {
            displayName: 'Tag Name',
            name: 'tag',
            type: 'string',
            default: '',
            description: 'Only codes carrying this tag',
            routing: { send: { type: 'query', property: 'tag' } },
          },
        ],
      },
    ],
  }
}
