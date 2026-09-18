# Example workflows

**Make the QRSalt API credential first**, then import with **Workflows → Import
from file**, then open each QRSalt node and check the Credential field is filled
in — an imported workflow cannot carry your credential, and a node without one
fails at the first call.

| File | What it does |
| --- | --- |
| [`print-batch-from-spreadsheet.json`](print-batch-from-spreadsheet.json) | A dynamic code per spreadsheet row, each fetched as a 40 mm PDF and emailed for printing |
| [`repoint-a-printed-code.json`](repoint-a-printed-code.json) | Finds a campaign's codes by tag and sends them somewhere else, without reprinting |
| [`slack-on-scan.json`](slack-on-scan.json) | Posts to Slack the moment a code is scanned |
| [`zzz-full-test.json`](zzz-full-test.json) | Every operation of the node in one run, cleaning up after itself, ending in one copyable report |
| [`zzz-trigger-test.json`](zzz-trigger-test.json) | The scan trigger on its own, for the one thing a manual run cannot cover |

These are not part of the npm package — the published tarball carries `dist/`
only.
