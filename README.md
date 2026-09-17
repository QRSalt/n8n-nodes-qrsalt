# n8n-nodes-qrsalt

QR code nodes for [n8n](https://n8n.io), backed by QRSalt. Generate a QR code or
a short link, render a QR code image, read the text out of a QR code or barcode
somebody sent you, re-point a code you have already printed, read its scan analytics, and
start a workflow the moment somebody scans one.

The package holds three things:

- **QRSalt** — an action node for QR codes, short links, images, forms, menus
  and analytics.
- **QRSalt Trigger** — a trigger node that registers its own webhook with
  QRSalt and verifies every delivery's signature.
- **QRSalt API** — the credential both nodes use: one API key.

## Install

**On n8n Cloud or self-hosted, from the editor.** Settings → Community nodes →
Install, then enter `n8n-nodes-qrsalt`. An instance owner or admin has to do
this.

**Self-hosted, by hand.** In your n8n data folder:

```sh
npm install n8n-nodes-qrsalt
```

Then restart n8n.

Node.js 22 or newer.

Once installed, both nodes are in the editor's node panel under **QR**,
**QR Code** or **QRSalt**.

## Credential

Make an API key in the QRSalt dashboard under **Settings → API keys**. It starts
`qr_live_` and is shown once, so paste it into n8n while you still have it.

In n8n, add a **QRSalt API** credential:

| Field | What to put |
| --- | --- |
| API Key | The `qr_live_…` key |
| Base URL | `https://app.qrsalt.com` unless you are on a staging or self-hosted instance |

Pressing **Save** tests the key against `GET /api/v1/me`. A wrong or revoked key
is rejected there and then, with the API's own message, rather than six steps
later inside a workflow run. A key that is perfectly valid but sits on a plan
without API access is told that instead — it works, but only for QR Image →
Render.

**Any plan can make a key, including Free.** What the key may then do depends on
the plan:

| The key is on | It can |
| --- | --- |
| Free or Starter | Render images: QR Image → Render, and `GET /api/v1/me` |
| Pro or Business | Everything below as well |

Everything under `/api/v1` — codes, links, folders, tags, forms, menus and
analytics — needs **API access**, which starts at Pro. See
[qrsalt.com/pricing](https://qrsalt.com/pricing). Entitlement is checked on
every request, not once when the key was made, so a key on a plan that later
lapses stops working.

## What the action node does

Every operation is one call to the documented REST API at
[qrsalt.com/qr-code-api](https://qrsalt.com/qr-code-api). Answers come back in
the API's envelope: the result under `data`, paging and notes under `meta`.

Each operation says what it needs under its name in the editor, and the
**Needs** column in the tables below says the same thing. There are three
answers: *no account needed*, *an API key on any plan*, and *an API key on a
plan with API access* ([prices](https://qrsalt.com/pricing)).

### Resource: QR Code

| Operation | Calls | Needs |
| --- | --- | --- |
| Create | `POST /api/v1/codes` | API access |
| Get | `GET /api/v1/codes/{id}` | API access |
| Get Image | `GET /api/v1/codes/{id}/image` | API access |
| Get Many | `GET /api/v1/codes` | API access |
| Update | `PATCH /api/v1/codes/{id}` | API access |
| Change Many | `POST /api/v1/codes/bulk` | API access; folders, domains and UTM presets each need the plan that includes them |
| Delete | `DELETE /api/v1/codes/{id}` | API access, and a key with the Delete permission |
| Get Scans | `GET /api/v1/codes/{id}/scans` | API access; breakdowns beyond Country need advanced analytics |

**Create** takes a Destination (or a Payload, for codes that are not a plain
URL), a Name and a Type. Leave Kind alone and you get a **dynamic** code: one
you can re-point after it is printed. A static code carries its destination
inside the pattern and can never be changed.

**Update** is the reason the API exists. Change Destination and every printed
copy of that code opens the new address from the next scan. Only dynamic codes
can be re-pointed; the API says so plainly if you try it on a static one.

**Get Image** hands you the saved code as a file — SVG, PNG, JPG, WebP or PDF —
in the binary field you name, so the next node can write it, attach it to an
email or upload it without a download step in between. It is the code as it is
designed in the dashboard: its colours, its shapes and its logo, without a frame
or a caption.

**Change Many** is the dashboard's bulk bar: up to 500 codes moved to a folder
or a domain, tagged, untagged, paused, resumed or given a campaign-tag preset in
one call. Every id you send comes back under `results` as `ok`, or as `ok: false`
with the reason it was left alone. There is deliberately no bulk delete here —
deleting hundreds of live codes is not something a workflow should be able to do
by mistake; delete them one at a time, or in the dashboard.

**Delete** cannot be undone. The code stops working at once and its short link
is never handed to anyone else, so an old poster can never point at a stranger's
site. It needs a key made with the **Delete** permission, which is never ticked
by default, and it asks for two things before it calls anything: the *I
understand this is permanent* toggle, and the code's own name or short link
ending in **Confirm**. The confirmation goes to QRSalt as `?confirm=` and is
checked against the record, so a workflow aimed at the wrong ID — or an agent
acting on something it read — is refused rather than obeyed.

**Get Scans** reads the daily rollups, not a raw event log — raw scan events are
deleted once counted. From, To and Breakdown are optional; at most 366 days at a
time, and your plan's retention window can shorten the range. When it does,
`meta.clamped` is true and `meta.note` says so.

### Resource: Short Link

| Operation | Calls | Needs |
| --- | --- | --- |
| Create | `POST /api/v1/links` | API access |
| Get Many | `GET /api/v1/links` | API access |

A short link is a dynamic code that you happen to want as a link rather than an
image — same record, same re-pointing, same scans. Manage it afterwards with the
QR Code operations above, using the `id` the create answer gives you.

Custom Ending (Slug) needs a plan that allows chosen endings. Domain must be a
domain already verified in the workspace (Starter and up).

### Resource: QR Image

| Operation | Calls | Needs |
| --- | --- | --- |
| Render | `GET /api/qr` | An API key on any plan, Free included |
| Render (Free) | `GET /api/qr/free` | Nothing — no credential, no account |
| Read (Free) | `POST /api/qr/decode` | Nothing — no credential, no account |

**Render is the one keyed operation that is not sold.** Every API key carries
the `render` scope, so a key minted on the Free plan runs it — which is what
makes it the way past the hourly ceiling on Render (Free): the allowance
becomes yours and nobody else can spend it.

A **static** QR code drawn on the spot and handed back as a file in the binary
field you name. Nothing is stored, nothing is counted, and the content lives
inside the pattern — which also means it can never be changed once it is
printed. Use it for a one-off ticket, a label or a Wi-Fi card; use QR Code →
Create for anything that goes on a poster.

| Field | What it does |
| --- | --- |
| Content | The exact text inside the code, up to 2000 bytes |
| Format | SVG, PNG, JPG, WebP or PDF |
| Put Output File in Field | The binary field the file lands in (`data` by default) |
| Options → Size | 64–2000 px, for everything but PDF |
| Options → Printed Width | 5–1000 mm, PDF only |
| Design → Error Correction | L, M, Q or H |
| Design → Margin | The quiet zone, 0–20 modules |
| Design → Foreground / Background / Eye Colour | Hex colours |
| Design → Module Shape | Square, rounded, dots or classy |
| Design → Eye Shape, Eye Frame, Eye Ball, Eye Rotation | The three corner squares |

Eye Rotation offers upright and a half turn only. Quarter turns are not offered
because measured decode rates drop when the finder patterns are turned a quarter,
and a code that scans on a screen but not on a printed menu is the one failure
that cannot be taken back.

No logo option here: `GET /api/qr` draws the code alone. A logo belongs to a
saved code, so design it in the dashboard and fetch it with QR Code → Get Image.

#### Render (Free)

**Render (Free) needs no account, no API key and no credential.** Drop the node
in, type the text, run it: the image is in the binary field you named. It is the
same drawing code as Render, called on a public endpoint, so a code from it is
the same symbol a paid one would be.

| Field | What it does |
| --- | --- |
| Content | The exact text inside the code, up to 512 bytes |
| Format | SVG or PNG |
| Put Output File in Field | The binary field the file lands in (`data` by default) |
| Options → Size | 64–512 px |
| Options → Margin | The quiet zone, 0–20 modules |
| Options → Error Correction | L, M, Q or H |
| Options → Foreground / Background Colour | Hex colours |

Where it stops, and why: the endpoint is open to anyone, so it is limited by the
hour, and counted in units of work rather than in calls — an SVG spends one, a
PNG up to 256 px two, a larger PNG four. The allowance is 480 units an hour,
which is 480 SVGs or 120 full-size PNGs, and past it the endpoint answers `429`
with a `Retry-After`. See [The free limit](#the-free-limit) for what the
allowance is counted against.

Larger sizes, longer content, JPG, WebP and PDF, module and eye shapes, logos
and everything that is stored and countable are on Render with a key.

#### Read (Free)

**Read (Free) needs no account, no API key and no credential either.** Point it
at a binary field holding an image and the text inside the code comes out in
the output JSON.

| Field | What it does |
| --- | --- |
| Input Binary Field | The binary field holding the image (`data` by default) |
| Look For | Which symbology to look for. QR Code by default. |

The picture is posted to QRSalt and read on the server — nothing is decoded
inside n8n, so this needs no extra packages installed in your instance and adds
none. Nothing is stored: the image is decoded in memory, the text comes back,
and no copy is kept.

**Look For** takes one symbology, or **Every Symbology Below**:

| Choice | Reads |
| --- | --- |
| QR Code | QR codes. The default. |
| Code 128 | Code 128, GS1-128 included |
| Code 39 | Code 39 |
| EAN-13 (Also UPC-A and ISBN) | EAN-13. A UPC-A is a zero-prefixed EAN-13 and an ISBN is carried as one, so all three come back as `EAN13`. |
| ITF (Also ITF-14) | Interleaved 2 of 5, which is what an ITF-14 is read as |
| Data Matrix | Data Matrix |
| PDF417 | PDF417 |
| Aztec | Aztec |
| Every Symbology Below | All eight, in one pass |

That is the whole list — the same symbologies QRSalt itself can draw, each one
proved by drawing it and reading it back. EAN-8, UPC-E, Codabar, MaxiCode and
DataBar are **not** read.

The output item:

```json
{
  "success": true,
  "data": "https://example.com/spring-menu",
  "format": "QRCode",
  "version": 4,
  "errorCorrection": "M",
  "mask": 2
}
```

`data` is the text inside the code and `format` is what was found, so a run
over a mixed folder can branch on it. The three after that are what the symbol
says about itself — its version, its error-correction level and its data mask —
and each is `null` when that symbology does not carry one: a Code 128 has none
of the three.

Where it stops, and why: PNG, JPEG and WebP, up to 4 MB and 24 megapixels, and
one code per image. An image with no code of the kind you asked for is a `422`,
and a file that is not one of those three formats is a `415` — decided by the
file's first bytes, not by its name. There is no "read the code at this URL":
the endpoint takes uploads only, on purpose.

A read spends 8 units of the free allowance, one more for each extra symbology,
so 60 QR reads an hour or about 30 with Every Symbology Below. See
[The free limit](#the-free-limit).

#### The free limit

The free endpoints have no key to count against, so they are counted per caller,
under a ceiling per source address. That distinction matters here more than
anywhere else: **on n8n Cloud your workflows leave through addresses shared with
every other n8n user**, and an allowance counted per address alone would let one
stranger's busy workflow refuse yours.

So the free operations send a header:

```
X-QRSalt-Client: n8n-<16 hex characters>
```

It is a hash of your n8n instance's id — no hostname, no workspace name, no
address, nothing about you — and it is the same on every call, so it behaves as
an allowance rather than a fresh bucket each time. QRSalt counts each id
separately, which is what keeps your calls and a stranger's apart on a shared
address.

It is fairness, never identity. It authenticates nothing, anyone can send any
value, and QRSalt grants nothing on the strength of it — which is why there is
still a ceiling per address above it, ten caller allowances wide. Any
integration behind a shared address can send its own id in that header; it only
has to be opaque, stable and at most 64 characters of letters, digits, `.`, `_`
or `-`.

When one runs out, the `429` says which: your own allowance, or the address
you are calling from. Either way the answer is the same one — **a QRSalt API
key has a limit of its own that nobody else can spend.** The free plan can
create one at [app.qrsalt.com/dashboard/api](https://app.qrsalt.com/dashboard/api);
put it in the QRSalt API credential and use Render rather than Render (Free).

### Resource: QR Form

| Operation | Calls | Needs |
| --- | --- | --- |
| Get Many | `GET /api/v1/forms` | API access |
| Get Responses | `GET /api/v1/forms/{id}/responses` | API access |

Forms are made and edited in the dashboard; the node reads them. **Get Many**
lists each form with its view and response counts. **Get Responses** pages
through the answers, newest first, with the questions under `meta.questions` so
you can label the answers downstream. For answers as they arrive rather than on
a schedule, use the trigger's `Form Answered` event instead.

### Resource: QR Menu

| Operation | Calls | Needs |
| --- | --- | --- |
| Get Many | `GET /api/v1/pages` | API access |

Your QR Menus, read-only, each with its public URL, whether it is published and
how many times it has been viewed.

### Resource: Folder / Tag / UTM Preset

| Operation | Calls | Needs |
| --- | --- | --- |
| Folder → Create | `POST /api/v1/folders` | API access; a plan that includes folders |
| Folder → Get Many | `GET /api/v1/folders` | API access |
| Tag → Get Many | `GET /api/v1/tags` | API access |
| UTM Preset → Get Many | `GET /api/v1/utm-presets` | API access |

Folder IDs are what the code operations ask for, so listing them is usually the
step before filing anything. Tags have no create of their own: naming one on a
code or in a bulk action makes it. UTM presets are made in the dashboard; listing
them is how you find the ID that Change Many → Apply UTM Preset asks for.

### Resource: Analytics

| Operation | Calls | Needs |
| --- | --- | --- |
| Get | `GET /api/v1/analytics` | API access; breakdowns beyond Country need advanced analytics |

Totals and a daily series across every code in the workspace, with one optional
breakdown. Country is available on every plan. Region, City, Device, OS,
Browser, Referrer, Hour and Weekday need advanced analytics; ask for one you do
not have and the API refuses it by name rather than quietly returning less.

### What this node does not do

Every operation is an HTTP call to QRSalt, so nothing is drawn or read inside
n8n and nothing works offline. Most operations also need an API key and a plan
that includes API access; the exceptions are QR Image → Render, which any key
runs, and QR Image → Render (Free) and Read (Free), which need neither an
account nor a credential but do need the instance to be able to reach
`app.qrsalt.com`.

Read (Free) reads one code from one image, and only the eight symbologies its
Look For list names. EAN-8, UPC-E, Codabar, MaxiCode and DataBar are not read.
It does not read a code out of a PDF or a video either; hand it a PNG, JPEG or
WebP.

The node does not upload a logo or set a code's design: designs are made in the
dashboard and come back with QR Code → Get Image.

## What the trigger node does

**QRSalt Trigger needs a plan that includes webhooks (Business)** —
[prices](https://qrsalt.com/pricing). Activate a
workflow on a cheaper plan and the node stops with that sentence — it asks
`GET /api/v1/me` first, precisely so you do not get a confusing 403 from a call
you never made.

Activating the workflow registers the workflow's webhook URL with QRSalt
(`POST /api/v1/webhooks`) and stores the signing secret QRSalt returns. Switching
the workflow off removes the endpoint again (`DELETE /api/v1/webhooks/{id}`), so
a deactivated workflow does not leave something behind that fails six times and
then emails the account.

Events:

| Event | When |
| --- | --- |
| Code Scanned | Somebody scanned a code or opened a short link |
| Code Created | A code or short link was made |
| Code Updated | A code was renamed or re-pointed |
| Code Disabled | A code was paused, deleted or disabled |
| Form Answered | A QR Form was answered — the answers are in the payload |

### Signatures

Every delivery carries `x-qr-signature: t=<unix seconds>,v1=<hex hmac-sha256>`.
The node verifies it against the raw request bytes before the workflow runs:
the signed material is `${timestamp}.${body}`, so a re-serialised body would not
match and a replay older than five minutes is refused even though its signature
is genuine. An unverified request gets a 401 and does not start the workflow.

### What this trigger does not promise

Delivery is at-least-once and **can lose an event**. QRSalt queues webhooks
rather than sending them inline, and the queue swallows its own failures so a
customer's code still gets created. A workflow must not assume it has seen every
scan. If your endpoint keeps failing, QRSalt switches it off; the node reports
that instead of sitting there looking healthy while nothing arrives.

A workspace can hold ten endpoints. QRSalt has to be able to reach your n8n from
the internet, so a localhost or private-network n8n is refused when the endpoint
is registered.

## A worked example: a printed poster that tells you when it is scanned

1. **QRSalt → QR Code → Create.** Destination
   `https://example.com/spring-menu`, Name `Spring menu poster`, Type URL.
   Leave Kind alone so it is dynamic. The answer's `data.shortUrl` is the link
   the code encodes, and `data.image` is a URL that renders the QR as PNG, SVG
   or PDF — give that to whoever is printing. Or follow it with **QR Code →
   Get Image**, Format PDF, and the file itself comes out of the node ready for
   Gmail or Google Drive.
2. **QRSalt Trigger** in a second workflow, Events `Code Scanned`. Activate it.
   From then on every scan starts the workflow with the scan's country, region,
   city, device, OS, browser and referrer host under `data`.
3. **Slack → Send message**, body
   `{{$json.data.slug}} scanned in {{$json.data.city}}`.

Later, when the menu moves:

4. **QRSalt → QR Code → Update.** Code ID from step 1, Update Fields →
   Destination `https://example.com/summer-menu`. Every printed poster follows
   from the next scan. Nothing is reprinted.

## Errors you may meet

| Message | What it means |
| --- | --- |
| `That API key is not valid.` | Wrong, revoked, or its workspace is gone |
| `… over the API comes with Pro and above.` | The key is fine; the plan does not include API access. The node adds the link to [qrsalt.com/pricing](https://qrsalt.com/pricing) |
| `This API key does not have the "write" scope.` | The plan is fine; the key was made narrower. Make one with it under Settings → API keys |
| `Webhooks are not included in …` | The trigger needs a Business plan |
| `A static code … cannot be repointed.` | Make a dynamic code instead |
| `Too many requests. Slow down…` | The per-key rate limit; the answer carries `retry-after` |
| `The range was shortened to what your plan retains.` | Not an error — `meta.clamped` on an analytics answer |

## Working on this package

```sh
npm install
npm run build     # tsc, then the icons and codex files copied into dist/
npm run lint      # n8n's own rules for community nodes
npm test          # builds, then runs the tests against dist/
npm run dev       # runs n8n locally with these nodes loaded (needs Docker)
```

`package.json` sets `n8n.strict`, which means `eslint.config.mjs` has to stay
byte for byte what n8n ships. Do not add so much as a comment to it: the lint
run refuses to start otherwise, and the rules it holds are the ones the Creator
Portal checks against.

The tests are plain JavaScript and run against `dist/`, not the TypeScript
source — partly so they check what n8n will really load, and partly because
n8n's cloud rules refuse `node:` imports in any `.ts` file in the package.

## Releasing

Community nodes published after 1 May 2026 must come from a GitHub Action with
an npm provenance statement, so there is no `npm publish` by hand. Tag the
version and `.github/workflows/publish.yml` publishes it from
[QRSalt/n8n-nodes-qrsalt](https://github.com/QRSalt/n8n-nodes-qrsalt):

```sh
npm version patch      # or minor / major
git push --follow-tags
```

The workflow authenticates with npm through OIDC, so no npm token is stored
anywhere. It needs a Trusted Publisher configured on the npm package for this
repository and the `publish.yml` workflow.

## Licence

MIT.
