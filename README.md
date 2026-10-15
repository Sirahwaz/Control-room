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

**[Open the MIDAD Revenue Store](https://sirahwaz.github.io/Control-room/revenue/?utm_source=github&utm_medium=repository&utm_campaign=first_payment_2026q4&lane=developer_services&ref=github_readme)** — select a service, describe the requirement, and receive a USDC invoice on the verified Base network. A created invoice is not treated as revenue; payment is counted only after an independently verified on-chain receipt.
