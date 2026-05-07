# Lead Enrichment & Routing — n8n

This is my submission for **Task 1** of the automation entry test. A complete, runnable n8n workflow that ingests leads via webhook, enriches them, scores them, logs to Google Sheets in parallel with routing, and dispatches to Slack/CRM/email/nurture based on score.

## Why I picked Task 1

Lead routing is the canonical B2B automation use case — revenue-adjacent, common to every customer, and exercises the breadth of an automation tool (webhooks, branching, multiple integrations, persistent logging, error handling). It also demos cleanly with a single `curl`, which matters for a walkthrough.

## Why n8n over Make.com

n8n exports the entire workflow as a portable JSON file, which means this submission is **fully reproducible** — you can import `workflow.json` into any n8n instance and have an identical setup. Make.com blueprints don't import as cleanly, and the test allows either.

> **If your team is on Make.com instead, the patterns translate directly** (Webhook → Router → modules with the same branching logic). Happy to rebuild this as a Make.com blueprint — about an hour's work since the design is already done.

## First time with n8n?

n8n is a self-hostable workflow automation tool — think Zapier, but the workflow lives in a JSON file you can check into git. A workflow is a graph of **nodes** (one per step) connected on a canvas. Each node either receives a trigger (webhook, cron), transforms data (Code, Set, IF), or talks to an external system (Slack, HubSpot, Sheets). Credentials are stored separately from nodes — you create a `Slack OAuth2 API` credential once, then any Slack node references it by name. That separation is why this workflow's `workflow.json` is safe to share publicly: it carries the wiring and logic, not the secrets.

## Run it locally in 60 seconds

```bash
# 1. Boot n8n (Docker)
cd /Users/adrian/Downloads/automation_test
docker compose up -d

# 2. Open the editor and create the owner account on first run
open http://localhost:5678

# 3. Import the workflow
#    Top-right menu → Import from File → workflow.json

# 4. Activate the workflow
#    Click the "Publish" button in the top-right corner of the editor.
#    (Older n8n tutorials call this an "Active" toggle — same thing,
#    renamed in recent versions. The webhook only registers once published.)

# 5. Fire the test fixtures
./test/send-test.sh all
```

(If you already have n8n running locally — as in my dev environment — skip Docker and just `n8n import:workflow --input=workflow.json`, then click **Publish** in the editor. The CLI activation flag was deprecated; it's a UI action now.)

## What "running" looks like

```
HIGH  → 200  {"status":"ok","email":"sara@stripe.com","score":8,"tier":"high","actions":["slack","crm_deal"]}
MED   → 200  {"status":"ok","email":"priya@midmarket.io","score":4,"tier":"medium","actions":["nurture"]}
LOW   → 200  {"status":"ok","email":"tom@localbakery.com","score":2,"tier":"low","actions":["resources_email"]}
BAD   → 400  {"status":"error","error":"Missing required fields: name, email, company"}
```

## Architecture

```
                                                    ┌─► Format for Sheets ─► Log to Sheets (parallel, leaf)
                                                    │
Webhook → Validate → IF (valid?) ─→ Enrich → Score ─┤
                    └─► Respond 400                 │
                                                    └──► Switch ─┬─► [HIGH]   Slack + CRM Deal ──┐
                                                                 ├─► [MED]    Nurture           ─┼─► Respond 200
                                                                 └─► [LOW]    Resources email   ─┘
```

### Decisions worth calling out

- **Parallel logging, not serial.** Sheets is a sibling of Switch, not upstream of it. A Sheets failure can't break routing; routing latency doesn't depend on Sheets latency. Response time is `max(log, route)`, not `log + route`.
- **Validate uses a flag, not a throw.** Throwing inside a Code node halts the workflow before Respond can fire — the webhook caller gets a silent empty 200. Returning `{valid: false, error: ...}` lets a downstream IF route bad input to a `Respond 400` node with a useful body.
- **A small `Format for Sheets` Code node before the Sheets node.** n8n's Sheets node auto-creates headers from the full upstream JSON on first write — including nested objects (`enrichment`, `score`) and the `valid` flag added by validation — which then trips a column-drift error on subsequent appends. Pinning the shape upstream to exactly the 9 columns the sheet wants is cleaner than coercing the Sheets node into ignoring extra fields.
- **`onError: continueRegularOutput` on every external call.** A flaky CRM API doesn't cascade through the rest of the workflow.
- **Respond reads via node-name reference (`$('Score Lead').item.json...`), not `$json`.** This is the subtle but critical move: even if Slack returns an error object, the response still has the correct lead data — Respond pulls it from the known-good Score Lead output, not from whatever the failing upstream branch produced.
- **Clearbit is simulated, not faked.** A Code node with a hand-curated fixtures map for demoable domains plus a deterministic hash fallback. The doc comment shows exactly which HTTP Request node would replace it in production. (The test explicitly allows simulating external APIs.)
- **Score is computed in code, not a chain of IFs.** One auditable Code node with the rubric inlined as comments — easier to review, easier to change when sales rewrites the rubric.
- **Switch over nested IFs.** Three labelled outputs (`high`/`medium`/`low`), one routing node.

## Wiring up real credentials

The workflow ships with `onError: continueRegularOutput` on every external integration, so it runs end-to-end with **zero credentials** and you still see all four response shapes. But for the live demo, all five integrations below are wired with real accounts. Each one takes 3–10 minutes the first time. Credentials are created in the n8n UI under **Credentials** in the left sidebar, then referenced by the corresponding node — you don't have to edit `workflow.json`.

> Heads up: every node in this workflow uses `onError: continueRegularOutput`, which means a misconfigured credential won't blow up the response — the webhook still returns 200 with a valid `actions` array. So a passing `send-test.sh` is **not** proof the integrations actually fired. Verify by checking the destination system (the Sheet, the Slack channel, the HubSpot Deals view, etc.) after each test.

### 1. Google Sheets (~3 min) — log every lead

1. Create a Google Sheet, add a tab named `Leads`. Copy the spreadsheet ID from the URL (the long string between `/d/` and `/edit`).
2. Open the `Log to Google Sheets` node → paste the spreadsheet ID into `Document ID`.
3. Click `Credential to connect with` → `Create new credential` → `Sign in with Google` → grant access.
4. The first lead through writes the header row automatically.

### 2. Slack (~5 min) — notify sales on high-tier leads

1. Open the `Slack: Notify Sales` node → `Credential` → `Create new credential` → `Sign in with Slack` and authorize the workspace.
2. Change the channel from `#sales-leads` to one that exists in your workspace (the bot must be a member of it — invite it with `/invite @your-bot-name` from inside the channel).

### 3. HubSpot CRM (~10 min) — create deals on high-tier leads

1. In HubSpot → `Settings` → `Integrations` → `Private Apps` → `Create a private app`. Give it a name, then under **Scopes** enable `crm.objects.deals.write` (and optionally `crm.objects.contacts.write` if you later extend the workflow to create contacts and associate them).
2. Copy the access token HubSpot generates.
3. In n8n → `Credentials` → `New` → choose **Header Auth** (not the HubSpot OAuth credential — the Private App token is a Bearer token). Set `Name` = `Authorization`, `Value` = `Bearer <paste-the-token>`. Save as `HubSpot Private App`.
4. The `CRM: Create Deal` HTTP Request node already references this credential by name — no node-side change needed.
5. **Gotcha I hit:** the Deals object doesn't have a `contact_email` property (that's a Contacts-only field). The current body only sends `dealname`, `pipeline: "default"`, `dealstage: "appointmentscheduled"`. If you want to attach the lead's email to the deal in production, you'd POST to `/crm/v3/objects/contacts` first, then create an association — two-step write.

### 4. Mailchimp (~5 min) — drop medium-tier leads into a nurture list

1. In Mailchimp → `Account` → `Extras` → `API keys` → generate a new key. Note the suffix after the dash (e.g. `-us6`) — that's your **server prefix** and you need it for the API URL.
2. Note your **audience ID**: `Audience` → `Settings` → `Audience name and defaults` → "Audience ID".
3. In n8n → `Credentials` → `New` → **Basic Auth**. Username can be anything (e.g. `anystring`), password is the API key. Save as `Mailchimp Basic Auth`.
4. Open the `Nurture: Mailchimp Subscribe` node → confirm the URL uses your server prefix (`https://<prefix>.api.mailchimp.com/3.0/lists/<audience-id>/members`).

### 5. Gmail SMTP (~5 min) — send the resources email to low-tier leads

1. In your Google Account → `Security` → enable 2-Step Verification (required to generate app passwords) → `App passwords` → generate one for "Mail". Copy the 16-character password.
2. In n8n → `Credentials` → `New` → **SMTP**. Host: `smtp.gmail.com`, Port: `465`, SSL: on. Username: the **full Gmail address** of the account that generated the app password. Password: the app password.
3. **Critical alignment:** Open the `Email: Send Resources` node and check the `From Email` field — it **must** match the Gmail address used in the credential (or be a verified alias of it). Gmail silently drops or rewrites the From header otherwise, and you'll see the workflow report success while no email actually arrives.

## Troubleshooting

- **"My curl returned 404."** The workflow isn't published. Click `Publish` in the editor. The webhook URL only registers while a workflow is published.
- **"It returned 200 but nothing actually happened in Slack/HubSpot/etc."** Expected — `onError: continueRegularOutput` makes the response well-formed even when an integration fails. Open the **Executions** tab in the left sidebar, click the most recent execution, and look for nodes outlined in red. Click the red node to see the actual error.
- **"I changed the workflow but the webhook still does the old thing."** n8n caches the published version. After any edit, click `Publish` again to re-register.
- **"The webhook URL says `/webhook-test/lead-intake` instead of `/webhook/lead-intake`."** That's the test URL n8n uses while editing (single-fire, requires the node to be open). The published URL is `/webhook/lead-intake` — use that one for `send-test.sh`.
- **"Where do I see logs?"** Each execution is a row in the Executions tab. Click into it to see the data that flowed through every node — input on the left, output on the right. This is the single best n8n debugging tool; learn it.

## What I'd add for production

- **Retries with exponential backoff** on the HTTP nodes (n8n built-in, just enable).
- **Dead-letter queue:** an Error Trigger workflow that catches anything that escapes `continueRegularOutput`, writes to a "stuck leads" sheet, pages oncall.
- **Replay workflow** on a cron that drains the stuck-leads sheet and retries.
- **Real Clearbit + a Redis cache** so we don't burn API credits on duplicate domains.
- **A test workflow** that fires fixtures at the webhook and asserts response shape — runnable in CI via the n8n CLI.
- **Secret hygiene:** all keys live in n8n credentials, never in node parameters.

## File layout

```
.
├── README.md             ← you are here
├── walkthrough.md        ← script for the live interview demo
├── workflow.json         ← importable n8n workflow (15 nodes)
├── docker-compose.yml    ← spins up n8n locally
└── test/
    ├── leads.json        ← sample payloads with explanations
    └── send-test.sh      ← curl them at the webhook
```
