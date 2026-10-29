# MIDAD Public Target Probe

This is a small, independently runnable Playwright capability for diagnosing **public HTTPS pages** without TinyFish. It is separate from the Supabase job worker and does not need Supabase credentials, cookies, browser profiles, or a user session.

## Run locally

Python 3.11+:
```sh
python -m pip install -r tools/midad-browser-runtime/requirements.txt
python -m playwright install chromium
cd tools/midad-browser-runtime
python -m unittest -v test_runner.py test_public_target_probe.py
python public_target_probe.py --url https://example.com/ --allowed-host example.com
```

For a new target, use its exact hostname in `--allowed-host`; do not use wildcards. The target must be HTTPS on the default port, contain no embedded credentials, resolve only to public IP addresses, and remain within the exact hostname allowlist on every browser request. The probe uses GET/HEAD only, blocks non-allowlisted redirects and subresources, limits navigation time to 1–20 seconds, disables downloads and service workers, and emits metadata plus a SHA-256 of bounded visible text—not the page text itself.

## Run in GitHub Actions

Open **Actions → MIDAD Browser Mesh — Public Target Probe → Run workflow**. Supply the target URL and exact hostname separately. The workflow installs Chromium, runs offline policy tests, and probes the page. It does not create a Supabase job or write to the evidence ledger.

## Boundaries

- Public, read-only inspection only; no login, cookies, CAPTCHA/MFA bypass, stealth/evasion, form submissions, downloads, wallet operations, payments, or authenticated/private targets.
- This tests outbound HTTPS navigation from the GitHub-hosted runner, not TCP reachability to arbitrary ports and not the Wispbyte server's process state.
- A successful page probe proves only that the specified public page was reachable from that runner at that time. It does not prove the MIDAD production application or Supabase queue is deployed.
- A workflow run must be triggered and its result inspected before claiming the target passed.
