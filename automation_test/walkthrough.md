# Interview Walkthrough Script

Script for the "walk me through your solution" half of the test. Total time: **~5 minutes**.

The goal isn't to read the canvas — it's to show *why* the workflow looks the way it does. The seniority signal is in the design rationale: the parallel logging, the IF-based validation, the node-name reference in Respond, the `onError` semantics. Time it out loud once before you walk in; if you're running long, trim section 4 (Clearbit), not the design-decision sections.

---

## 0. Frame the problem (15 sec)

> "I picked Task 1 because lead routing is the most common automation in any B2B stack — and it lets me show webhooks, branching, validation, parallel execution, and multiple integrations in one workflow. I built it in n8n because the entire workflow exports to a JSON file, so what I'm about to show you is fully reproducible — you can import it and get an identical setup."

---

## 1. Show the canvas (45 sec)

Open the workflow. Read the **Overview sticky note** out loud — it's there for exactly this moment.

Trace the happy path with your cursor:

> "Lead comes in here on the webhook. Validate, then an IF — bad input gets a clean 400 immediately, good input continues. Enrich, score. Then **Score fans out two ways** — Sheets logs in parallel, Switch routes by tier. Each routing branch hits external systems and feeds into the same 200-response node, which reads the lead data straight from Score so a failing branch can't corrupt the response."

---

## 2. Click the Webhook node (10 sec)

> "POST to `/webhook/lead-intake`. Response mode is set to 'response from another node' — the caller blocks until routing completes and gets back JSON describing what happened."

---

## 3. Click "Validate & Normalize" — call out the design choice (45 sec)

> "Important detail here: this Code node *doesn't throw* on bad input. It returns a `valid: false` flag with an error message."
>
> *(point at the IF node)* "Then this IF routes invalid leads to a `Respond 400` node with the error in the body."
>
> "Why not just throw? Because in n8n, when a Code node throws inside a webhook workflow, the workflow halts before Respond can fire. The caller gets a silent empty 200 — worst possible UX. The flag-and-IF pattern guarantees a real 4xx with a useful body. I learned that the hard way during testing."

This is a strong moment. It signals that you actually ran the workflow and learned from real behavior, not just diagrammed it.

---

## 4. Click "Enrich (Clearbit-mock)" (25 sec)

> "Simulated Clearbit, since the test allowed it. Hand-curated fixtures for demoable domains — Stripe gets High, local-bakery gets Low — and a deterministic hash fallback for everything else. The doc comment at the top shows the one-line swap to a real Clearbit HTTP Request node, with `onError: continueRegularOutput` so a Clearbit outage doesn't take routing down."

---

## 5. Click "Score Lead" (25 sec)

> "Single auditable Code node with the rubric in comments. Company size buckets, industry bonus, total, tier label."
>
> "I deliberately did *not* split this into a chain of IFs — when sales comes back next quarter and says 'Tech is now 5 points and we want a Healthcare bonus,' I want to change one Code node, not five wired-up IFs. Same logic, much more legible."

---

## 6. Call out the parallel fan-out from Score (45 sec) — this is the headline design move

> "This is the part I'd really highlight. Score has two outgoing connections — one to the **Sheets branch**, one to **Switch**. They run in parallel."
>
> "Two reasons for that. First, **logging is independent of routing** — a Sheets failure shouldn't block a Slack ping, and a Slack failure shouldn't block the audit log. Making them siblings instead of serial removes that coupling entirely."
>
> "Second, **response latency**. Serial would be `validate + enrich + score + log + route + respond`. Parallel is `validate + enrich + score + max(log, route) + respond`. For high-volume forms, that matters."

*(point at the small Format for Sheets Code node sitting between Score and Sheets)*

> "Quick note on this Format node — it flattens the nested `score` and `enrichment` objects to the exact 9 columns the sheet wants. I added it because n8n's Sheets node auto-creates headers from the full upstream JSON on first write, including nested objects, which then breaks subsequent appends with a column-drift error. Pinning the shape upstream is cleaner than trying to coerce the Sheets node. Another lesson from testing rather than diagramming."

> "There's a small tradeoff on parallel fan-out: if I want guaranteed 'lead in sheet before lead in Slack,' I need a different design — but the spec doesn't require that ordering, and recovery is straightforward via an Error Trigger workflow that drains failed sheet writes."

---

## 7. Click the Switch (15 sec)

> "Three named outputs — high, medium, low — keyed on the tier the score node already computed. Cleaner to read than nested IFs and makes the canvas mirror the spec exactly."

---

## 8. Walk the three branches (45 sec)

**High → Slack + CRM (parallel)**
> "High-tier triggers two things in parallel: Slack ping into `#sales-leads` and a HubSpot deal creation. Both have `onError: continueRegularOutput` so a Slack outage doesn't block the CRM, and vice versa."

**Medium → Mailchimp**
> "Medium-tier drops into a Mailchimp nurture list with a `medium-tier` tag, so marketing can segment by score band."

**Low → Resources email**
> "Low-tier gets a templated resources email — getting started guide, case studies, pricing — they're not ignored, but no sales person gets paged."

---

## 9. Click "Respond to Webhook" — point at the expression (45 sec) — this is the second seniority moment

> "One more subtle but important detail. Look at the response body — it reads from `$('Score Lead').item.json`, not `$json`."
>
> "If I used `$json`, Respond would get whatever the upstream branch produced. And here's the thing — when an external node like Slack fails with `continueRegularOutput`, n8n outputs an error object on the regular output port. So `$json.email` would be `undefined`, and the response would be malformed."
>
> "Reading by node name pulls from Score Lead's known-good output, regardless of what happened downstream. The response stays well-formed even when the integrations don't."

---

## 10. Live demo (45 sec)

```bash
./test/send-test.sh all
```

Show the four responses arriving in the terminal. Then in the editor → **Executions** in the left sidebar → click any one → walk the data through node-by-node. *This is the most concrete part of the demo.*

If you wired up Slack and Sheets credentials, switch to those tabs and show the new row + the message arriving live.

---

## 11. Closing — production additions (45 sec)

This is the seniority moment. Don't skip it.

> "What's here matches the spec, but for production I'd add:
>
> - **Retries with exponential backoff** on the HTTP nodes — n8n has this built in, just enable.
> - **An Error Trigger workflow** that catches whatever escapes `onError: continueRegularOutput` and writes to a 'stuck leads' sheet plus pages oncall.
> - **A replay workflow** on a cron that drains that sheet and retries.
> - **Real Clearbit + a Redis cache** so I don't re-enrich the same domain twice.
> - **A test workflow** that fires fixtures at the webhook and asserts response shape, runnable in CI via the n8n CLI.
>
> All five are small — maybe a day's work — but they're what turns this from a demo into something you can leave running."

---

## Anticipated questions

**Q: Why not log first, then route serially? Wouldn't that guarantee logging before routing acts?**
> Two reasons I went parallel. First, the spec doesn't require ordering — it just says "log all leads with scores," which the parallel design satisfies. Second, in serial, a Sheets schema bug or a Sheets outage takes routing down with it; in parallel they're independent. If the spec did require strict ordering — say, "the lead must exist in the sheet before any external system is notified" — I'd add a post-Sheets dependency on Switch, accept the latency cost, and put `onError: stopWorkflow` on Sheets to enforce the contract.

**Q: Why a Code node for scoring instead of expressions in a Set node?**
> Mostly readability. The scoring rubric will change — it always does — and a 15-line JS function with comments is much easier for the next person to modify than a stack of nested expressions in Set fields. Same logic, more legible.

**Q: What if Clearbit returns nothing for a domain?**
> Two-line fix: `onError: continueRegularOutput` on the HTTP Request, and a Set node after that fills in `companySize: 0, industry: 'Unknown'`. The score node already handles those — `Unknown` falls into the "others = 1pt" bucket — so an unenriched lead just scores low and gets the resources email, which is the right default.

**Q: Why the IF-and-flag pattern for validation instead of just throwing?**
> Tested both. Throwing halts the workflow before Respond fires, so the webhook caller gets an empty 200 — terrible. Flag-and-IF gives a real 400 with a useful body. The throw approach would only work if I added an Error Trigger workflow purely to format the validation error, which is more wiring for the same outcome.

**Q: How would you handle 1000 leads/sec?**
> n8n in single-process mode wouldn't, so this is the wrong tool at that volume. I'd put a queue in front — Cloud Pub/Sub or SQS, written from a tiny webhook handler — and have n8n in queue mode pull from it with horizontal workers. The workflow itself wouldn't change; the trigger would.

**Q: Why does Respond read `$('Score Lead')` instead of trusting upstream data?**
> Because `onError: continueRegularOutput` means a failing external node still emits a JSON item on the main output port — but the item is the error object, not the original lead data. If Respond used `$json.email`, a Slack outage would corrupt the response body. Pulling from Score Lead by name guarantees a well-formed response regardless of branch behavior.

**Q: What if the company already uses Make.com?**
> Same workflow translates directly — Webhook → Router → modules. The patterns are portable; the syntax differs. About an hour to port since the design is already done.
