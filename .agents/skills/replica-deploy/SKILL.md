---
name: replica-deploy
description: >-
  Ships an app clone live on the user's own domain: a preflight gate (tests
  green, parity must-haves done, rebrand sweep clean, listing linted, legal
  pages up), production database and env vars, the host, DNS records for the
  domain and for email, Stripe live mode, OAuth redirects, monitoring, and
  mobile builds to TestFlight and Play. Use when the user says "deploy it",
  "ship it", "put it live", "connect my domain", "go to production",
  "publish the app", or after /replica-launch.
---

# replica-deploy

## MIDAD policy override (takes precedence over this generic template)

- MIDAD's current operating boundary forbids live financial actions. Never switch payment providers or accounts into live mode; never make a real purchase, issue a real refund, transfer or withdraw funds, perform wallet signing, sign a wallet transaction, or submit a live payment. Use mocks/test/sandbox only.
- Production deployment, store submission and external publication are separate gates. Do not perform them based only on this skill. Require a target-specific, verified release gate and explicit approval.
- Do not ask for passwords, private keys, recovery phrases, one-time codes or live API key values. Keep server secrets out of client builds and logs.


Reads everything in `replica/`. Writes `replica/deploy.md` (the checklist in
`preflight.md` in this folder, filled in).

## The rules

- **Nothing goes live without the user's go.** Show the preflight results and
  ask.
- **The user buys and signs in.** Claude never buys a domain, enters a card,
  types a password or pastes a live key. Claude writes the exact DNS records,
  env var names and commands; the user does the account steps.
- **Not until it is rebranded.** The sweep must be clean. No exceptions.

## Step 1: preflight

Run every check and paste the results into `deploy.md`:

```bash
npx playwright test                                                  # replica-test
python3 ../replica-diff/parity.py replica/features.csv               # must-haves done
python3 ../replica-brand/sweep.py . --config replica/brand.json      # exit 0: clean
python3 ../replica-launch/listing.py replica/launch/listing.json     # if shipping to stores
npm run build                                                        # production build passes
```

(Paths are relative to wherever the pack is installed. Under
`~/.claude/skills/` that is `~/.claude/skills/replica-diff/parity.py` and so
on.)

Plus by hand: no open S1 or S2 bugs, privacy policy and terms pages live
(listing every processor), cookie banner if you use non-essential cookies in
the EU or UK, account deletion works, the favicon, titles and OG image are
yours.

Any failure stops the deploy. Say which and why.

## Step 2: production services

- MIDAD override: this generic template does not authorize production financial activation.
- Keep payment providers and billing integrations in test/sandbox mode. No live purchase, refund, charge, wallet signing, transfer or withdrawal.
- Configure only the non-financial staging services needed for a verified release, using the user's own accounts and server-side secrets.
- OAuth and email provider configuration must use least-privilege scopes and test accounts until the relevant release gate is passed.

## Step 3: host and domain

Default: Vercel for Next.js (Netlify, Cloudflare Pages, Fly or Render
otherwise). Connect the repo so `main` deploys and pull requests get preview
URLs.

The domain, after the user buys it at any registrar:

| record | name | value |
| --- | --- | --- |
| A | @ | the host's apex IP (Vercel: shown in the domain settings) |
| CNAME | www | the host's target (Vercel: `cname.vercel-dns.com`) |
| TXT | @ or a subdomain | the host's verification value, if asked |

Email DNS from the email provider: SPF (TXT), DKIM (CNAME or TXT), and a
DMARC record starting at `v=DMARC1; p=none; rua=mailto:you@yourdomain` then
tightened to `quarantine` once reports are clean. Without these, your
confirmation emails go to spam.

Pick one canonical host (apex or www) and redirect the other. HTTPS is
automatic on the hosts above; check it.

## Step 4: watch it

Error tracking (Sentry or the host's), uptime checks on the home page and the
core flow's API, logs kept, analytics (a privacy-friendly one avoids the
cookie banner), and an alert to the user's email or phone. Then do the core
flow on the live site yourself, and ask the user to do it on their phone.

## Step 5: mobile, if there is an app

Expo: `eas build` then `eas submit` to TestFlight and Play internal testing.
Native: archive in Xcode, upload to App Store Connect; Gradle bundle to Play
Console. The user owns the developer accounts ($99 a year for Apple, $25 once
for Google). Beta first, then review with the listing from replica-launch.

## Output

`replica/deploy.md` with every check and its result, the live URL, the DNS
records set, and what to watch in the first week. The clone is now an app
with your name on it.
