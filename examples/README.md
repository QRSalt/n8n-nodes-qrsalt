# Example workflows

**Make the QRSalt API credential first**, named `QRSalt account`, then import
with **Workflows → Import from file**. The two `zzz-` files name that credential
rather than carrying an ID, so n8n binds them to yours on import; the others
leave the field empty for you to pick. Either way, check every QRSalt node has a
credential before running. From 0.1.4 a QRSalt node with no credential fails the
step and says so; the HTTP Request nodes in these files are n8n's own, and one
of those with no credential is skipped, handing its input to the next node as
though nothing had happened.

| File | What it does |
| --- | --- |
| [`print-batch-from-spreadsheet.json`](print-batch-from-spreadsheet.json) | A dynamic code per spreadsheet row, each fetched as a 40 mm PDF and emailed for printing |
| [`repoint-a-printed-code.json`](repoint-a-printed-code.json) | Finds a campaign's codes by tag and sends them somewhere else, without reprinting |
| [`slack-on-scan.json`](slack-on-scan.json) | Posts to Slack the moment a code is scanned |
| [`zzz-full-test.json`](zzz-full-test.json) | Every operation of the node in one run, cleaning up after itself, ending in one copyable report |
| [`zzz-trigger-test.json`](zzz-trigger-test.json) | The scan trigger on its own, for the one thing a manual run cannot cover |

These are not part of the npm package — the published tarball carries `dist/`
only.
