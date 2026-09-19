import type { INodeProperties } from 'n8n-workflow'

/**
 * What each content type is made of, and the fields that collect it.
 *
 * A QR code's type is not decoration: a Wi-Fi code carries an SSID and an
 * encryption mode, a contact card carries a name, an event carries a start
 * time. The API takes all of that in one `payload` object whose shape depends
 * on the type, and validates it (`src/lib/qr/payloads.ts` in the API).
 *
 * Before this table existed the node offered the type list and then a single
 * Destination box, which the API reads as `payload.url`. So every type but a
 * website was either impossible or refused with a message naming a field the
 * node had never shown anyone - "Required", for a `text` or an `ssid` nobody
 * could have known to send. One table, two operations, and n8n's
 * `displayOptions` reveal only the fields of the type that is chosen.
 *
 * A type with no entry here is not offered at all, which is the other half of
 * the same rule: an option that cannot work is worse than a missing one.
 */

/** One input, and the payload key it fills. */
export interface ContentField {
  /** The payload key. `payload.<name>` is what goes on the wire. */
  name: string
  displayName: string
  type: 'string' | 'number' | 'boolean' | 'options'
  default: string | number | boolean
  description: string
  placeholder?: string
  options?: Array<{ name: string; value: string }>
  typeOptions?: Record<string, unknown>
}

export interface ContentType {
  /** The `type` the API knows it by. */
  value: string
  /** The dropdown label. */
  name: string
  /**
   * Fields shown on their own, because the type cannot be built without them
   * or because one of them has to be filled in for the code to mean anything.
   */
  fields: ContentField[]
  /** Everything else, behind "Add Field". */
  extras: ContentField[]
}

const text = (
  name: string,
  displayName: string,
  description: string,
  placeholder?: string,
): ContentField => ({ displayName, name, type: 'string', default: '', description, ...(placeholder ? { placeholder } : {}) })

/**
 * The types the node offers, and only those.
 *
 * Missing on purpose:
 *
 * - **PDF file.** Its payload names a storage key that only the upload
 *   endpoint can mint, so there is nothing a text field could collect. The
 *   node says where to go instead rather than offering a box that cannot work.
 * - **Gallery** and **Audio.** The API answers "That code type is not
 *   available yet."
 * - **Landing page.** Withdrawn; the API refuses the payload by name.
 *
 * URL is here for the dropdown, and has no fields of its own: a website code's
 * content is the Destination box that has always been on this operation, and
 * taking it away would break every workflow already running.
 */
export const CONTENT_TYPES: ContentType[] = [
  {
    value: 'APP_STORE',
    name: 'App Store Link',
    fields: [
      text('appName', 'App Name', 'The app’s name. Shown on the page a phone with no store link lands on.'),
      text('appStore', 'App Store URL', 'The iOS link. Fill this in, the Google Play one, or both.', 'e.g. https://apps.apple.com/us/app/name/id123456789'),
      text('googlePlay', 'Google Play URL', 'The Android link. Fill this in, the App Store one, or both.', 'e.g. https://play.google.com/store/apps/details?id=com.example'),
    ],
    extras: [
      text('fallback', 'Fallback URL', 'Where anything that is not a phone goes. Leave empty for a page of ours with both buttons.'),
    ],
  },
  {
    value: 'EVENT',
    name: 'Calendar Event',
    fields: [
      text('title', 'Title', 'What the event is called'),
      text('start', 'Starts', 'The wall-clock start, as YYYY-MM-DDTHH:MM in the time zone below', 'e.g. 2026-10-03T19:00'),
    ],
    extras: [
      { displayName: 'All Day', name: 'allDay', type: 'boolean', default: false, description: 'Whether the event takes the whole day rather than a span of hours' },
      text('description', 'Description', 'What the event is about'),
      text('end', 'Ends', 'The wall-clock end, as YYYY-MM-DDTHH:MM. Empty means an hour after the start, or the same day.', 'e.g. 2026-10-03T21:00'),
      text('location', 'Location', 'Where it is'),
      text('timeZone', 'Time Zone', 'The IANA zone the times above are in. Empty means UTC.', 'e.g. Europe/Oslo'),
      text('url', 'URL', 'A web address for the event, such as where to book'),
    ],
  },
  {
    value: 'VCARD',
    name: 'Contact Card (vCard)',
    fields: [text('firstName', 'First Name', 'The first name on the card')],
    extras: [
      text('city', 'City', 'The town or city'),
      text('country', 'Country', 'The country'),
      text('email', 'Email', 'The email address on the card'),
      text('lastName', 'Last Name', 'The surname on the card'),
      text('note', 'Note', 'Anything else to carry on the card'),
      text('organization', 'Organization', 'The company or organisation'),
      text('postalCode', 'Postal Code', 'The postcode or ZIP'),
      text('region', 'Region', 'The state, county or region'),
      text('street', 'Street', 'The street address'),
      text('title', 'Job Title', 'The job title'),
      text('phone', 'Mobile Phone', 'The number on the front of the card. Saved as the mobile.'),
      text('website', 'Website', 'A web address for the person or company'),
      text('workPhone', 'Work Phone', 'The switchboard or desk line. Saved as the work number.'),
    ],
  },
  {
    value: 'EMAIL',
    name: 'Email',
    fields: [text('email', 'To', 'Who the message is addressed to. Several addresses, separated by commas.', 'e.g. sales@example.com')],
    extras: [
      text('bcc', 'BCC', 'Blind copies, separated by commas'),
      text('body', 'Body', 'The message the scanner’s mail app opens with'),
      text('cc', 'CC', 'Copies, separated by commas'),
      text('subject', 'Subject', 'The subject line'),
    ],
  },
  {
    value: 'GS1',
    name: 'GS1 Digital Link',
    fields: [
      text('domain', 'Domain', 'The domain the Digital Link resolves to', 'e.g. example.com'),
      text('gtin', 'GTIN', 'The product’s GTIN. The check digit is verified.', 'e.g. 09506000134352'),
    ],
    extras: [
      text('batch', 'Batch Or Lot', 'Application identifier 10'),
      text('expiry', 'Expiry Date', 'Application identifier 17, as YYMMDD'),
      text('production', 'Production Date', 'Application identifier 11, as YYMMDD'),
      text('serial', 'Serial Number', 'Application identifier 21'),
    ],
  },
  {
    value: 'LOCATION',
    name: 'Location',
    fields: [
      text('query', 'Place Or Address', 'The place by name or address. Fill this in, the coordinates, or a maps link.', 'e.g. Oslo Opera House'),
    ],
    extras: [
      { displayName: 'Latitude', name: 'latitude', type: 'number', default: 0, description: 'A number between -90 and 90. Send the longitude with it.', typeOptions: { minValue: -90, maxValue: 90, numberPrecision: 6 } },
      { displayName: 'Longitude', name: 'longitude', type: 'number', default: 0, description: 'A number between -180 and 180. Send the latitude with it.', typeOptions: { minValue: -180, maxValue: 180, numberPrecision: 6 } },
      text('mapsLink', 'Maps Link', 'A link copied out of Google Maps or Apple Maps: in the app, Share, then Copy link.'),
    ],
  },
  {
    value: 'PAYMENT',
    name: 'Payment Link',
    fields: [
      {
        displayName: 'Provider',
        name: 'provider',
        type: 'options',
        default: 'paypal',
        description: 'How people pay you. The link is rebuilt on this provider’s own host.',
        options: [
          { name: 'Buy Me a Coffee', value: 'bmc' },
          { name: 'Cash App', value: 'cashapp' },
          { name: 'Other', value: 'other' },
          { name: 'PayPal', value: 'paypal' },
          { name: 'Revolut', value: 'revolut' },
          { name: 'Stripe', value: 'stripe' },
          { name: 'Venmo', value: 'venmo' },
          { name: 'Wise', value: 'wise' },
        ],
      },
      text('handle', 'Handle Or Link', 'Your handle on that provider, or the whole payment link pasted in', 'e.g. paypal.me/yourname'),
      text('payee', 'Payee Name', 'The name people see, so they know who they are paying'),
    ],
    extras: [
      text('amount', 'Amount', 'A number above zero. Only some providers carry it in the link.', 'e.g. 12.50'),
      {
        displayName: 'Currency',
        name: 'currency',
        type: 'options',
        default: 'USD',
        description: 'The currency the amount is in',
        options: ['AUD', 'BRL', 'CAD', 'CHF', 'CZK', 'DKK', 'EUR', 'GBP', 'INR', 'JPY', 'MXN', 'NOK', 'NZD', 'PLN', 'SEK', 'USD'].map(
          (code) => ({ name: code, value: code }),
        ),
      },
      text('note', 'Note', 'What the payment is for'),
    ],
  },
  {
    value: 'PHONE',
    name: 'Phone',
    fields: [text('phone', 'Phone Number', 'The number to dial. Keep the country code.', 'e.g. +4722123456')],
    extras: [text('extension', 'Extension', 'Dialled after the call connects. Digits, and may contain * or #.')],
  },
  {
    value: 'REVIEW',
    name: 'Review Request',
    fields: [
      {
        displayName: 'Platform',
        name: 'platform',
        type: 'options',
        default: 'google',
        description: 'Where the review goes',
        options: [
          { name: 'Facebook', value: 'facebook' },
          { name: 'Google', value: 'google' },
          { name: 'Other', value: 'other' },
          { name: 'Trustpilot', value: 'trustpilot' },
          { name: 'Yelp', value: 'yelp' },
        ],
      },
      text('value', 'Link, Page Or ID', 'What identifies you on that platform: the review link, the page, or the ID', 'e.g. https://g.page/r/CabcdefgHIJKLM/review'),
    ],
    extras: [],
  },
  {
    value: 'SMS',
    name: 'SMS',
    fields: [text('phone', 'Phone Number', 'The number the message is addressed to', 'e.g. +4722123456')],
    extras: [text('message', 'Message', 'The text the scanner’s messages app opens with')],
  },
  {
    value: 'TEXT',
    name: 'Text',
    fields: [text('text', 'Text', 'The exact text inside the pattern, up to 2000 characters')],
    extras: [],
  },
  { value: 'URL', name: 'URL', fields: [], extras: [] },
  {
    value: 'WIFI',
    name: 'Wi-Fi',
    fields: [text('ssid', 'Network Name (SSID)', 'The network name, exactly as the router spells it')],
    extras: [
      {
        displayName: 'Encryption',
        name: 'encryption',
        type: 'options',
        default: 'WPA',
        description: 'How the network is secured. An open network carries no password at all.',
        options: [
          { name: 'None (Open)', value: 'nopass' },
          { name: 'WEP', value: 'WEP' },
          { name: 'WPA/WPA2/WPA3', value: 'WPA' },
        ],
      },
      { displayName: 'Hidden Network', name: 'hidden', type: 'boolean', default: false, description: 'Whether the network hides its name rather than broadcasting it' },
      text('password', 'Password', 'The passphrase, copied exactly. Leave empty on an open network.'),
    ],
  },
]

/** The dropdown, alphabetical the way n8n wants its options. */
export const CONTENT_TYPE_OPTIONS = CONTENT_TYPES.map(({ name, value }) => ({ name, value })).sort(
  (a, b) => a.name.localeCompare(b.name),
)

/** One field's n8n parameter name: unique per operation, so the two never collide. */
export function fieldName(prefix: string, type: string, field: string): string {
  const head = type.toLowerCase().replace(/_(.)/g, (_, c: string) => c.toUpperCase())
  return `${prefix}${head[0]?.toUpperCase() ?? ''}${head.slice(1)}${field[0]?.toUpperCase() ?? ''}${field.slice(1)}`
}

function toProperty(prefix: string, type: ContentType, field: ContentField): INodeProperties {
  return {
    displayName: field.displayName,
    name: fieldName(prefix, type.value, field.name),
    type: field.type,
    default: field.default,
    description: field.description,
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.options ? { options: field.options } : {}),
    ...(field.typeOptions ? { typeOptions: field.typeOptions } : {}),
    routing: { send: { type: 'body', property: `payload.${field.name}` } },
  } as INodeProperties
}

/**
 * The per-type inputs for one operation.
 *
 * `prefix` keeps Create's and Update's parameters apart, and `typeParameter` is
 * the picker they key off - `type` on Create, `contentType` on Update. Each
 * field is revealed only while its own type is chosen, which is also what stops
 * it being sent: n8n builds the request from the parameters it would display.
 */
export function contentProperties(options: {
  prefix: string
  typeParameter: string
  operation: string
}): INodeProperties[] {
  const { prefix, typeParameter, operation } = options
  const out: INodeProperties[] = []

  for (const type of CONTENT_TYPES) {
    const show = { resource: ['code'], operation: [operation], [typeParameter]: [type.value] }
    for (const field of type.fields) {
      out.push({ ...toProperty(prefix, type, field), displayOptions: { show } })
    }
    if (type.extras.length === 0) continue
    out.push({
      displayName: 'Content Fields',
      name: fieldName(prefix, type.value, 'extras'),
      type: 'collection',
      placeholder: 'Add Field',
      default: {},
      description: 'The rest of what this content type can carry',
      displayOptions: { show },
      options: type.extras
        .map((field) => {
          const property = toProperty(prefix, type, field)
          // Inside a collection the key is the option's own name, so it is the
          // payload key rather than the prefixed parameter name.
          return { ...property, name: field.name }
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    } as INodeProperties)
  }

  return out
}
