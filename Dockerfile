# Static hosting for Parent Playbook.
#
# Every COPY below is an ALLOWLIST, deliberately. The Vercel deploy relies on
# .vercelignore to keep AUDIT.md, the supabase/ directory and the unsent email
# templates out of a world-readable deploy — and that file already failed once,
# leaving a 60KB security audit publicly readable. A denylist fails open. This
# fails closed: a new file at the repo root is not served until someone adds a
# line here on purpose.
#
# NOT shipped, and must stay that way:
#   *.md                  ARCHITECTURE / AUDIT / AUDIT-WALKTHROUGH / LAUNCH-READINESS / README
#   supabase/             migrations and edge function source
#   emails/*              except invite.html, which send-invite fetches at runtime
#   .claude/ .env*        tooling and secrets

FROM caddy:2-alpine

WORKDIR /srv

# Pages
COPY index.html 404.html privacy.html terms.html datadeletion.html coaches.html organizations.html ./

# Root assets and PWA plumbing
COPY icon.svg og.png manifest.webmanifest sw.js sitemap.xml llms.txt ./

# App code
COPY css/   ./css/
COPY js/    ./js/
COPY assets/ ./assets/
COPY img/   ./img/

# The ONE email template that is fetched over HTTP at runtime. The others are
# pasted into the Supabase dashboard by hand and have no reason to be public.
COPY emails/invite.html ./emails/invite.html

COPY Caddyfile /etc/caddy/Caddyfile

# Fail the build rather than the audit: if a private file ever reaches the image,
# stop here instead of discovering it with curl in production.
RUN set -eu; \
    for bad in AUDIT.md ARCHITECTURE.md README.md LAUNCH-READINESS.md AUDIT-WALKTHROUGH.md supabase .env .claude; do \
      if [ -e "/srv/$bad" ]; then echo "REFUSING TO SHIP: /srv/$bad is private"; exit 1; fi; \
    done; \
    for good in index.html 404.html sw.js manifest.webmanifest css/app.css js/maturity.js emails/invite.html; do \
      if [ ! -e "/srv/$good" ]; then echo "MISSING: /srv/$good"; exit 1; fi; \
    done; \
    echo "asset allowlist verified"

EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
