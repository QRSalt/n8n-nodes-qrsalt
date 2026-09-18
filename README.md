# n8n-nodes-qrsalt

Make QR codes and short links in [n8n](https://n8n.io), render and read QR code
images, re-point a code you have already printed, read its scans, and start a
workflow the moment somebody scans one.

Two nodes and a credential ship in the package:

- **QRSalt** — the action node: 21 operations across QR codes, short links,
  images, analytics, folders, tags, UTM presets, forms and menus.
- **QRSalt Trigger** — fires on a scan, a new code, a change, or a form answer.
- **QRSalt API** — one API key, shared by both.

**Three levels of access.** Two operations need no account at all: drop the node
in and run it. A free API key adds the full renderer. Everything that stores,
lists, changes or measures a code needs a plan with API access
([prices](https://qrsalt.com/pricing)).

| You have | You can run |
| --- | --- |
| No account | QR Image → Render (Free), Read (Free) |
| A free API key | …and QR Image → Render, with every format, size and design option |
| A plan with API access (Pro and above) | …and everything else below |
| A plan with webhooks (Business) | …and the QRSalt Trigger |

## Everything the nodes do

| Resource | Operations |
| --- | --- |
| **QR Code** | Create · Get · Get Many · Update · Delete · Change Many · Get Image · Get Scans |
| **QR Image** | Render · Render (Free) · Read (Free) |
| **Short Link** | Create · Get Many |
| **Analytics** | Get |
| **QR Form** | Get Many · Get Responses |
| **QR Menu** | Get Many |
| **Folder** | Create · Get · Get Many · Update · Delete |
| **Tag** | Get · Get Many · Update · Delete |
| **UTM Preset** | Get Many |
| **QRSalt Trigger** | Code Scanned · Code Created · Code Updated · Code Disabled · Form Answered |

So: make a code, change where it points after it is printed, delete it, draw it
as a file, read the text back out of a picture of one, list and search what you
have, and count the scans — with a trigger for the moment a scan happens.

The action node is marked usable as a tool, so an AI Agent node can drive it.

## Install

**From the editor, on Cloud or self-hosted.** Settings → Community nodes →
Install, then `n8n-nodes-qrsalt`. An instance owner or admin has to do this.

**Self-hosted, by hand.** In your n8n data folder:

```sh
npm install n8n-nodes-qrsalt
```

Then restart n8n. Node.js 22 or newer. Both nodes then appear in the node panel
under **QR**, **QR Code** or **QRSalt**.

## Credential

Make a key in the QRSalt dashboard under **Settings → API keys**. It starts
`qr_live_` and is shown once.

In n8n, add a **QRSalt API** credential:

| Field | What to put |
| --- | --- |
| API Key | The `qr_live_…` key |
| Base URL | `https://app.qrsalt.com` unless you are on a staging or self-hosted instance |

Saving tests the key. A wrong or revoked key is rejected there and then. A valid
key on a plan without API access is told the truth: it works, but only for
QR Image → Render.

Any plan can make a key. What it may do depends on the plan, and is checked on
every request — a key on a plan that later lapses stops working.

## Examples

Five workflows that show the range. The JSON for the first three is in
[`examples/`](examples) and imports straight into the editor.

### Print a batch of codes from a spreadsheet

**Google Sheets → Read rows** → **QRSalt → QR Code → Create** (Destination
`{{$json.url}}`, Name `{{$json.title}}`) → **QRSalt → QR Code → Get Image**
(Code ID `{{$json.data.id}}`, Format PDF, 40 mm) → **Gmail → Send**, the file
attached.

One dynamic code per row, each as a print-ready PDF. Because they are dynamic,
any of them can be re-pointed later without reprinting.

### Re-point a printed code when the campaign ends

**Schedule Trigger**, daily → **QRSalt → QR Code → Get Many** (Filters → Tag
`spring-campaign`) → **QRSalt → QR Code → Update** (Update Fields → Destination
`https://example.com/whats-on-now`, Note `spring ended`).

Every printed poster follows from the next scan. Nothing is reprinted. Use
**Change Many** instead when you only need to pause or re-file them — it takes
up to 500 IDs in one call.

### Post to Slack when a code is scanned

**QRSalt Trigger**, Events `Code Scanned` → **Slack → Send message**:
`{{$json.data.slug}} scanned in {{$json.data.city}}`.

Activating the workflow registers the webhook with QRSalt; deactivating it
removes it again. Every delivery's signature is verified before the workflow
runs.

### Read a code out of an uploaded image and look it up

**Webhook** (or Gmail / Drive / Form trigger) → **QRSalt → QR Image → Read
(Free)** (Input Binary Field `data`, Look For `QR Code`) → **QRSalt → QR Code →
Get Many** (Search `{{$json.data}}`) → **IF**: known code, or one to flag.

The read needs no account, so this half runs before anybody signs up. Set Look
For to *Every Symbology Below* to accept barcodes on packaging too.

### Weekly scan report to a sheet

**Schedule Trigger**, Mondays → **QRSalt → Analytics → Get** (From
`{{$now.minus(7, 'days').toFormat('yyyy-MM-dd')}}`, Breakdown `Country`) →
**Google Sheets → Append**.

Totals and a daily series for the whole workspace. For one code instead, use
**QR Code → Get Scans** with the code's ID.

## Try every operation in one run

[`examples/zzz-full-test.json`](examples/zzz-full-test.json) exercises the whole
node against a real workspace and tidies up after itself. Use it to prove a new
key, a new plan or a new release end to end.

1. Make a credential of type **QRSalt API** **before you import**. The file
   carries no credential of its own, so n8n binds yours to every QRSalt node as
   the workflow comes in and says so in a toast.
2. **Workflows → Import from file**.
3. Fill in the one node n8n leaves alone: open **Check Credential** and pick
   your credential there. It is an HTTP Request node, and n8n never binds those
   for you. Any other node still showing an empty Credential field has to be
   filled in by hand before the run means anything.
4. Press **Execute workflow** once.
5. Open the last node, **Summary**, and copy its single `report` field.

The first line is the verdict. Every line after it is one step, and it can only
say one of three things:

- `ok` — with the data it produced. A line says `ok` only when the field that
  step exists to produce is actually in the answer.
- `FAIL` — with the API's own sentence, or the name of what was missing.
- `SKIPPED` — the step's input never existed, so it was not tried. Never a pass.

The run starts with one cheap authenticated call, so a key that is missing,
refused, or on a plan without API access is named on the first line and
everything under it reads `SKIPPED` instead of pretending to have run.

```
RESULT: PASSED — every step returned what it should
QRSalt n8n node test — 2026-09-18T04:12:07.881Z — run 20260918041201
------------------------------------------------------------------------
credential            ok       workspace=Acme plan=PRO
render                ok       image/png 4210 B
readFree              ok       read back "https://example.com/?zzz-test-…" format=qr
codeCreate            ok       id=a4705538-… slug=pKvEYtm link=https://qrsalt.com/pKvEYtm
codeGetScans          ok       1 scans, 1 unique
codeChangeMany        ok       action=status done=2 unchanged=0 skipped=0
…
cleanup               ok       4 of 4 objects removed
------------------------------------------------------------------------
FAILURES: none
```

A run that cannot work says so instead:

```
RESULT: FAILED — 1 step did not work
credential            FAIL     credential not working — HTTP 401 API key is invalid or revoked
renderFree            ok       image/png 4210 B
codeCreate            SKIPPED  credential not working, so this was not tried
```

Everything it makes is named `zzz-test-<timestamp>-…`. It creates two QR codes, a
short link and a folder, uses them, and deletes every one of them again. The key
needs the **delete** scope, which is never ticked on a new key; without it the
delete lines fail and the rest still runs.

A scan trigger cannot fire from a manual execution, so it ships separately as
[`examples/zzz-trigger-test.json`](examples/zzz-trigger-test.json): import it,
check the credential on the trigger node, and **switch the workflow on** —
activating is what registers the endpoint with QRSalt. QRSalt has to reach your
n8n from the internet, so on a laptop start it with `n8n start --tunnel`. Then run
`zzz-full-test`: it requests the short link it created, which is a real scan, and
`scan.recorded` arrives here within seconds. Open **Scan Received** and copy its
`report`: it says `PASSED` only when a delivery actually arrived carrying a scan,
and names what was missing when it did not.

## Reference

Every operation is one call to the [QRSalt REST
API](https://qrsalt.com/qr-code-api). Answers arrive in the API's envelope: the
result under `data`, paging and notes under `meta`.

### QR Code

| Operation | Key fields | Returns |
| --- | --- | --- |
| Create | Destination (or Payload, for non-URL types), Name, Type, plus Kind, Slug, Domain, Folder, Tags, Status | The new code under `data`, with `id`, `shortUrl` and `image` |
| Get | Code ID | The code |
| Get Many | Limit, Offset, Search, Filters (status, tag, folder, domain, output) | A list, with `meta.nextOffset` |
| Update | Code ID, then any of Destination, Name, Slug, Domain, Folder, Tags, Status, Note | The updated code |
| Delete | Code ID | Confirmation |
| Change Many | Code IDs (up to 500), Action: status, folder, domain, tags, UTM preset or delete | Each ID under `results`, done or skipped with a reason |
| Get Image | Code ID, Format, Size or Printed Width | The file, in the binary field you name |
| Get Scans | Code ID, From, To, Breakdown | Totals and a daily series |

**Kind** decides everything downstream. A **dynamic** code (the default) is the
one worth printing: the scan goes through QRSalt, so Update changes where every
printed copy lands. A **static** code carries its destination inside the pattern
and can never be changed.

**Type** covers URL, Text, vCard, Wi-Fi, Email, SMS, Phone, Location, Event,
Payment, Review, PDF, Audio, Gallery, App Store, Landing Page and GS1 Digital
Link. Anything other than URL takes a Payload; the API validates its shape and
names what is missing.

**Get Image** returns the saved code as SVG, PNG, JPG, WebP or PDF — with its
dashboard design, colours and logo — straight into a binary field, so the next
node can attach or upload it with no download step between.

**Delete** cannot be undone, and there is nothing to type before it runs. The
guard is the key: deleting needs one made with the **Delete** permission, which
is never ticked by default and which the *Write* permission does not cover. A
workflow is written on purpose by a person choosing this operation, and a box to
tick is one somebody ticks once and then forgets.

Deleting a **dynamic** code stops every printed copy at the next scan, and its
short link is never handed to anyone else. Deleting a **static** code removes
only the saved record: the printed copies carry their destination inside the
pattern and keep working.

**Change Many → Delete Them** does the same to up to 500 codes in one call, and
wants the same **Delete** permission. An ID that is not one of yours is reported
as skipped, never deleted, and every short link it retires stays retired.

**Get Scans** takes at most 366 days at a time, and your plan's retention can
shorten the range — when it does, `meta.clamped` is true and `meta.note` says so.

### QR Image

| Operation | Needs | Content | Formats |
| --- | --- | --- | --- |
| Render | Any API key | Up to 2000 bytes | SVG, PNG, JPG, WebP, PDF |
| Render (Free) | Nothing | Up to 512 bytes | SVG, PNG |
| Read (Free) | Nothing | An image in a binary field | — |

**Render** draws a static code on the spot and hands it back as a file. Nothing
is stored and nothing can be changed afterwards, so use it for a ticket, a label
or a Wi-Fi card — and QR Code → Create for anything going on a poster.

| Field | Range |
| --- | --- |
| Size | 64–2000 px (Render Free: 64–512) |
| Printed Width | 5–1000 mm, PDF only |
| Error Correction | L, M, Q or H |
| Margin | 0–20 modules |
| Foreground / Background / Eye Colour | Hex |
| Module Shape | Square, rounded, dots, classy |
| Eye Shape / Eye Frame / Eye Ball | Square, rounded, circle, drop, leaf, leaf flipped |
| Eye Rotation | Upright or a half turn |

Render (Free) offers colour, margin, error correction and size only; shapes and
the larger formats are on Render. Neither draws a logo — a logo belongs to a
saved code, so design it in the dashboard and fetch it with QR Code → Get Image.

**Read (Free)** takes a PNG, JPEG or WebP out of a binary field — up to 12 MB,
which is a phone photo at full resolution — and returns the text inside the
code. Nothing is installed in your n8n, and nothing is kept at the other end
either: the image is read in memory and then discarded, never written to disk
and never logged, and neither is the text found in it.

| Look For | Reads |
| --- | --- |
| QR Code | QR codes. The default. |
| Code 128 | Code 128, GS1-128 included |
| Code 39 | Code 39 |
| EAN-13 | EAN-13, and UPC-A and ISBN, which are carried as one |
| ITF | Interleaved 2 of 5, which is what an ITF-14 is |
| Data Matrix | Data Matrix |
| PDF417 | PDF417 |
| Aztec | Aztec |
| Every Symbology Below | All eight in one pass |

That is the whole list: EAN-8, UPC-E, Codabar, MaxiCode and DataBar are not
read, and neither are PDFs or video. One code per image.

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

`data` is the text and `format` is what was found, so a run over a mixed folder
can branch on it. The last three are what the symbol says about itself, and are
`null` for symbologies that carry none — a Code 128 has all three null.

### Rate limits

The keyless endpoints are counted by the work rather than the request: an SVG
costs 1 unit, a PNG up to 256 px 2, a larger PNG 4. One caller gets 480 units an
hour and one address 4,800. Over that is a `429` carrying `resetAt` and a
`Retry-After`.

Because n8n Cloud workflows leave through addresses shared with every other n8n
user, the free operations send an `X-QRSalt-Client` header — a hash of your
instance's id, carrying nothing about you — so your allowance is counted apart
from theirs. It is for sharing the allowance fairly and nothing else.

A key removes the problem: its limit is yours and nobody else can spend it. A
key on Pro or above can make 600 requests a minute; a render-only key on a
cheaper plan, 60. Change Many is limited to 60 requests an hour per workspace on
top of that. Make a free key at
[app.qrsalt.com/dashboard/api](https://app.qrsalt.com/dashboard/api) and use
Render instead of Render (Free).

### Short Link

| Operation | Key fields | Returns |
| --- | --- | --- |
| Create | URL, plus Slug, Domain, Name, Folder, Tags | The link, with `id` and `shortUrl` |
| Get Many | Limit, Offset, Search | A list, with `meta.nextOffset` |

A short link is the same record as a dynamic QR code — same re-pointing, same
scans — so manage it afterwards with the QR Code operations, using the `id` from
the create answer. Note the one difference in spelling: links take **URL**,
codes take **Destination**.

**Get Many** lists the short links only: what was made as a link, which comes
back as `output: "link"`. QR Code → Get Many is the one that lists everything in
the workspace, and its **Has A Short Link** filter is the wider question — every
dynamic code, because each of those has a short link too.

### Analytics

**Get** returns totals and a daily series across every code in the workspace,
with one optional breakdown: Country, Region Code, City, Device, OS, Browser,
Referrer, Hour or Weekday. A region comes back as its ISO 3166-2 subdivision
code (`CA`, `03`), which is what the network reports. Country is on every plan; the rest need advanced
analytics, and asking for one you do not have is refused by name rather than
quietly returning less. From and To are `YYYY-MM-DD`, at most 366 days apart,
defaulting to the last 30 days.

### QR Form, QR Menu, Folder, Tag, UTM Preset

| Operation | Returns |
| --- | --- |
| QR Form → Get Many | Each form with its view and response counts |
| QR Form → Get Responses | Answers, newest first, with the questions under `meta.questions`; Limit 1–100 and Offset |
| QR Menu → Get Many | Each menu with its public URL, whether it is published, and its views |
| Folder → Create | The new folder |
| Folder → Get | One folder and how many codes are in it |
| Folder → Get Many | The folders, with the IDs the code operations ask for |
| Folder → Update | The folder under its new name |
| Folder → Delete | `codesUnfiled`: how many codes moved out. They are not deleted |
| Tag → Get | One tag and how many codes carry it |
| Tag → Get Many | The tags |
| Tag → Update | The tag under its new name, on every code carrying it |
| Tag → Delete | `codesUntagged`: how many codes lost the word. They are not deleted |
| UTM Preset → Get Many | The presets, with the ID Change Many → Apply UTM Preset needs |

Forms and menus are built in the dashboard; the node reads them. Tags have no
create of their own — naming one on a code or in a bulk action makes it.

Deleting a folder or a tag deletes neither the codes nor anything printed. A
folder's codes move to "no folder"; a tag's codes lose the word. Both need a key
with the **delete** permission, which is never ticked for a new key. For
form answers as they arrive, use the trigger's **Form Answered** event.

## QRSalt Trigger

Needs a plan that includes webhooks (Business). Activating the workflow registers its
webhook URL with QRSalt and stores the signing secret; deactivating it removes
the endpoint again, so nothing is left behind failing.

| Event | Fires when |
| --- | --- |
| Code Scanned | Somebody scanned a code or opened a short link |
| Code Created | A code or short link was made |
| Code Updated | A code was renamed or re-pointed |
| Code Disabled | A code was paused, deleted or disabled |
| Form Answered | A QR Form was answered — the answers are in the payload |

A scan arrives with its country, `regionCode`, city, device, OS, browser and
referrer host under `data`. `regionCode` is the ISO 3166-2 subdivision code the
network reports — `03`, `CA` — not a region name; the country is beside it.

Every delivery carries `x-qr-signature: t=<unix seconds>,v1=<hex hmac-sha256>`
over `${timestamp}.${body}`. The node verifies it against the raw request bytes
before the workflow runs, and refuses anything older than five minutes with a
401 even when the signature is genuine.

Two things to build around. Delivery is at-least-once: the same event can arrive
twice, so deduplicate on the `x-qr-event-id` header, and one can be missed, so
reconcile with Get Scans if you need exact numbers. And QRSalt has to reach your
n8n from the internet — a localhost or private-network instance is refused when
the endpoint is registered.

## When something goes wrong

| Message | What it means |
| --- | --- |
| `That API key is not valid.` | Wrong, revoked, or its workspace is gone |
| `… over the API comes with Pro and above.` | The key is fine; the plan does not include API access |
| `This API key does not have the "write" scope.` | The plan is fine; the key was made narrower. Make a wider one under Settings → API keys |
| `Webhooks are not included in …` | The trigger needs a plan with webhooks |
| `A static code … cannot be repointed.` | Only dynamic codes can be updated. Create a new one |
| `Too many requests. Slow down…` | Rate limited; the answer carries `retry-after` |
| `This API key does not have the "delete" scope.` | Deleting, one code or many, needs a key made with the Delete permission |
| HTTP 422 from Read (Free) | No code of the kind you asked for was found in the image |
| HTTP 415 from Read (Free) | Not a PNG, JPEG or WebP — judged by the file's bytes, not its name |
| HTTP 413 from Read (Free) | The image is over 12 MB |
| `The range was shortened to what your plan retains.` | Not an error: `meta.clamped` on an analytics answer |

Every refusal keeps the API's own sentence and adds what to do about it.

## Development

```sh
npm install
npm run build
npm run lint
npm test
npm run dev       # runs n8n locally with these nodes loaded (needs Docker)
```

Issues and pull requests:
[QRSalt/n8n-nodes-qrsalt](https://github.com/QRSalt/n8n-nodes-qrsalt).

## Licence

MIT.
