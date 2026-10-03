# Shortlist — AI Recruitment Screening Platform

Multi-tenant web app that implements the proposal end to end:

1. **Setup** — recruiter pastes a JD; the AI model extracts a requirement spec that the recruiter edits and confirms. Knockouts, weights, custom questions, shortlist size, interview pool and a hard interview spend cap are set per role.
2. **Stage 1: CV ranking** — bulk upload (PDF, DOCX, TXT, scanned images with OCR fallback). Every CV is structured, passed through a fast keyword pass, then scored on a fixed rubric. Every sub-score keeps only evidence quotes that are verified to exist in the CV. Every CV is also kept in a company-wide library (deduped by email) — any later role can pull in and re-score every CV the company has ever collected, not just what was freshly uploaded to it.
3. **Stage 2: consent** — top N candidates get an invite (email via Resend and/or SMS/WhatsApp via Twilio, both optional — without either, the recruiter copies and shares the link manually) to a consent page. Unanswered invites are re-sent up to 3 times, then the candidate is marked unreachable.
4. **Stage 3: AI voice interview** — the candidate consents, then the AI interview happens either **in-browser** (talks to the agent right there in their own tab, over their own microphone — no app to install; scored from the transcript the browser itself captured, so it never depends on a webhook) or, for roles set to **phone call** (requires an OmniDimension phone number), the system calls the candidate automatically within the workspace's configured calling hours (default 9am–6pm IST) and retries at different times of day up to 3 attempts. Interview mode is chosen per role in its Settings tab. Questions are generated per candidate from the gap between their CV and the JD; the agent always discloses it is an AI and that the conversation/call is recorded.
5. **Stage 4: re-rank and reports** — the transcript is scored on a fixed rubric and combined with the CV score using the role's weights. The report includes a recommendation, strengths and concerns with verbatim quotes, skill verification, logistics and suggested probes. Unsupported claims are dropped before the report is released.
6. **Delivery** — ranked shortlist plus reserve pool, report PDF export (print), CSV export, funnel analytics with drop-off reasons. Each candidate who makes the shortlist automatically gets a one-time email saying so, with a link to book the human round if you've set a scheduling link (Calendly or similar) for that role — otherwise it just says the hiring team will be in touch.

The platform ranks and recommends; it never rejects. Recruiters can promote or reject anyone at any stage.

## Stack

- **Next.js 16** (App Router, server actions): UI and API in one service
- **Supabase Auth**: sign-up, sign-in and session cookies. The app keeps its own `users`/`memberships`/`organizations` tables (via Drizzle, in your own Postgres) keyed by the Supabase auth user id, for roles and multi-tenant data — Supabase itself only ever sees an email and password.
- **PostgreSQL** via Drizzle ORM: all app data, including CV files and a durable job queue (`FOR UPDATE SKIP LOCKED`). This can be the same Postgres database Supabase gives your project, or any Postgres 14+.
- **OpenAI** (Responses API, structured outputs): fast tier `gpt-5-mini` for CV parsing and scoring, smart tier `gpt-5` for questions, interview scoring and reports
- **OmniDimension**: voice agent + browser voice sessions (`@omnidim-ai/client`). The candidate's mic and the agent's voice both run in their browser tab; a post-call webhook is used only as best-effort enrichment (recording link, sentiment), never as the thing scoring depends on.
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

With `OMNIDIM_API_KEY` set on the server (platform-wide), every new workspace gets its interview agent created automatically the moment it signs up — nobody has to find, paste, or verify an OmniDimension key themselves. A workspace can still paste its own key in **Settings → Voice interviews** if it needs a separate OmniDimension account (a workspace key overrides the platform key). To set this up from scratch:

1. Set `OMNIDIM_API_KEY` on the server (platform-wide), or have each workspace paste its own key in **Settings → Voice interviews**. A workspace key overrides the platform key.
2. Make sure `APP_URL` is your public `https://` address — a secure context is required for the browser to grant microphone access (plain `http://localhost` is exempt, for local dev).
3. In **Settings**, click **Create interview agent**. This creates an agent with AI disclosure, adaptive follow-ups, opt-out handling and the post-call webhook `APP_URL/api/webhooks/omnidim/<secret>`.

By default interviews are browser voice sessions (OmniDimension's Sessions API) — no phone number needed. When the candidate clicks **Start my interview now**, the app creates a session server-side and the browser connects directly with `@omnidim-ai/client`, which handles microphone capture and audio playback. The moment the session ends, the browser posts the transcript it captured straight back to the app — that's what triggers scoring, so a missed or delayed webhook never blocks anything. The webhook is only used to backfill a recording link and sentiment, if OmniDimension provides them for sessions, and never re-scores an interview that's already completed.

**Phone-call interviews (optional, per role).** If your OmniDimension account has an outbound phone number, paste its **Phone number ID** in Settings → Voice interviews. Once set, any role can be switched to **phone call** mode in that role's own Settings tab (In-browser stays the default and is the only option until a number is configured). For a phone-call role, consenting on the invite page doesn't start anything in the browser — it just confirms the candidate is ready. The app then dials them automatically, strictly within the workspace's calling-hours window (Settings → Workspace and data retention, default 9am–6pm **IST**; email and SMS are never restricted by this window), retrying at different times of day up to 3 attempts before marking the candidate unreachable. The post-call webhook is the only signal that a phone call ended, so for this mode it drives completion directly (with a call-log poll as a fallback if the webhook is delayed).

## Deployment

The app is a single Docker image (`Dockerfile`) that serves the web app and runs the worker and scheduler. It needs PostgreSQL (Supabase's own, or any other) and the environment variables in `.env.example`.

| Option | When | Notes |
| --- | --- | --- |
| **Railway** | Fastest start | New project → Deploy from GitHub (uses the Dockerfile) → set variables → add a custom domain. Choose the Singapore region. |
| **DigitalOcean App Platform** | Simple, and data stays in India | Deploy the Dockerfile as a web service, point `DATABASE_URL` at your Supabase project (or a DO Managed Postgres in BLR1), set `DATABASE_SSL=true`. |
| **AWS ap-south-1 (Mumbai): App Runner or ECS Fargate** | Enterprise clients, DPDP residency | Push the image to ECR, run on App Runner or ECS, keep secrets in Secrets Manager. |

**Not recommended:** Vercel or other serverless-only hosts. They can't run the long-lived worker and scheduler, so you would need a separate always-on worker instance.

**Scaling:** run 2+ web instances of the image with `RUN_WORKER=false`, plus 1+ private instances of the same image with `RUN_WORKER=true` (no public traffic needed) to process jobs. The job queue and scheduler are safe to run concurrently (SKIP LOCKED plus advisory locks). Outside Docker, `npm run worker` starts a worker-only process.

**On a free-tier host (e.g. Render's free web service):** two things make the app feel slow, and neither is fixable by changing this code — both are inherent to running on a single shared, spun-down instance:

1. **Cold starts.** A free Render web service spins down after ~15 minutes with no traffic, and the next request has to wait ~30-50s for it to boot back up. The app's first page load after a quiet period will always feel this out, no matter what.
2. **Shared/throttled CPU.** The background worker (job queue + scheduler) runs inside the same single process as web requests, since Render's free tier doesn't offer a separate background-worker service. The worker's polling has been tuned to stay out of the way (checks for new jobs every ~4s instead of every 1s, the scheduler tick runs every 45s instead of 20s), but on a free instance's fraction-of-a-core CPU, a page load can still queue up behind whatever the worker or an in-flight OpenAI/OmniDimension call is doing.

The real fix for both is a paid plan with dedicated CPU and no spin-down (Render's Starter tier, ~$7/mo, is enough) — code-level tuning only takes the edge off, it can't remove either limitation.
