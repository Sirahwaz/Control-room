# MIDAD FIX — مصدر المتابعة

تاريخ الأساس: 2026-10-11. هذا المسار إصلاح إضافي فوق النسخة الحالية، وليس إعادة بناء.
- المستودع: https://github.com/Sirahwaz/Control-room
- فرع الإصلاح: `midad-fix/2026-10-11-control-room`
- قاعدة البيانات: Supabase project `froegigfmpmvtecztfbf`
- واجهة الإنتاج الحالية: https://sirahwaz.github.io/Control-room/
- الملفات الأساسية في هذا الإصلاح: `index.html`, `midad-fix-v1.css`, `midad-fix-v1.js`, `service-worker.js`, وWorkflow تحقق مخصص.
- ما يصلحه: قابلية القراءة على الهاتف، safe-area، أزرار التنقل والـactive state، إخفاء/استرجاع لوحة LIVE OPS القديمة على الهاتف، رفع زر Human Bridge فوق التنقل السفلي، إبطال cache قديم عبر نسخة Service Worker جديدة، وفحوص syntax/contract مخصصة.
- ما لا يدعي إصلاحه: لم نثبت بعد كل تكامل خارجي من طرف إلى طرف، ولا توجد حتى الآن أدلة مؤكدة على استلام دفعة وربطها بتسوية مالية. حالة الدفع تبقى `PENDING_NOT_VERIFIED`.
- لا تنفذ DDL أو تغييرات RLS/Keys على الإنتاج دون تدقيق جدول-بجدول، ولا تفتح تداولاً حياً أو مدفوعات دون موافقة بشرية صريحة.
- التسلسل: AUDIT → PRESERVE → REPAIR → CI → DEPLOY → LIVE TEST → INCOME PIPELINE → DELIVERY → PAYMENT RECEIPT → RECONCILIATION → LEARNING.
- راجع PR-56 الخاص بـAccount/Profile Factory قبل إعادة أي عمل فيه: https://github.com/Sirahwaz/Control-room/pull/56
- بعد النشر، افحص سجل GitHub Actions وGitHub Pages، ثم جرّب واجهة الهاتف وTelegram Mini App. لا تعتبر build ناجحاً دليلاً على أن الدفع وصل.
