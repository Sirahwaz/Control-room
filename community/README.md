# MIDAD AI Community

A lightweight, open community demonstration and documentation site for MIDAD AI.

**This repository area is an isolated community package. It is not the MIDAD commercial platform, production control plane, or a live operational dashboard.**

## What is included

- A static, mobile-friendly demonstration page.
- Architecture and Linux-hosting documentation.
- Contributor and security-reporting guidance.
- Clearly labelled illustrative data only.

## What is intentionally excluded

This community package does not include or connect to payment processing, checkout, customer records, trading execution, wallet signing, mining accounts, private APIs, production databases, credentials, tokens, or internal automation endpoints. It makes no network requests and contains no production secrets.

## License scope

The Apache License 2.0 in this directory applies **only to the community package files in this directory and its subdirectories**. It does not grant a license to code or assets elsewhere in the parent repository, other MIDAD repositories, commercial services, trademarks, or third-party materials.

For the standalone community repository intended for external hosting, this directory will be extracted as the repository root, with its LICENSE file at the root.

## Run locally

From this directory:

```bash
python3 -m http.server 8080
```

Open `http://localhost:8080`.

No package installation, build step, API key, database, or runtime service is required.

## Status

The dashboard is a static illustration populated with synthetic sample labels. It does not represent live service health, active agents, production metrics, or revenue.
