# Example workflows

## Open every QRSalt node once after importing

**n8n attaches your credential when a node is first opened, never on import.**
Import a file, run it straight away, and the first QRSalt node fails with a 401
— then the next one, and the next, one per run. Nothing is wrong with the key:
the request went out with no `Authorization` header at all, because that node
has no credential yet.

So after importing, click through every QRSalt node once — opening it is enough,
n8n picks your most recent QRSalt credential and the field fills in — then run.

No file here carries a credential of its own, and none can: an exported
credential is only a reference to one on the instance it came from, useless
anywhere else, and a reference n8n cannot resolve fails the node outright.

**Make the QRSalt API credential first**, then import with **Workflows → Import
from file**. From 0.1.4 a QRSalt node with no credential fails the step and says
so; the HTTP Request nodes in these files are n8n's own, and one of those with
no credential is skipped, handing its input to the next node as though nothing
had happened.

In the two `zzz-` test files a refused step turns the node **red and stops the
run** — none of them is set to continue on error, so a missing or rejected key
cannot be mistaken for a pass. The one exception is **Fire a Scan**, a plain
request to the short link the run just made, which carries on if a proxy blocks
it. So `zzz-full-test.json` has a report only when the run reached the end; a
run that stopped is answered by the red node, not by the summary.

| File | What it does |
| --- | --- |
| [`print-batch-from-spreadsheet.json`](print-batch-from-spreadsheet.json) | A dynamic code per spreadsheet row, each fetched as a 40 mm PDF and emailed for printing |
| [`repoint-a-printed-code.json`](repoint-a-printed-code.json) | Finds a campaign's codes by tag and sends them somewhere else, without reprinting |
| [`slack-on-scan.json`](slack-on-scan.json) | Posts to Slack the moment a code is scanned |
| [`zzz-full-test.json`](zzz-full-test.json) | Every operation of the node in one run, cleaning up after itself, ending in one copyable report |
| [`zzz-trigger-test.json`](zzz-trigger-test.json) | The trigger on its own, all five events, for the one thing a manual run cannot cover |

These are not part of the npm package — the published tarball carries `dist/`
only.

## Firing the trigger test

`zzz-trigger-test.json` has one **QRSalt Trigger** subscribed to all five
events, feeding a **Delivery Received** node that judges whatever arrives, and
below it one branch per event. Only the branch named after the event that
arrived holds an item, so the execution says which event it was at a glance.

Three things have to be true before anything arrives:

1. **The workflow is switched on.** Activating is what registers the webhook
   with QRSalt. A manual execution registers nothing.
2. **QRSalt can reach your n8n from the internet.** On a laptop, start n8n with
   `n8n start --tunnel`. A localhost or private-network URL is refused when the
   workflow is activated, and the node says so.
3. **The workspace is on a plan that includes webhooks** — Business. The node
   checks this first and names your plan if it is not included.

Then fire each event in your own account. Deliveries are queued and sent by a
worker, so allow about a minute for each.

| Event | How to fire it | Needs |
| --- | --- | --- |
| `scan.recorded` | Open one of your short links in a browser | A code or short link that is live |
| `code.created` | **Dashboard → QR codes → New**, and save it | — |
| `code.updated` | Open a code and change its **destination**, then save | A dynamic code. Renaming alone sends nothing — the destination, custom link, domain or campaign tags have to change |
| `code.disabled` | Open a code and **Pause** it, or delete it | — (resuming a paused code sends nothing) |
| `form.submitted` | Open a published QR Form's link and answer it | **A published form.** A draft's link does not work; publish it from the switch at the top of the form page, and it needs at least a title and one question |

The one that may need setting up first is `form.submitted`: if there is no
published form in the workspace, make one and publish it before testing that
branch. Everything else uses codes that already exist.

`Settings → Webhooks → Send a test event` is the quickest proof that the URL,
the plan and the signature all work — but it only ever sends one event
(`scan.recorded` when the endpoint subscribes to it), and its body carries
`test: true` with an event id starting `evt_test_`. The report labels it as a
test for that reason: it proves the plumbing, not that your own action fired
the event.

Switching the workflow off again deletes the endpoint from the workspace.
