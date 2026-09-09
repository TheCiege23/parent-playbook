# playbookbp.com — DNS cutover runbook

**Registrar:** GoDaddy · **Target DNS:** Cloudflare · **Host:** Railway (project `ParentPlaybook`, service `parent-playbook`)

Verified state as of 2026-09-08. Every value below was read from the Railway API or from live DNS, not inferred.

---

## STATUS — cutover is done, app is live on the new domain

Completed and verified 2026-09-08:

- ✅ `playbook.chimaura.com` restored, re-pointed to `yygz44bo.up.railway.app`, cert valid
- ✅ Zone moved to Cloudflare (`abdullah.ns.cloudflare.com` / `jessica.ns.cloudflare.com`)
- ✅ **All M365 mail records imported intact** — MX, SPF, DMARC, both DKIM selectors,
  autodiscover/sip/lyncdiscover/msoid, email, pay, both SRVs. Verified byte-identical to the
  old GoDaddy zone.
- ✅ `playbookbp.com` and `www.playbookbp.com` both serving the app, HTTP 200, proxied
- ✅ Railway certificates **VALID** for both new domains

Sections §1–§3 below are therefore historical reference. **§4 is still outstanding** — those are
the items that still break things if skipped. See also "Remaining" at the bottom.

---

## 0. Fix first — `playbook.chimaura.com` is down

`playbook.chimaura.com` was detached from the Railway service during setup. DNS still points at
Railway (`3bdbfsz3.up.railway.app`), but Railway no longer holds a certificate for that hostname, so
the host now fails TLS outright:

```
curl: (60) schannel: SNI or certificate check failed: SEC_E_WRONG_PRINCIPAL
```

It returned `200` earlier the same session, so this is a regression, not a pre-existing condition.

**Impact:** every coach invite link carrying a team code, every password-reset email already in an
inbox, and every parent bookmark points at this host. All of them are dead until it is re-attached.

**Fix:** in the Railway dashboard → `parent-playbook` → Settings → Networking → Custom Domain, add
`playbook.chimaura.com` back with target port **8080**. Its DNS record already exists and is
correct, so it should verify immediately.

Do **not** remove it again. The Caddyfile serves a permanent redirect from it on purpose:

```
@moved host playbook.chimaura.com www.playbookbp.com
handle @moved { redir https://playbookbp.com{uri} permanent }
```

That redirect is the only thing keeping the links already in inboxes working. It needs the hostname
attached to Railway to ever receive the request.

---

## 1. The hazard: this domain already runs live email

`playbookbp.com` is not a parked domain. It has **Microsoft 365 email already configured through
GoDaddy** (tenant `NETORGFT21109080`). Moving the nameservers to Cloudflare without recreating these
records first will silently break mail — including `support@playbookbp.com`, which the privacy
policy, terms, data-deletion page, coaches page, organizations page, and several in-app error
strings all now name as the contact address.

Cloudflare's scan usually imports most of these automatically when you add the zone. **Verify each
one by hand against this table before flipping the nameservers** — the scan misses records that
aren't publicly enumerable, and a missed MX is silent data loss, not an error page.

### Records that must exist in Cloudflare before the nameserver change

All of these are mail/service records — leave every one of them **DNS only (grey cloud)**.

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
| CNAME | `email`                  | `email.secureserver.net`  *(GoDaddy email marketing — drop only if unused)*         |
| CNAME | `pay`                    | `paylinks.commerce.godaddy.com`  *(GoDaddy Pay Links — drop only if unused)*        |
| SRV   | `_sipfederationtls._tcp` | priority 100, weight 1, port 5061, target `sipfed.online.lync.com`                 |
| SRV   | `_sip._tls`              | priority 100, weight 1, port 443, target `sipdir.online.lync.com`                  |

`_domainconnect` → `_domainconnect.gd.domaincontrol.com` exists today but is GoDaddy's own
provisioning hook. It has no meaning once the zone leaves GoDaddy — don't recreate it.

### Records to drop

The apex currently resolves to `76.223.105.230` / `13.248.243.5` (GoDaddy parking), and `www` is a
CNAME to the apex. Both are replaced in step 3 — do not carry them over.

---

## 2. Move the zone

1. Cloudflare → Add a site → `playbookbp.com` → Free plan. Let it scan.
2. Reconcile the imported records against the table in §1. Add anything missing.
3. Cloudflare gives you two nameservers (e.g. `xxx.ns.cloudflare.com`).
4. GoDaddy → Domain Settings → Nameservers → Change → "I'll use my own nameservers" → enter both.

Propagation is typically under an hour, occasionally up to 24. Mail keeps flowing throughout **if
and only if** §1 was done correctly, because the old and new zones serve identical answers.

---

## 3. Point the web records at Railway

Both custom domains are already attached to the Railway service and verified. These are the exact
targets Railway assigned — each custom domain gets its own, they are not interchangeable:

| Type  | Name  | Value                      | Proxy       |
|-------|-------|----------------------------|-------------|
| CNAME | `@`   | `pkh4udaj.up.railway.app`  | DNS only    |
| CNAME | `www` | `a8wbweyg.up.railway.app`  | DNS only    |

The apex CNAME is legal here because Cloudflare flattens it automatically — this is the main reason
Cloudflare is the right choice over GoDaddy's DNS, which can't do apex CNAMEs at all.

If Railway's dashboard also shows a `_railway-verify.www` TXT record, add it with the **full** value
copied from Railway. (The value is truncated in the dashboard's summary view — click through for the
whole string.)

### On the Cloudflare proxy (orange cloud)

Leave both records **grey (DNS only)** until Railway reports the certificate as issued for each
domain. Railway validates ownership over the live connection; proxying before that can stall it.

Current certificate state:
- `www.playbookbp.com` — **VALID**
- `playbookbp.com` — **VALIDATING_OWNERSHIP** (completes once the apex CNAME resolves)

Once both read valid, you may switch the proxy on. If you do, set Cloudflare **SSL/TLS → Full
(strict)** first. Do **not** use **Flexible**: Cloudflare would talk plain HTTP to Railway while
Railway's edge redirects to HTTPS, producing an infinite redirect loop. Turn on **Always Use HTTPS**
either way.

Railway's dashboard also offers a "One-click DNS Setup / Connect Cloudflare" button. It only works
once the zone is already on Cloudflare, so it's an alternative to this step — not a replacement for
§1 or §2.

---

## 4. Loose ends that break things if skipped

**Resend sending domain does not exist yet.** `send.playbookbp.com` has no DNS and is not registered
in Resend — the account has `send.chimaura.com` (verified) but nothing for the new domain. The
staged code in `supabase/functions/send-invite/index.ts` now defaults to:

```
'Parent Playbook <hello@send.playbookbp.com>'
```

Deploying that before the domain is verified in Resend means Resend rejects every invite send.
Either create and verify `send.playbookbp.com` in Resend (add its DKIM/SPF records to Cloudflare) —
or set the `INVITE_FROM` env var to keep using `send.chimaura.com` until you do.

**Supabase auth URLs.** Site URL and the redirect allowlist still need `https://playbookbp.com`
added. Keep the old origin in the allowlist during the redirect window, or password-reset and
confirmation links already in inboxes will fail validation. (Dashboard → Authentication → URL
Configuration.)

**`SITE_URL` env var** on the Supabase Edge Functions — the staged defaults are correct now, but if
`SITE_URL` is set explicitly it still says `playbook.chimaura.com` and overrides them.

**The rename is staged but uncommitted.** 27 files in the working tree carry the domain change
(HTML, JS, Caddyfile, edge functions, sitemap, llms.txt). None of it is live until committed and
deployed. Note that `js/core.js` in the same working tree also carries unrelated premium/paywall
work — worth separating before committing.

---

## Verification

```bash
# after nameserver change
nslookup -type=NS playbookbp.com
nslookup -type=MX playbookbp.com          # must still be outlook.com

# after web records land
curl -sI https://playbookbp.com/ | head -1
curl -sI https://www.playbookbp.com/ | head -1        # expect 301 -> playbookbp.com
curl -sI https://playbook.chimaura.com/ | head -1     # expect 301 -> playbookbp.com
```

Send a test message to `support@playbookbp.com` from an outside address once the zone has moved.

---

## Remaining — in order

1. **Cloudflare SSL/TLS mode.** Confirm it reads **Full (strict)**, not Flexible. Both Railway certs
   are valid, so strict will work. Turn on **Always Use HTTPS** while you're there.
2. **Send a test email to `support@playbookbp.com`** from an outside address. DNS says it will work;
   confirm it actually does before relying on it.
3. **Supabase auth URLs** — add `https://playbookbp.com` as Site URL, keep the chimaura origin in
   the redirect allowlist so links already in inboxes still validate.
4. **Resend** — either verify `send.playbookbp.com`, or set `INVITE_FROM` to hold on
   `send.chimaura.com`. Do this *before* step 5.
5. **Commit and deploy the rename.** Only after 3 and 4. This is what activates the
   `www` → apex and `chimaura` → `playbookbp` redirects. Until then both hosts serve the app
   directly, which is harmless but means two live copies and a stale canonical tag.
   Separate the unrelated `js/core.js` premium work out first.
