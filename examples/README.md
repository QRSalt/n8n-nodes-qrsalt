# Example workflows

Import any of these in n8n with **Workflows → Import from file**, then pick your
own credential on each node.

| File | What it does |
| --- | --- |
| [`print-batch-from-spreadsheet.json`](print-batch-from-spreadsheet.json) | A dynamic code per spreadsheet row, each fetched as a 40 mm PDF and emailed for printing |
| [`repoint-a-printed-code.json`](repoint-a-printed-code.json) | Finds a campaign's codes by tag and sends them somewhere else, without reprinting |
| [`slack-on-scan.json`](slack-on-scan.json) | Posts to Slack the moment a code is scanned |

These are not part of the npm package — the published tarball carries `dist/`
only.
