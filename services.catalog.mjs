export const SERVICES = [
  {
    id: "payment-path-mini-v1",
    requiresSourceMaterial: false,
    nameEn: "Single-Path Checkout Diagnostic",
    priceUsd: 5,
    descriptionAr: "تشخيص مسار واحد للدفع أو الويب هوك أو مطابقة الدفعة، مع نتائج مكتوبة وخطوات إعادة اختبار قابلة للتكرار.",
    descriptionEn: "One public checkout/payment/webhook/reconciliation path review with written findings and a reproducible retest checklist."
  },
  {
    id: "miner-microscope-v1",
    requiresSourceMaterial: true,
    nameEn: "Miner Microscope Audit",
    priceUsd: 39,
    descriptionAr: "فحص تشغيلي لوحدات التعدين، مع أدلة على الشذوذ وقائمة تحقق للاستعادة.",
    descriptionEn: "Worker-by-worker mining diagnostic snapshot with anomaly evidence and recovery checklist."
  },
  {
    id: "opportunity-radar-v1",
    requiresSourceMaterial: false,
    nameEn: "Opportunity Radar Pack",
    priceUsd: 25,
    descriptionAr: "قائمة فرص حديثة مع أدلة المصدر، العوائق، ومسودة بداية للتقديم.",
    descriptionEn: "Fresh paid-opportunity shortlist with evidence, blockers and proposal starter."
  },
  {
    id: "research-revenue-sprint-v1",
    requiresSourceMaterial: false,
    nameEn: "Research-to-Revenue Sprint",
    priceUsd: 79,
    descriptionAr: "بحث موثّق بالمصادر، كشف التناقضات، فرضيات قابلة للاختبار وخطة عمل.",
    descriptionEn: "Source-backed findings, contradictions, testable hypotheses and action blueprint."
  },
  {
    id: "bug-fix-sprint-v1",
    requiresSourceMaterial: true,
    nameEn: "Bug Fix Sprint",
    priceUsd: 54,
    descriptionAr: "إصلاح عطل واحد قابل لإعادة الإنتاج في Python أو TypeScript مع اختبارات.",
    descriptionEn: "One reproducible Python or TypeScript bug fixed with tests."
  },
  {
    id: "data-rescue-pack-v1",
    requiresSourceMaterial: true,
    nameEn: "Data Rescue Pack",
    priceUsd: 34,
    descriptionAr: "تنظيف ملف CSV أو JSON واحد أو تحويله أو التحقق منه باختبارات.",
    descriptionEn: "One CSV or JSON file cleaned, converted or validated with tests."
  },
  {
    id: "decision-research-brief-v1",
    requiresSourceMaterial: false,
    nameEn: "Decision Research Brief",
    priceUsd: 44,
    descriptionAr: "بحث مركز بمصادر وروابط واستنتاج تنفيذي يساعد على اتخاذ القرار.",
    descriptionEn: "Focused source-cited research with a decision summary."
  },
  {
    id: "code-health-review-v1",
    requiresSourceMaterial: true,
    nameEn: "Code Health Review",
    priceUsd: 74,
    descriptionAr: "مراجعة عيوب وأمن وأداء في Python أو JavaScript، مع نتائج قابلة للتحقق.",
    descriptionEn: "Python/JavaScript bug, security and performance review."
  }
];

const SOURCE_MATERIAL_MARKER = /(?:error|stack trace|log|csv|json|source code|function\b|const\b|import\b|metrics|hashrate|worker|column|rows|data sample)/i;

export function isServiceInputReady(service, value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!service) return false;
  if (!service.requiresSourceMaterial) return true;
  return text.length >= 60 && SOURCE_MATERIAL_MARKER.test(text);
}
