# playbookbp.com — domain migration

**Status: complete, 2026-09-08.** `playbookbp.com` is the canonical origin and is live.

**Registrar:** GoDaddy · **DNS:** Cloudflare · **Host:** Railway (`ParentPlaybook` / `parent-playbook`)
· **Backend:** Supabase `xqvqjkdxykowwpcmyudz`

Every value here was read from a live API or a DNS query, not inferred. This is now a reference
record rather than a set of instructions — the step-by-step has been removed because it has been
carried out. What remains is the configuration as it stands, what went wrong on the way, and the
one piece of work still deliberately open.

---

## How it is wired

| | |
|---|---|
| Nameservers | `abdullah.ns.cloudflare.com` · `jessica.ns.cloudflare.com` |
| Apex `playbookbp.com` | CNAME → `pkh4udaj.up.railway.app` (Cloudflare flattens it) |
| `www.playbookbp.com` | CNAME → `a8wbweyg.up.railway.app` → 301 to apex |
| `playbook.chimaura.com` | CNAME → `yygz44bo.up.railway.app` → 301 to apex |
| Cloudflare SSL/TLS | **Full (strict)** + Always Use HTTPS |
| Cloudflare Browser Cache TTL | **Respect Existing Headers** — see the gotcha below |
| Mail | Microsoft 365 via GoDaddy, tenant `NETORGFT21109080` |
| Outbound mail | Resend, `send.playbookbp.com`, verified |

Railway certificates are valid for all three hostnames. Each custom domain gets its **own** CNAME
target — they are not interchangeable, and deleting and re-adding a domain issues a new one.

### The redirect

`playbook.chimaura.com` and `www` both 301 to the apex, path and query preserved, from the
Caddyfile:

```
@moved host playbook.chimaura.com www.playbookbp.com
handle @moved { redir https://playbookbp.com{uri} permanent }
```

It is a `handle` block rather than a bare `redir` on purpose: handle blocks run in source order, so
the redirect wins before `try_files` can rewrite `/privacy` into a redirect to `/privacy.html`. The
Railway-generated `*.up.railway.app` host is deliberately unmatched so health checks are never
answered with a 301.

---

## DNS inventory

Kept because it is the rollback reference, and because a missed mail record is silent data loss
rather than an error page. All of these are **DNS only (grey cloud)**.

### Microsoft 365 — moved intact from GoDaddy

| Type  | Name                     | Value                                                                            |
|-------|--------------------------|----------------------------------------------------------------------------------|
| MX    | `@`                      | `playbookbp-com.mail.protection.outlook.com` (priority **0**)                      |
| TXT   | `@`                      | `NETORGFT21109080.onmicrosoft.com`                                                 |
| TXT   | `@`                      | `v=spf1 include:secureserver.net -all`                                             |
| TXT   | `_dmarc`                 | `v=DMARC1; p=quarantine; adkim=r; aspf=r; rua=mailto:dmarc_rua@onsecureserver.net;` |
| CNAME | `selector1._domainkey`   | `selector1-playbookbp-com._domainkey.netorgft21109080.y-v1.dkim.mail.microsoft`     |
| CNAME | `selector2._domainkey`   | `selector2-playbookbp-com._domainkey.netorgft21109080.y-v1.dkim.mail.microsoft`     |
| CNAME | `autodiscover`           | `autodiscover.outlook.com`                                                         |
| CNAME | `sip`                    | `sipdir.online.lync.com`                                                           |
| CNAME | `lyncdiscover`           | `webdir.online.lync.com`                                                           |
| CNAME | `msoid`                  | `clientconfig.microsoftonline-p.net`                                               |
| CNAME | `email`                  | `email.secureserver.net`  *(GoDaddy email marketing)*                              |
| CNAME | `pay`                    | `paylinks.commerce.godaddy.com`  *(GoDaddy Pay Links)*                             |
| SRV   | `_sipfederationtls._tcp` | priority 100, weight 1, port 5061, target `sipfed.online.lync.com`                 |
| SRV   | `_sip._tls`              | priority 100, weight 1, port 443, target `sipdir.online.lync.com`                  |

Cloudflare's import scan carried all of these across correctly; each was verified byte-identical to
the old GoDaddy zone, and a real test message reached `support@playbookbp.com` afterwards.

`_domainconnect` was GoDaddy's own provisioning hook and was deliberately not recreated.

### Resend — outbound mail for invites

| Type  | Name                     | Value                                                    |
|-------|--------------------------|----------------------------------------------------------|
| TXT   | `resend._domainkey.send` | the DKIM public key (218 chars)                          |
| MX    | `send.send`              | `feedback-smtp.us-east-1.amazonses.com` (priority 10)    |
| TXT   | `send.send`              | `v=spf1 include:amazonses.com ~all`                      |

`send.send` looks wrong but is not — it is the bounce/return-path host `send.send.playbookbp.com`.
Everything sits under `send.`, so the apex MX and apex SPF that `support@playbookbp.com` depends on
are untouched. A second SPF record at the apex *would* have broken mail; this is not that.

---

## Three things that went wrong

Recorded because none of them would be obvious the second time either.

### `playbook.chimaura.com` went down mid-migration

The domain was detached from the Railway service while the new domains were being added. DNS still
pointed at Railway, but Railway no longer held a certificate for the hostname, so it failed TLS
outright — `SEC_E_WRONG_PRINCIPAL`. Every coach invite link, password-reset email and bookmark
already in circulation was dead until it was re-attached.

Root cause was reaching for Railway's open-ended agent to do something its API could not do: it
wrote custom domains into `networking.serviceDomains` (the generated-subdomain collection), which
allocated two junk `*.up.railway.app` hosts and pushed whole-collection patches while the dashboard
was being edited in parallel. **Custom domains are a dashboard operation.** Re-adding also issued a
new CNAME target, so `chimaura.com`'s DNS had to be updated to match.

### Cloudflare silently overrode the origin cache headers

Cloudflare's default **Browser Cache TTL of 4 hours** rewrites `Cache-Control` on the way out
regardless of what the origin sends. Immediately after cutover, `sw.js`, `js/*` and `css/*` were all
being served as `max-age=14400` even though Caddy correctly sent `max-age=0, must-revalidate`.

That quietly undoes the policy the Caddyfile sets on purpose — a cached `sw.js` is how an installed
phone keeps running last week's app. It produces no error; deploys just roll out unevenly over the
following four hours. Fixed by setting Browser Cache TTL to **Respect Existing Headers**. If this
project ever wants long cache lifetimes for fingerprinted assets, set them at the origin, not by
letting Cloudflare override everything including the service worker.

### A Railway deploy failed on infrastructure, not code

Commit `412abe4` failed at `CREATE_CONTAINER` with *"the registry could not be reached to pull the
image"*. All build stages had succeeded. Railway keeps the previous container serving when a new
deployment fails to start, so there was no user impact, and a retry succeeded. Worth recognising the
signature: build green, deploy logs empty, failure isolated to container creation.

---

## Still open — retire `playbook.chimaura.com`, on purpose

The old host must keep working while invite links, password-reset emails and bookmarks carrying it
are still in circulation. Revisit when traffic to it approaches zero, and then do all four together:

1. Remove the `playbook` CNAME from `chimaura.com`'s DNS (GoDaddy)
2. Remove `playbook.chimaura.com` as a custom domain on the Railway service
3. Remove `https://playbook.chimaura.com/**` from the Supabase redirect allowlist
4. Drop the `@moved` host from the Caddyfile

Doing any one of these early breaks links that are still live. Step 3 in particular is what keeps
reset links already sitting in inboxes validating until they expire.

---

## Verification

```bash
# redirects, with path and query preserved
curl -sI https://playbookbp.com/ | head -1                        # 200
curl -sI https://www.playbookbp.com/ | head -1                    # 301 -> apex
curl -sI "https://playbook.chimaura.com/?team=BEARS26" | head -1  # 301, query kept

# clean URLs must be 200, NOT a redirect to .html
for p in /privacy /terms /datadeletion /coaches /organizations; do
  curl -sI "https://playbookbp.com$p" | head -1
done

# mail must keep answering from Microsoft
nslookup -type=MX playbookbp.com 8.8.8.8

# cache headers must match the origin, not Cloudflare's default
curl -sI https://playbookbp.com/sw.js | grep -i cache-control     # max-age=0
curl -sI https://parent-playbook-production.up.railway.app/sw.js | grep -i cache-control
```

---

## Related work done alongside this

The migration surfaced two gaps that had nothing to do with DNS but were worse than it:

- **69 Supabase migrations** existed only as untracked files inside a disposable worktree — the
  entire schema history, including every RLS policy protecting children's data. Committed in
  `c644878`.
- **9 of 15 deployed Edge Functions had no source in git**, including all four that handle money.
  Pulled from the live deployment and committed in `df4979e`.

Both are now in the repo, and all 14 remaining functions were redeployed from it so source and
production match. That guarantee only holds if functions continue to be deployed *from* the repo —
if they are edited in the Supabase dashboard, these files drift silently, and a stale file that
looks authoritative is worse than a missing one.

```bash
npx supabase functions deploy <name> --project-ref xqvqjkdxykowwpcmyudz
```

### Commits

```
412abe4  Remove migrate-bg from the repo now that it is deleted from production
f6776b7  Point the six stale domain fallbacks at playbookbp.com
df4979e  Track the nine deployed Edge Functions that had no source in git
f8f5a34  Merge premium-paywall: billing and free-tier caps, flag off
c644878  Track the Supabase migration history in the repo
b717ef8  Record domain migration outcome and the Cloudflare cache-header gotcha
0bc5237  Move canonical domain to playbookbp.com
```
