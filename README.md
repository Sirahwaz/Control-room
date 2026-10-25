# MIDAD Control Room

## Control Room v2
واجهة القيادة الرئيسية لـ MIDAD، Mobile-first وTelegram Mini App.

### ملكية المحطات
- @ahwazai_bot: Operations / Services / Revenue
- @aimidad_bot: Neural / Research / OSINT
- @midadkeys_bot: Identity / Secrets / Capabilities
- @viabtc_monitor: Mining / Capital / Withdrawals
- @iAiTrader_bot: Trading / Risk / Paper / Market Radar

### iAiTrader
iAiTrader محطة تداول مستقلة مرتبطة بـ MIDAD Core.
- Telegram Bot runtime: midad_iaitrader_bot
- Mini App: iaitrader.html
- Station API: midad_iaitrader_station
- Shared engine: midad_noncopy_trading_engine
- Trading Governor: iAiTrader Governor
- Default mode: paper
- Live execution: blocked
- Human approval: required for high-impact actions
- No copy-trading

### Control Room
Control Room يحتفظ بالحالة والسياق والانتقال إلى المحطات؛ لا يعيد بناء Mining أو Trading داخله.

### الأمان
Bot tokens والأسرار تحفظ في Supabase Secrets ولا تدخل GitHub Pages.
الأوامر المالية الحساسة تبقى خلف Policy + Human Approval.

## Hire MIDAD AI — Fixed-scope technical services

MIDAD AI accepts scoped work for Python/TypeScript bug fixes, API and automation debugging, CSV/JSON data cleanup, code-health reviews, and source-backed technical research.

**[Open the $5 USDC checkout — Single-Path Checkout Diagnostic](https://sirahwaz.github.io/Control-room/revenue/?product=payment-path-mini-v1&lang=ar&utm_source=github&utm_medium=repository&utm_campaign=first_payment_2026q4&lane=developer_services&ref=github_readme)** — this link opens the selected service form directly; the buyer reviews the scope, submits requirements, and receives an exact USDC invoice on the verified Base network. No invoice is created until the buyer submits the form, and revenue is counted only after an independently verified on-chain receipt.

## MIDAD Revenue Intelligence Feed (x402)

MIDAD also exposes a read-only machine-to-machine opportunity feed for agents and automation services. The feed distinguishes evidence-backed task funding from unverified payout claims, and labels upfront bonds, fees, deadlines and other blockers; a listing is not a promise of earnings.

- **Price:** 0.01 USDC per data request
- **Network:** Base mainnet (`eip155:8453`)
- **Protocol:** x402 v2; clients pay per request, without creating a MIDAD user account
- **Paid feed:** https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_paid_revenue_feed/api/opportunities
- **Health:** https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_paid_revenue_feed/health
- **Machine-readable payment manifest:** https://froegigfmpmvtecztfbf.supabase.co/functions/v1/midad_paid_revenue_feed/.well-known/x402

The health and payment manifest are public. The opportunity data route requires a valid x402 payment. The feed contains cached public opportunity metadata only; it does not expose private messages, customer records, credentials or wallet-signing requests. It is an early product: **no paid requests or sales are confirmed yet**, and no income is counted until a payment receipt is independently verified.


