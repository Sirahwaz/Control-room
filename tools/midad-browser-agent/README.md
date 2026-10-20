# MIDAD Free Browser Research Agent (v1)

A no-API-key public-web research runner designed to replace the **public evidence collection** part of paid browser agents. It runs on a standard GitHub Actions runner for this public repository; no TinyFish credits, Supabase writes, browser profiles, passwords, cookies, wallet access, or paid LLM API are required.

## What it does

- Opens up to 25 explicitly configured **public HTTPS pages** in Chromium.
- Enforces a per-target hostname allowlist and re-checks DNS addresses to reject non-public destinations.
- Uses bounded navigation timeouts, up to three browser attempts, and a standard-library HTTP fallback.
- Saves visible text, SHA-256 content hashes, HTTP status, final URL, timestamps, JSON evidence records, and a screenshot when Chromium succeeds.
- Uploads run output as a GitHub Actions artifact for later inspection.

## What it intentionally does not do

No login, credential or cookie import, clicking buttons, submitting forms, applying to jobs, posting content, financial operations, wallet signing, or transaction submission. It is a read-only public-page evidence collector—not a claim that a reward is payable. Page text is untrusted evidence and requires review before an opportunity can be marked eligible or paid.

The runner blocks URLs that are not HTTPS, contain embedded credentials, use non-default ports, resolve to non-public addresses, or go outside the explicit host allowlist. Public websites may rate-limit or block automated requests; failures are recorded rather than bypassed.

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

Only enter domains you intend to inspect in `allowed_hosts`. Each allowed host is resolved and checked before use. Avoid private sites and pages containing personal or sensitive data.

## Output

The generated `output/` directory contains:
- `report.json`: run summary and per-target status;
- `evidence/*.json`: provenance, fetch method, status, timestamps and content hashes;
- `text/*.txt`: extracted visible text;
- `screenshots/*.png`: viewport capture when Chromium is available.

The agent does not mutate MIDAD/Supabase records. A later integration must preserve evidence, provenance, duplicate protection, and the existing READY_FOR_REVIEW gate.
