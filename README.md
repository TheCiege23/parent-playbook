# Parent Playbook

A private weekly playbook for sports parents — weekly plans, at‑home activities, an athlete journey (games, milestones, photos), and age‑appropriate parent guidance. Installable progressive web app (add to home screen, no app store). No build step.

- **Live:** https://playbook.chimaura.com
- **Backend:** Supabase (auth, database, storage)
- **Hosting:** Vercel (static)

## Project structure

Single‑page app split into small, single‑purpose modules so agents/developers can each work in one file without collisions. See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full module map.

- `index.html` — shell; loads Supabase + the modules in order
- `css/app.css` — all styles
- `js/*.js` — one concern per file (core, auth, onboarding, program, shell, the `screen-*` files, journey, sheets, invites, pwa)
- `js/init.js` — boot; **loaded last**

## Deploy

Static, no build step. From this folder:

```
npx vercel deploy --prod --yes
```
