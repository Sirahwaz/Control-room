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
