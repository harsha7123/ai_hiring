# Shortlist — AI Recruitment Screening Platform

Multi-tenant web app that implements the proposal end to end:

1. **Setup** — recruiter pastes a JD; Claude extracts a requirement spec that the recruiter edits and confirms. Knockouts, weights, custom questions, shortlist size, interview pool and a hard call spend cap are set per role.
2. **Stage 1: CV ranking** — bulk upload (PDF, DOCX, TXT, scanned images with OCR fallback). Every CV is structured, passed through a fast keyword pass, then scored on a fixed rubric. Every sub-score keeps only evidence quotes that are verified to exist in the CV.
3. **Stage 2: consent and scheduling** — top N candidates get an SMS/WhatsApp invite (Twilio, optional) to a consent page where they book a slot, take the call now, or ask for a human. Unanswered invites are re-sent up to 3 times, then the candidate is marked unreachable.
4. **Stage 3: AI voice interview** — calls go out through **OmniDimension** with per-candidate questions generated from the gap between their CV and the JD. The agent discloses it is an AI and that the call is recorded. No-answers retry up to 3 times at different times of day, within calling hours.
5. **Stage 4: re-rank and reports** — the transcript is scored on a fixed rubric and combined with the CV score using the role's weights. The report includes a recommendation, strengths and concerns with verbatim quotes, skill verification, logistics and suggested probes. Unsupported claims are dropped before the report is released.
6. **Delivery** — ranked shortlist plus reserve pool, report PDF export (print), CSV export, funnel analytics with drop-off reasons.

The platform ranks and recommends; it never rejects. Recruiters can promote or reject anyone at any stage.

## Stack

- **Next.js 16** (App Router, server actions): UI and API in one service
- **PostgreSQL** via Drizzle ORM: all data, including CV files and a durable job queue (`FOR UPDATE SKIP LOCKED`)
- **Claude** (`@anthropic-ai/sdk`, structured outputs): fast tier `claude-haiku-4-5` for CV parsing and scoring, smart tier `claude-opus-5` for questions, interview scoring and reports
- **OmniDimension** REST API: voice agent, outbound calls, call logs and post-call webhook
- Background worker and scheduler run in the web process by default, or as a separate process (`npm run worker`)

## Security

- Passwords hashed with scrypt; constant-time comparison; login lockout after 5 failures per email (25 per IP) in 15 minutes
- Sessions: random 256-bit tokens, stored as SHA-256 hashes, `httpOnly` + `Secure` + `SameSite=Lax` cookies, 7-day sliding expiry. Removing a member revokes their access immediately.
- Roles: owner, admin, recruiter, viewer, checked on every page, action and route
- Tenant isolation: every query is scoped to the session's organisation. A cross-tenant test returns 404 on every route.
- Per-tenant OmniDimension keys encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`)
- Webhooks authenticated by a per-organisation secret in the URL (rotatable)
- Uploads: 10 MB limit, magic-byte type sniffing, files always served as downloads
- Same-origin checks on uploads; server actions have built-in origin checks
- CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, strict referrer and permissions policies
- Bias controls: name, contact details, DOB/age, gender, marital status, religion, caste and nationality lines are redacted before scoring
- Audit log of sign-ins, configuration changes, candidate decisions, consent, downloads and deletions
- Retention: recordings (default 90 days) and candidate records (default 180 days) are purged automatically. Admins can hard-delete a candidate on request.

## Local development

```bash
npm install
cp .env.example .env.local        # fill DATABASE_URL, APP_ENCRYPTION_KEY; AI_DEMO_MODE=true to run without a key
npm run dev                       # migrations run automatically on boot
```

`AI_DEMO_MODE=true` swaps Claude for deterministic heuristics so the whole pipeline can run offline. Use it only for testing.

## Connecting OmniDimension

1. Set `OMNIDIM_API_KEY` on the server (platform-wide), or have each workspace paste its own key in **Settings → Voice interviews**. A workspace key overrides the platform key.
2. Make sure `APP_URL` is your public `https://` address.
3. In **Settings**, click **Create interview agent**. This creates an outgoing agent with AI disclosure, adaptive follow-ups, opt-out handling and the post-call webhook `APP_URL/api/webhooks/omnidim/<secret>`.
4. Optional: set the **From number ID** to call from a specific number (OmniDimension → Phone numbers). For Indian candidates, import an Exotel or Plivo number there.

Call results arrive by webhook and are also reconciled from `GET /calls/logs` every 20 seconds, so interviews still complete if a webhook is missed.

## Deployment

The app is a single Docker image (`Dockerfile`) that serves the web app and runs the worker and scheduler. It needs PostgreSQL and the environment variables in `.env.example`.

| Option | When | Notes |
| --- | --- | --- |
| **Railway** | Fastest start | New project → Deploy from GitHub (uses the Dockerfile) → add PostgreSQL → set variables → add a custom domain. Choose the Singapore region. |
| **DigitalOcean App Platform + Managed PostgreSQL (BLR1, Bengaluru)** | Simple, and data stays in India | Deploy the Dockerfile as a web service, attach a managed Postgres in the same region, set `DATABASE_SSL=true`. |
| **AWS ap-south-1 (Mumbai): App Runner or ECS Fargate + RDS PostgreSQL** | Enterprise clients, DPDP residency, matches the proposal | Push the image to ECR, run on App Runner or ECS, use RDS with encryption at rest and Secrets Manager for env vars. |

**Not recommended:** Vercel or other serverless-only hosts. They can't run the long-lived worker and scheduler, so you would need a separate always-on worker instance.

**Scaling:** run 2+ web instances of the image with `RUN_WORKER=false`, plus 1+ private instances of the same image with `RUN_WORKER=true` (no public traffic needed) to process jobs. The job queue and scheduler are safe to run concurrently (SKIP LOCKED plus advisory locks). Outside Docker, `npm run worker` starts a worker-only process.
