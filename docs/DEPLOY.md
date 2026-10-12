# Production deployment (Railway + Supabase)

About an hour, start to finish. Everything here is done in the Railway, Supabase, Resend and OmniDimension dashboards; no code changes.

## 1. Supabase (database, sign-in, file storage)

1. Create a project in **Mumbai (ap-south-1)** on the **Pro** plan (daily backups, no auto-pause).
2. **Project Settings → API**: note the Project URL, the `anon` key and the `service_role` key.
3. **Project Settings → Database → Connection string → Transaction pooler** (port 6543): note the URI.
4. **Project Settings → JWT Keys**: switch to **asymmetric signing keys** (faster session checks on every request).
5. **Authentication → Providers → Email**: keep **Confirm email** on.
6. **Authentication → URL Configuration**: Site URL = your `APP_URL`; add `https://<your-domain>/auth/callback` to Redirect URLs.
7. **Authentication → Emails → Templates**:
   - *Confirm signup* link: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email&next=/app`
   - *Reset password* link: `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password`
8. **Authentication → SMTP**: use Resend's SMTP (step 3) so Supabase's own emails come from your domain and aren't capped at Supabase's low default rate.

The app creates its tables (migrations run on boot) and the private `cvs` storage bucket by itself.

## 2. Railway (the app)

1. New project → **Deploy from GitHub repo** → `harsha7123/ai_hiring`. Railway reads `railway.json` and builds the `Dockerfile`.
2. **Settings → Region**: Singapore (`asia-southeast1`), the closest to Mumbai.
3. **Settings → Resources**: at least 1 GB RAM (CV parsing needs memory).
4. **Variables** (see `.env.example` for all of them):

   | Variable | Value |
   | --- | --- |
   | `APP_URL` | `https://hire.yourdomain.com` |
   | `DATABASE_URL` | Supabase transaction-pooler URI |
   | `DATABASE_SSL` | `true` |
   | `APP_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` — store it safely, never change it |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | from Supabase |
   | `OPENAI_API_KEY` | your key |
   | `OMNIDIM_API_KEY` (and optionally `OMNIDIM_FROM_NUMBER_ID`) | from OmniDimension |
   | `RESEND_API_KEY`, `EMAIL_FROM` | from Resend, e.g. `Acme Hiring <hire@acme.com>` |
   | `ERROR_WEBHOOK_URL` | a Slack/Discord incoming webhook |
   | `OPERATOR_NAME`, `PRIVACY_CONTACT_EMAIL`, `GRIEVANCE_OFFICER` | shown on /privacy and /terms |
   | `TRUSTED_PROXY_HOPS` | `1` (or `2` if you put Cloudflare in front) |
5. **Settings → Networking → Custom domain**: add `hire.yourdomain.com` and create the CNAME it shows. HTTPS is automatic.

If a required variable is missing or unsafe (e.g. `APP_URL` not https), the app refuses to start and the deploy log says exactly which one.

## 3. Email (Resend)

Add and verify your domain (SPF and DKIM DNS records). Without this, invitations land in spam. Use a subdomain such as `mail.yourdomain.com` if you prefer.

## 4. Monitoring

1. Create an uptime monitor (UptimeRobot, Better Stack — free tiers are fine) on `https://<your-domain>/api/health?deep=1`, every 5 minutes, alerting your team. It fails if the database is unreachable, the background worker has stopped, or jobs are stuck.
2. `ERROR_WEBHOOK_URL` posts application errors to Slack/Discord.
3. Railway → Observability: search logs with `level:error`.

## 5. Go-live check (about 20 minutes)

1. Sign up, confirm the email (the link should land you in the app), sign out, use **Forgot password**, sign back in.
2. Create a role with a real job description; confirm the requirements.
3. Upload 3–5 real CVs. They should reach *Ranked* within a minute or two.
4. Start interviews, open the invite link on a phone, take the interview end to end.
5. Open the candidate's report. If it shows **"Unverified transcript"**, OmniDimension isn't sending the conversation in its webhook for browser sessions — tell the developer before going further.
6. Check `/api/health?deep=1` returns `"ok": true`.

## Scaling later

Run two or more web services from the same repo with `RUN_WORKER=false`, plus one service with `RUN_WORKER=true` (no public domain needed). Rate limits, the job queue and the scheduler are shared through Postgres, so this needs no other changes.
