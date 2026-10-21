# MIDAD Free Browser Research Agent (v1)

A free, public-source evidence collector intended to replace the **public evidence collection** portion of paid browser agents. It runs on a standard GitHub Actions runner; no TinyFish credits, paid API, Supabase writes, cookies, credentials, or account sessions are needed.

## What it does

- Uses standard-library HTTPS GET requests to inspect up to 25 explicitly configured public pages.
- Rejects credentials in the URL, non-HTTPS URLs, non-default ports, non-public IP addresses, and hostnames outside each target's explicit allowlist.
- Validates **every redirect hop before following it** and allows outbound GET/HEAD only. No browser navigates to a remote page, so scripts cannot trigger POSTs, beacons, auto-submitted forms, or other state-changing requests.
- Retries failed fetches up to three times with bounded backoff.
- Extracts visible text, stores HTTP status, final URL, timestamp and SHA-256 content hash, and saves JSON evidence records.
- Uses Chromium only to render an escaped, local text-evidence report screenshot; the local rendering blocks all network requests. It is **not** a screenshot of the original website.
- Keeps a conservative source allowlist per target. Public pages can rate-limit or change; failures are recorded, not bypassed.

## What it intentionally does not do

No login, cookie import, account access, clicking buttons, downloading files, form submission, external job applications, submissions, payments, wallet signing or financial actions. A captured page is untrusted evidence, not proof that a bounty is payable or an applicant is eligible. Human review is required before changing any opportunity's eligibility or payout gate.

## Provider-neutral action policy (v1 foundation)

`action_policy.py` defines a fail-closed decision contract intended to sit in front of future browser providers:

- Public read actions require HTTPS and an exact, non-wildcard hostname allowlist.
- Click/fill/upload/download actions require explicit task/action approval.
- Session-dependent work requires a confirmed, authorized site session.
- Form submission, publication, applications and outbound messages require explicit per-task approval.
- Signing, transfers and withdrawals remain blocked by default and require both a separate financial gate and explicit operation approval.
- CAPTCHA, MFA, human-verification bypass and bot-evasion actions are always blocked.

**Important limitation:** the policy module is a decision layer, not a sandbox or browser runtime. It is not yet wired into the read-only collector or the Supabase browser gateway. The existing collector remains read-only. A future runtime must enforce this policy before every browser action, restrict redirects and network methods independently, isolate sessions, and record evidence. Passing a policy decision alone does not prove that an action was executed safely or completed.

## Run locally

Python 3.11+ recommended:

```bash
python -m pip install playwright
python -m playwright install chromium
python tools/midad-browser-agent/agent.py
python -m unittest discover -s tools/midad-browser-agent -p 'test_*.py' -v
```

For a one-off capture:

```bash
python tools/midad-browser-agent/agent.py --urls-json '[{"url":"https://immunefi.com/bug-bounty/","label":"Immunefi public catalogue","purpose":"Inspect currently listed public bounty programs","allowed_hosts":["immunefi.com"]}]'
```

Only provide hostname allowlists that you actually intend to inspect. Do not use private services, personal pages, pages containing sensitive user data, or signed/tokenized URLs.

## Outputs

- `output/report.json`: run summary and per-target result status;
- `output/evidence/*.json`: source metadata, fetch provenance, timestamp and hash;
- `output/text/*.txt`: extracted visible text;
- `output/screenshots/*.png`: screenshot of the **local text-evidence report** when Chromium works.

The collector does not change MIDAD/Supabase records. Any later integration must preserve source provenance, evidence hashes, deadline and payment gates, duplicate protection, and the existing `READY_FOR_REVIEW` threshold.
