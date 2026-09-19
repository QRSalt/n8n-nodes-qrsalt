# The review video for n8n

n8n's automated review of `n8n-nodes-qrsalt` has passed. The page at
<https://creators.n8n.io/nodes/n8n-nodes-qrsalt/integration> now asks for a
video, and on **18 September 2026** it said, word for word:

> Please record a short video (5 min. or less) demonstrating the capabilities of
> your node. Your video should cover the following steps:
> 1. Open your n8n instance and install your node from npm. Make sure you're
>    installing the same version that you are submitting for verification.
> 2. Create a new workflow and insert your node.
> 3. Set up a new credential for your node and demonstrate that the credential
>    test works.
> 4. Now, demonstrate the functionality of the node by performing the most common
>    actions with it.
> 5. If you are building an app node, demonstrate that it can be used as a tool
>    for an AI agent (showing one example action when used as a tool suffices).
>
> Please don't include cuts in your video and use proper screen recording
> software (Loom or similar). If you like, you can voice over the video to
> provide more context for us.

So this has to be one unbroken screen recording made by a person: it must show
the node being installed, a credential being typed in, and the credential test
passing. A stitched-together GIF is not that, and nobody but you can type the
key. The recording is yours to make; everything else is below.

## Before you press record (not filmed)

1. Have an n8n instance open — Cloud or self-hosted — where the node is **not**
   yet installed, so step 1 of the video can install it.
2. Have your QRSalt API key on the clipboard. It needs a plan with API access
   and the **delete** scope; a Free or Starter key passes the credential test and
   then stops the test run at the first step it is not allowed to make.
3. Have `examples/zzz-full-test.json` from this repo on the desktop, ready to
   drag into the canvas.
4. Full-screen the browser, one window, no notifications.

## The recording — about four minutes, no cuts

| # | Do this | What the frame proves | Time |
|---|---|---|---|
| 1 | **Settings → Community nodes → Install**, type `n8n-nodes-qrsalt`, tick the risk box, Install. When it lands, point at the version — it must read **0.1.6**, the version submitted. | Installed from npm, same version. | 0:45 |
| 2 | **Overview → Create Workflow**. Click the **+**, type `QR code` in the search. Both **QRSalt** and **QRSalt Trigger** appear. Pause a second on the list. | The search terms people actually type find the node. | 0:20 |
| 3 | Add **QRSalt**. Set Resource **QR Image**, Operation **Render (Free)**. Content `https://qrsalt.com`. Leave the credential empty. **Test step**. An image comes back in the output panel. | The free path works with no account at all — nothing to sign up for. | 0:30 |
| 4 | In the same node, Credential → **Create new credential**. Paste the API key, leave Base URL as is, Save. Wait for the green **Connection tested successfully**. | Step 3 of n8n's list: a new credential, and its test passing. | 0:30 |
| 5 | Change Operation to **Render**, Test step — an image again, this time through the key. | The credential is really being used. | 0:15 |
| 6 | Drag `examples/zzz-full-test.json` onto the canvas. It imports about thirty nodes, with your credential bound to each QRSalt one on the way in. Open **Check Credential** and pick the credential there too — it is an HTTP Request node, and n8n leaves those alone. Scroll across it once so the reviewer sees the shape. | Every operation of the node, in one workflow. | 0:20 |
| 7 | **Execute workflow**. It runs create → scan → get → update → get scans → get image → get many → short link → analytics → folders → tags → and then deletes everything it made. Let it finish on camera. Every node goes green; a refused step would go red and stop the run there instead. | Steps 4 and the delete path, against a real account. | 0:45 |
| 8 | Open **Create QR Code** — show the `id` and the `shortUrl`. Open **Get Scans** — show the scan the workflow fired. Open **Delete QR Code** — show it removed. Open **Summary** and show the `report` field: the first line is the verdict. | The operations produced real data, and the code is gone at the end. | 0:30 |
| 9 | New canvas. Add an **AI Agent**, attach your model, then **Tool → QRSalt**, Resource **QR Code**, Operation **Create**. Ask the agent: *make a QR code pointing at https://qrsalt.com*. Show the tool call and the returned id. | Step 5 of n8n's list — the node is `usableAsTool`. | 0:30 |
| 10 | Optional, only if it is quick: add **QRSalt Trigger**, pick **Code Scanned**, and show the webhook URL it registers. Do not wait for a real scan on camera. | The trigger node exists and registers. | 0:15 |

Stop the recording. Roughly 4:20 — comfortably inside the five-minute limit. If
you need it shorter, drop steps 5 and 10.

## Submitting it

On <https://creators.n8n.io/nodes/n8n-nodes-qrsalt/integration> the page offers
two ways, and either is enough on its own:

- **Drag video here or click to upload** — a plain file picker. A local `.mp4`
  goes straight in, with no further sign-in or identity step.
- **Alternatively, enter a link to your video** — a single text box labelled
  *eg. via Loom*. A Loom link, or any link the reviewer can open, goes here.

Then press **✓ Submit for review**.

Loom is the shorter road: record, and paste the share link. If you record
locally instead and the file is large, `ffmpeg` is on this machine —
`ffmpeg -i in.mkv -vcodec libx264 -crf 28 -preset veryfast out.mp4` gets a
four-minute screen capture comfortably under the size of anything a web upload
minds.
