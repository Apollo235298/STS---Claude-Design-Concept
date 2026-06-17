# Southern Travel Surgery — site repo

## ⚠️ Read this first (context for the live site)

**The live production site (www.stsurgery.com) is deployed by Vercel from the `sts-site/` folder.**
The Vercel project's **Root Directory is set to `sts-site`**. Vercel auto-deploys on push to `origin/main`
(`origin` = `github.com/Apollo235298/STS---Claude-Design-Concept`).

**👉 Make ALL future edits to the live site inside `sts-site/`.** Nothing outside that folder is served.

## Live folder: `sts-site/`
```
sts-site/
├── index.html              # the live static site (incl. the "Contact the Doctor" provider modal)
├── assets/                 # fonts, images, logos, favicons (relative paths from index.html)
├── api/
│   └── contact-doctor.js   # Vercel Node serverless function — emails inquiries via Resend
├── package.json            # declares the `resend` dependency
├── vercel.json             # build + routing config (see below — do not remove the api route)
├── .env.example            # names of the required env vars (no secrets)
└── .gitignore
```

### Contact the Doctor flow
- The modal in `index.html` is **provider-facing** (referring dental offices). It POSTs JSON to `/api/contact-doctor`.
- `api/contact-doctor.js` validates server-side and sends a formatted email (HTML + plain text) via **Resend**:
  - **To:** `dental@stsurgery.com` (env `STS_INQUIRY_TO_EMAIL`)
  - **From:** `notifications@send.stsurgery.com` (env `STS_INQUIRY_FROM_EMAIL`; `send.stsurgery.com` is verified in Resend)
  - **replyTo:** the submitter's email
- **Env vars (set in Vercel → Settings → Environment Variables):** `RESEND_API_KEY`, `STS_INQUIRY_TO_EMAIL`, `STS_INQUIRY_FROM_EMAIL`. The API key is server-side only — never in the client.

### Why `sts-site/vercel.json` exists (don't break it)
This is a no-framework static site + one serverless function. The config:
- `builds`: `@vercel/node` builds `api/**/*.js` (so the function actually deploys + installs `resend`); `@vercel/static` serves `index.html` + `assets/**`.
- `routes`: `{"src":"/api/contact-doctor","dest":"/api/contact-doctor.js"}` maps the clean URL to the built function file (legacy `builds` serves it at the `.js` path), then `{"handle":"filesystem"}`, then `/` → `/index.html`.
- **`/api/*` is intentionally NOT rewritten to index.html.** If you remove the api route, `GET /api/contact-doctor` will 404 again.

## ❌ Do NOT edit these (not live / not the source of truth)
- `Concept Claude Design V1/sts-site/` — the *previous* live folder. `sts-site/` was copied from here to escape the space in the path (Vercel rejects function paths with spaces). Kept for history only; not deployed.
- Repo-root `index.html`, `index-v2.html` — old/unrelated designs. Not served.
- Repo-root `api/`, `package.json`, `vercel.json`, `.env.example` — orphaned from an earlier deploy attempt; outside the Root Directory, so Vercel ignores them.
- `next-app/` — an untracked Next.js "V2" prototype. Not deployed.
- **`forms.stsurgery.com` / the Lovable post-op check-in form** — a separate system. Do not touch.

## Local dev / test
- **UI only:** `cd sts-site && python3 -m http.server` → open the printed URL. The modal/validation/design all work; the `/api/*` call 404s locally (no backend) — expected.
- **Full (with the function):** `cd sts-site && npm install && vercel dev`, with a local `.env` (copy `.env.example`). Then `POST /api/contact-doctor` runs the real function.
- **Deploy:** push to `origin main`; Vercel rebuilds from `sts-site/`. Verify with `curl -i https://www.stsurgery.com/api/contact-doctor` → expect `405` JSON (function is live).

## Status
Live and verified: homepage renders, the modal submits, and email is delivered to dental@stsurgery.com.
Optional future cleanup: delete the duplicate `Concept Claude Design V1/sts-site/` and the orphaned repo-root `api/`/`package.json`/`vercel.json`/`.env.example` so there's a single source of truth.
