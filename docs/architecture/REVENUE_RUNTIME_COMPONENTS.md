# Revenue Runtime Components

## Purpose

The revenue runtime discovers and qualifies opportunities, preserves evidence, and supports a controlled path from an offer to verified payment. Discovery is not authorization to contact a buyer, submit an application, create a payment intent, or move funds.

## Components

- **Paid Revenue Feed:** exposes normalized paid-revenue and receipt evidence for downstream reporting. It does not initiate payments or treat an unverified intent as revenue.
- **Fast Cash Radar:** scans configured structured sources, applies payout and escrow evidence gates, suppresses duplicates, and records qualified candidates. It fails closed when required source or payout evidence is unavailable.
- **Revenue Intelligence Research Worker:** processes queued public-source research requests and records research results. It does not submit applications, send customer messages, sign wallets, or settle payments.

## Safety boundaries

- Require evidence of the payout method, funding/escrow state, eligibility, and net value before a candidate can be promoted.
- Treat source outages, malformed payloads, missing payout proof, and ambiguous eligibility as blocked—not as permission to use stale data.
- Keep research and opportunity discovery separate from customer outreach and financial execution.
- Require explicit approval for customer-facing submissions, payment-intent creation, wallet signing, transfers, withdrawals, and settlement.
- Preserve provenance, timestamps, deduplication keys, and failure reasons for audit.

## Operations data boundary

Live job counts, account status, provider availability, project identifiers, wallet addresses, payment totals, and deployment versions are maintained in private operational records and are intentionally excluded from this public architecture note.
