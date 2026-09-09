# Parent Playbook

A private weekly playbook for sports parents — weekly plans, at‑home activities, an athlete journey (games, milestones, photos), and age‑appropriate parent guidance. Installable progressive web app (add to home screen, no app store). No build step.

- **Live:** https://playbookbp.com
- **Backend:** Supabase (auth, database, storage)
- **Hosting:** Railway — Caddy serving static files from a container (project `ParentPlaybook`)

## Project structure

Single‑page app split into small, single‑purpose modules so agents/developers can each work in one file without collisions. See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full module map.

- `index.html` — shell; loads Supabase + the modules in order
- `css/app.css` — all styles
- `js/*.js` — one concern per file (core, auth, onboarding, program, shell, the `screen-*` files, journey, sheets, invites, pwa)
- `js/init.js` — boot; **loaded last**

## Deploy

Push to `main`. Railway builds and deploys on its own — there is no deploy command to run.

```
git push origin main
```

The app itself still has no build step: no bundler, no transpile, classic `<script src>` tags.
What Railway builds is the *container* that serves those files.

- **`Dockerfile`** — copies the public assets into a `caddy:2-alpine` image. Every `COPY` is an
  **allowlist**: a new file at the repo root is not served until someone adds a line on purpose.
  The build asserts that no private file (`AUDIT.md`, `supabase/`, `.env`, `.claude/`) reached the
  image and that the expected public ones did, and **fails** rather than shipping a leak.
- **`Caddyfile`** — clean URLs (`/privacy` serves `privacy.html`), `404.html` for unmatched routes,
  `application/manifest+json` on the manifest, and `must-revalidate` on `sw.js`.

To check a deployment, or to deploy from this folder without a push:

```
railway deployment list --service <service-id> --json
railway up --detach
```

> Railway does **not** read `.vercelignore`. That file is kept only in case the site ever moves
> back to Vercel — the Dockerfile's allowlist is what actually keeps private files out today.
