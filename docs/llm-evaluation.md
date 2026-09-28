# Optional LLM-assisted evaluation: design plan

**Status: not implemented.** The portal currently stores a human-entered integer score (0–100) and feedback per coach per team. It has no official event rubric, submission upload, document parser, AI endpoint, automated scoring, or AI button. These instructions are for a future integration, not a feature that works after setting a secret. Confirm the organizer's authority to process participants' submissions and approve a rubric before development.

## Choose a model and where to run it

- For a local proof of concept, try **Ollama with `qwen2.5:7b-instruct`** (or another appropriately licensed instruction model). Install Ollama from its official website, check the model's current license and hardware requirements, then run `ollama pull qwen2.5:7b-instruct`. Evaluate its performance on your languages and rubric using human-scored examples before choosing a production model. Model names and availability may change; no model is guaranteed to grade reliably.
- Test locally with `ollama run qwen2.5:7b-instruct`. Ollama serves an HTTP API on `http://127.0.0.1:11434` by default. For a local API smoke test on Windows PowerShell (with no private participant material), run:

  ```powershell
  $body = @{ model = 'qwen2.5:7b-instruct'; prompt = 'Summarize why a human-approved rubric matters.'; stream = $false } | ConvertTo-Json
  Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/generate' -Method Post -ContentType 'application/json' -Body $body
  ```

  **Stock local Ollama does not give you an API key:** localhost access is not a remotely usable credential. Never expose its unauthenticated API directly to the internet.
- For production, run a supported model on a reliable GPU server (Ollama or an OpenAI-compatible server such as vLLM), *behind* an authenticated HTTPS gateway with timeouts, request-size limits and monitoring. A developer laptop that is turned off cannot serve production requests. A Cloudflare Worker cannot reach your laptop's `localhost`; it needs a reachable HTTPS endpoint. A Cloudflare Tunnel can carry traffic to a private host, but a tunnel alone is not authentication: require Cloudflare Access service-token authentication or an equivalent gateway. Restrict the model host itself from public access.
- A hosted model provider is an alternative, but participant data would leave your infrastructure. Review consent, contracts, retention, region and costs first. Provider API keys come from that provider's dashboard, not from Ollama.

## Where the local API key comes from

For **self-hosting**, the server operator creates and manages the credential for the authenticated gateway (or for a model server that supports API-key authentication). It is **not** downloaded from a model and is not a GitHub or Cloudflare API token. For example, generate a random key on a trusted machine:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Configure the private gateway to require that key (or use a Cloudflare Access service token issued in the account dashboard); set TLS, per-request limits, key rotation and restricted network access. A generated string has **no effect** until the gateway is configured to validate it. Do not put the key in frontend code, `wrangler.jsonc`, a commit, screenshots, or public logs. Once a backend integration exists, add it to the *correct* Worker as a Cloudflare secret, for example `npx wrangler secret put EVAL_LLM_API_KEY`, and use a separate local `.dev.vars` value for development. Secret names and authentication headers must match the implemented gateway; **the current Worker does not read this secret**. Never reuse `BOOTSTRAP_SECRET`. If using Cloudflare Access service tokens instead, store the client ID and client secret as Worker secrets and forward the required Access headers from the Worker only. Rotate/revoke credentials when someone loses access.

## Rubric and human review

1. Get the **official**, versioned event rules from organizers: eligibility, tracks, required materials, disqualifiers, scoring categories, maximum points per category and tie-breaking. This repository currently has only `Main Track` and `Junior Track` labels and a 0–100 score; it contains **no official weights or criteria**. Do not invent weights or treat model suggestions as official scores.
2. Specify which participant materials may be reviewed and obtain permission. Today the portal only holds team metadata and an admin-supplied deck URL; it does not ingest decks, enforce Drive access, or verify their content. Build a permission-checked ingestion flow before evaluating any documents. Never let a model fetch arbitrary URLs; validate sources and enforce file size/type limits, malware checks, timeouts and access controls.
3. For each permitted category, ask the model for a **draft**: suggested points within the approved category range, short evidence with page/section references, missing evidence, uncertainty and possible rule conflicts. Require structured, validated output; reject out-of-range, incomplete or unsourced answers. Treat submission text as untrusted data, never as instructions to override the rubric or call tools. Include the rubric version and model/prompt version in a separate review record.
4. A coach reads the source material and accepts, edits or rejects each suggestion before saving a **human** evaluation. AI suggestions must not write to `evaluations`, update the leaderboard or approve/disqualify a team automatically. Make AI use visible to reviewers; retain a clear distinction between model drafts and submitted coach scores. Escalate eligibility/disqualification to organizers.
5. Before rollout, benchmark against anonymized, consented, human-reviewed examples across tracks, languages and quality levels. Measure agreement, citation accuracy and disparate errors; test prompt injections, fabricated evidence, missing materials and failures. Log minimal metadata, not raw participant documents or credentials. Establish retention/deletion, incident handling, human appeal and recovery procedures.

## Implementation checklist (future work)

- Organizer-approved rubric and data-processing permission, plus a secure document source and consent policy.
- Private inference service and credentialed HTTPS access from the Cloudflare Worker; protect secrets and verify timeout/failure behavior.
- Admin-only (or explicitly approved judge-only) request route, per-team authorization, cost/abuse limits and input bounds. Never call the model directly from the browser.
- Separate database tables for AI drafts, model/rubric versions and reviewer decisions; migrations and audit records. Keep existing human evaluations and leaderboard semantics unchanged until organizers approve any change.
- UI that labels drafts as unverified and allows human correction; tests for auth, injection, malformed output, unavailable model, privacy and responsive display. Do not promise fully automated judging.
