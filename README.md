# Shortlist — AI Recruitment Screening Platform

Multi-tenant web app that implements the proposal end to end:

1. **Setup** — recruiter pastes a JD; the AI model extracts a requirement spec that the recruiter edits and confirms. Knockouts, weights, custom questions, shortlist size, interview pool and a hard call spend cap are set per role.
2. **Stage 1: CV ranking** — bulk upload (PDF, DOCX, TXT, scanned images with OCR fallback). Every CV is structured, passed through a fast keyword pass, then scored on a fixed rubric. Every sub-score keeps only evidence quotes that are verified to exist in the CV.
3. **Stage 2: consent and scheduling** — top N candidates get an SMS/WhatsApp invite (Twilio, optional) to a consent page where they book a slot, take the call now, or ask for a human. Unanswered invites are re-sent up to 3 times, then the candidate is marked unreachable.
4. **Stage 3: AI voice interview** — calls go out through **OmniDimension** with per-candidate questions generated from the gap between their CV and the JD. The agent discloses it is an AI and that the call is recorded. No-answers retry up to 3 times at different times of day, within calling hours.
5. **Stage 4: re-rank and reports** — the transcript is scored on a fixed rubric and combined with the CV score using the role's weights. The report includes a recommendation, strengths and concerns with verbatim quotes, skill verification, logistics and suggested probes. Unsupported claims are dropped before the report is released.
6. **Delivery** — ranked shortlist plus reserve pool, report PDF export (print), CSV export, funnel analytics with drop-off reasons.

The platform ranks and recommends; it never rejects. Recruiters can promote or reject anyone at any stage.

## Stack

- **Next.js 16** (App Router, server actions): UI and API in one service
- **Supabase Auth**: sign-up, sign-in and session cookies. The app keeps its own `users`/`memberships`/`organizations` tables (via Drizzle, in your own Postgres) keyed by the Supabase auth user id, for roles and multi-tenant data — Supabase itself only ever sees an email and password.
- **PostgreSQL** via Drizzle ORM: all app data, including CV files and a durable job queue (`FOR UPDATE SKIP LOCKED`). This can be the same Postgres database Supabase gives your project, or any Postgres 14+.
- **OpenAI** (Responses API, structured outputs): fast tier `gpt-5-mini` for CV parsing and scoring, smart tier `gpt-5` for questions, interview scoring and reports
- **OmniDimension** REST API: voice agent, outbound calls, call logs and post-call webhook
- Background worker and scheduler run in the web process by default, or as a separate process (`npm run worker`)

## Security

- Authentication delegated to Supabase Auth (bcrypt password storage, session tokens, rate limiting all handled there) — this app never stores a password
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

## Setting up Supabase

1. Create a project at [supabase.com](https://supabase.com) (any region; Mumbai/Singapore is closest to India).
2. **Project Settings → API**: copy the **Project URL** into `NEXT_PUBLIC_SUPABASE_URL`, the **anon public** key into `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the **service_role** key into `SUPABASE_SERVICE_ROLE_KEY` (keep this one server-only — never commit it or ship it to the browser).
3. **Project Settings → Database**: copy the connection string (URI, transaction pooler) into `DATABASE_URL`, and set `DATABASE_SSL=true`. This is the same Postgres database the app's own tables (`organizations`, `positions`, `candidates`, …) live in — `npm run db:migrate` / the app's own startup migration creates them in the `public` schema alongside Supabase's `auth` schema.
4. **Authentication → Providers → Email**: leave "Confirm email" **on** for a public-facing deployment (recommended), or turn it **off** for faster internal testing — sign-up works either way; with it on, new users see a "check your email" message and must click the confirmation link before their first sign-in.
5. **Authentication → URL Configuration**: set the **Site URL** to your `APP_URL`.

No Supabase client code runs in the browser — every call goes through this app's server actions, so nothing beyond the two public keys above needs to reach the client.

## Local development

```bash
npm install
cp .env.example .env.local        # fill in DATABASE_URL, APP_ENCRYPTION_KEY, the Supabase keys; AI_DEMO_MODE=true to run without an OpenAI key
npm run dev                       # migrations run automatically on boot
```

`AI_DEMO_MODE=true` swaps the AI model for deterministic heuristics so the whole CV/interview pipeline can run offline. Use it only for testing — it does not need `OPENAI_API_KEY` at all, but Supabase credentials are still required for sign-in.

## Connecting OmniDimension

1. Set `OMNIDIM_API_KEY` on the server (platform-wide), or have each workspace paste its own key in **Settings → Voice interviews**. A workspace key overrides the platform key.
2. Make sure `APP_URL` is your public `https://` address.
3. In **Settings**, click **Create interview agent**. This creates an outgoing agent with AI disclosure, adaptive follow-ups, opt-out handling and the post-call webhook `APP_URL/api/webhooks/omnidim/<secret>`.
4. Optional: set the **From number ID** to call from a specific number (OmniDimension → Phone numbers). For Indian candidates, import an Exotel or Plivo number there.

Call results arrive by webhook and are also reconciled from `GET /calls/logs` every 20 seconds, so interviews still complete if a webhook is missed.

## Deployment

The app is a single Docker image (`Dockerfile`) that serves the web app and runs the worker and scheduler. It needs PostgreSQL (Supabase's own, or any other) and the environment variables in `.env.example`.

| Option | When | Notes |
| --- | --- | --- |
| **Railway** | Fastest start | New project → Deploy from GitHub (uses the Dockerfile) → set variables → add a custom domain. Choose the Singapore region. |
| **DigitalOcean App Platform** | Simple, and data stays in India | Deploy the Dockerfile as a web service, point `DATABASE_URL` at your Supabase project (or a DO Managed Postgres in BLR1), set `DATABASE_SSL=true`. |
| **AWS ap-south-1 (Mumbai): App Runner or ECS Fargate** | Enterprise clients, DPDP residency | Push the image to ECR, run on App Runner or ECS, keep secrets in Secrets Manager. |

**Not recommended:** Vercel or other serverless-only hosts. They can't run the long-lived worker and scheduler, so you would need a separate always-on worker instance.

**Scaling:** run 2+ web instances of the image with `RUN_WORKER=false`, plus 1+ private instances of the same image with `RUN_WORKER=true` (no public traffic needed) to process jobs. The job queue and scheduler are safe to run concurrently (SKIP LOCKED plus advisory locks). Outside Docker, `npm run worker` starts a worker-only process.
