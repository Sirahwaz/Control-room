# MIDAD Control Room

واجهة ويب خفيفة لغرفة التحكم في MIDAD، قابلة للنشر عبر GitHub Pages ولفتحها داخل Telegram Mini App.

## البنية
- `index.html` — الواجهة.
- `styles.css` — التصميم المتجاوب.
- `app.js` — طبقة الاتصال القابلة للربط مع n8n.

## الأمان
لا تضع مفاتيح Supabase service-role أو مفاتيح n8n السرية داخل ملفات GitHub Pages. الواجهة العامة يجب أن تتصل بواجهة خلفية آمنة، وتتحقق الخادم من Telegram initData قبل تنفيذ الأوامر.

## النشر
GitHub Pages → Deploy from a branch → `main` → `/(root)`.

بعد النشر، اربط رابط الصفحة كـ Web App في بوت Telegram، ثم نربط طبقة الخلفية بـ n8n/Supabase.
