export const MAX_APK_BYTES = 256 * 1024 * 1024;

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function inspectApkFile(file, cryptoApi = globalThis.crypto) {
  if (!file || typeof file !== "object") {
    throw failure("APK_FILE_REQUIRED", "اختر ملف APK أولاً.");
  }
  if (typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".apk")) {
    throw failure("APK_EXTENSION_INVALID", "يجب اختيار ملف بامتداد .apk.");
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw failure("APK_FILE_UNREADABLE", "حجم الملف غير صالح أو الملف فارغ.");
  }
  if (file.size > MAX_APK_BYTES) {
    throw failure("APK_SIZE_LIMIT_EXCEEDED", "حجم الملف يتجاوز الحد المحلي البالغ 256 MiB.");
  }
  if (typeof file.slice !== "function") {
    throw failure("APK_FILE_UNREADABLE", "تعذر قراءة الملف المحدد.");
  }

  let header;
  let contents;
  try {
    header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    if (header.length !== 4) {
      throw new Error("short header");
    }
    if (header[0] !== 0x50 || header[1] !== 0x4b || header[2] !== 0x03 || header[3] !== 0x04) {
      throw failure("APK_CONTAINER_INVALID", "الملف لا يحمل توقيع ZIP متوقعاً لملف APK.");
    }
    contents = await file.arrayBuffer();
  } catch (error) {
    if (error?.code) throw error;
    throw failure("APK_FILE_UNREADABLE", "تعذرت قراءة محتوى ملف APK.");
  }

  if (!cryptoApi?.subtle?.digest) {
    throw failure("CRYPTO_UNAVAILABLE", "ميزة SHA-256 غير متاحة في بيئة التشغيل الحالية.");
  }

  const digest = await cryptoApi.subtle.digest("SHA-256", contents);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const evidenceId = cryptoApi.randomUUID?.() || `apk-${Date.now()}-${sha256.slice(0, 12)}`;

  return Object.freeze({
    schema: "midad.android-evidence/v1",
    evidenceId,
    status: "VERIFIED",
    sourceKind: "APK",
    fileName: file.name,
    sizeBytes: file.size,
    sha256,
    analysisMode: "STATIC_INTAKE_ONLY",
    uploaded: false,
    targetCodeExecuted: false,
    observedAt: new Date().toISOString()
  });
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
}

function mountAndroidLab() {
  if (typeof document === "undefined") return;
  const input = document.querySelector("#android-lab-file");
  const choose = document.querySelector("#android-lab-choose");
  const clear = document.querySelector("#android-lab-clear");
  const status = document.querySelector("#android-lab-status");
  const output = document.querySelector("#android-lab-evidence");
  const reportInput = document.querySelector("#android-lab-report-files");
  const reportChoose = document.querySelector("#android-lab-report-choose");
  const reportClear = document.querySelector("#android-lab-report-clear");
  const reportStatus = document.querySelector("#android-lab-report-status");
  const reportOutput = document.querySelector("#android-lab-report-evidence");
  if (!input || !choose || !clear || !status || !output) return;
  let currentApkSha256 = null;

  const showStatus = (message, kind = "info") => {
    status.textContent = message;
    status.dataset.state = kind;
  };

  choose.addEventListener("click", () => input.click());
  clear.addEventListener("click", () => {
    input.value = "";
    output.textContent = "لم يتم إنشاء سجل بعد.";
    currentApkSha256 = null;
    showStatus("جاهز لاستقبال ملف APK.", "info");
  });

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    output.textContent = "—";
    if (!file) {
      showStatus("لم يتم اختيار ملف.", "info");
      return;
    }
    showStatus("جارٍ التحقق من الملف وحساب SHA-256 محلياً…", "busy");
    try {
      const evidence = await inspectApkFile(file);
      currentApkSha256 = evidence.sha256;
      output.textContent = [
        `Evidence ID: ${evidence.evidenceId}`,
        `File: ${evidence.fileName}`,
        `Size: ${formatBytes(evidence.sizeBytes)}`,
        `SHA-256: ${evidence.sha256}`,
        `Status: ${evidence.status}`,
        "Mode: Static intake only",
        "Upload: No",
        "Target execution: No"
      ].join("\n");
      showStatus("تم التحقق من الحاوية وإنشاء بصمة الملف. لم يُرفع الملف ولم يُشغّل.", "success");
    } catch (error) {
      showStatus(error?.message || "تعذر فحص الملف.", "error");
      output.textContent = `BLOCKED: ${error?.code || "UNKNOWN_ERROR"}`;
    }
  });

  if (reportInput && reportChoose && reportClear && reportStatus && reportOutput) {
    const showReportStatus = (message, kind = "info") => {
      reportStatus.textContent = message;
      reportStatus.dataset.state = kind;
    };
    reportChoose.addEventListener("click", () => reportInput.click());
    reportClear.addEventListener("click", () => {
      reportInput.value = "";
      reportOutput.textContent = "لا توجد نتائج تحليل مستوردة.";
      showReportStatus("تم مسح سجل التقرير المحلي.", "info");
    });
    reportInput.addEventListener("change", async () => {
      const files = Array.from(reportInput.files || []);
      if (!files.length) {
        showReportStatus("لم يتم اختيار تقارير.", "info");
        return;
      }
      showReportStatus("جارٍ التحقق من مخطط التقارير وتطابق SHA-256…", "busy");
      try {
        const evidence = await inspectAnalysisReports(files, currentApkSha256);
        reportOutput.textContent = formatAnalysisEvidence(evidence);
        showReportStatus(evidence.status === "VERIFIED" ? "تم التحقق من التقارير الثلاثة وربطها ببصمة APK واحدة." : "تم استيراد تقارير جزئية. أضف الملفات الناقصة لاكتمال سجل الأدلة.", evidence.status === "VERIFIED" ? "success" : "busy");
      } catch (error) {
        showReportStatus(error?.message || "تعذر استيراد تقارير التحليل.", "error");
        reportOutput.textContent = "BLOCKED: " + (error?.code || "UNKNOWN_ERROR");
      }
    });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAndroidLab, { once: true });
  } else {
    mountAndroidLab();
  }
}


const ANALYSIS_REPORT_SCHEMAS = Object.freeze({
  "midad-android-static-v1": "android-static",
  "midad-dex-intelligence-v1": "dex-intelligence",
  "midad-web-bundle-intelligence-v1": "web-intelligence"
});

export async function inspectAnalysisReports(files, expectedSha256 = null) {
  if (!Array.isArray(files) || files.length === 0) {
    throw failure("ANALYSIS_REPORT_REQUIRED", "اختر تقرير تحليل JSON واحداً على الأقل.");
  }
  if (expectedSha256 !== null && !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw failure("ANALYSIS_EXPECTED_SHA_INVALID", "بصمة APK المرجعية غير صالحة.");
  }

  const reports = {};
  let apkSha256 = null;
  let packageName = null;
  const fileNames = [];

  for (const file of files) {
    if (!file || typeof file.name !== "string" || !file.name.toLowerCase().endsWith(".json") || typeof file.text !== "function") {
      throw failure("ANALYSIS_FILE_INVALID", "كل ملف تحليل يجب أن يكون ملف JSON قابلاً للقراءة.");
    }
    let report;
    try {
      report = JSON.parse(await file.text());
    } catch {
      throw failure("ANALYSIS_JSON_INVALID", `تعذرت قراءة JSON: ${file.name}`);
    }

    const reportType = ANALYSIS_REPORT_SCHEMAS[report?.schema];
    if (!reportType) {
      throw failure("ANALYSIS_SCHEMA_UNSUPPORTED", `مخطط تقرير غير مدعوم: ${file.name}`);
    }
    if (reports[reportType]) {
      throw failure("ANALYSIS_REPORT_DUPLICATE", `تم اختيار تقرير مكرر: ${file.name}`);
    }

    const reportSha = reportType === "android-static" ? report.input?.sha256 : report.apk_sha256;
    const reportPackage = reportType === "android-static" ? report.manifest?.package : report.package_name;
    if (typeof reportSha !== "string" || !/^[a-f0-9]{64}$/i.test(reportSha) || typeof reportPackage !== "string" || !reportPackage.trim()) {
      throw failure("ANALYSIS_REPORT_INCOMPLETE", `بيانات الهوية أو SHA-256 مفقودة في: ${file.name}`);
    }
    if (apkSha256 && apkSha256.toLowerCase() !== reportSha.toLowerCase()) {
      throw failure("ANALYSIS_APK_MISMATCH", "التقارير المختارة لا تخص بصمة APK واحدة.");
    }
    if (packageName && packageName !== reportPackage) {
      throw failure("ANALYSIS_PACKAGE_MISMATCH", "التقارير المختارة تشير إلى حزم تطبيقات مختلفة.");
    }
    if (expectedSha256 && expectedSha256.toLowerCase() !== reportSha.toLowerCase()) {
      throw failure("ANALYSIS_APK_MISMATCH", "بصمة التقرير لا تطابق APK الذي تم استلامه محلياً.");
    }

    apkSha256 = reportSha;
    packageName = reportPackage;
    reports[reportType] = report;
    fileNames.push(file.name);
  }

  const android = reports["android-static"];
  const dex = reports["dex-intelligence"];
  const web = reports["web-intelligence"];
  const isComplete = Boolean(android && dex && web && android.analysis?.status === "completed");
  return Object.freeze({
    schema: "midad.android-analysis-evidence/v1",
    status: isComplete ? "VERIFIED" : "PARTIAL",
    packageName,
    apkSha256: apkSha256.toLowerCase(),
    reportTypes: ["android-static", "dex-intelligence", "web-intelligence"].filter(type => reports[type]),
    fileNames: Object.freeze(fileNames),
    manifest: android?.manifest || null,
    analysis: android?.analysis || null,
    dex: dex ? {
      status: dex.status,
      dexFileCount: dex.dex_file_count,
      parsedDexCount: dex.parsed_dex_count,
      classCount: dex.class_count,
      methodCount: dex.method_count,
      appOwnedClassCount: dex.app_owned_class_count,
      appOwnedMethodCount: dex.app_owned_method_count,
      errors: Array.isArray(dex.errors) ? dex.errors.length : null
    } : null,
    web: web ? {
      status: web.status,
      indicators: web.indicators || {},
      externalEndpoints: Array.isArray(web.external_endpoints) ? web.external_endpoints : [],
      missingFiles: web.missing_files || [],
      missingLocalReferences: web.missing_local_references || [],
      errors: Array.isArray(web.errors) ? web.errors : []
    } : null,
    observedAt: new Date().toISOString()
  });
}

export function formatAnalysisEvidence(evidence) {
  const lines = [
    "MIDAD Android Analysis Evidence",
    `Status: ${evidence.status}`,
    `Package: ${evidence.packageName}`,
    `APK SHA-256: ${evidence.apkSha256}`,
    `Reports: ${evidence.reportTypes.join(", ")}`,
    `Files: ${evidence.fileNames.join(", ")}`
  ];
  if (evidence.manifest) {
    lines.push(`Min SDK: ${evidence.manifest.min_sdk ?? "not reported"}`);
    lines.push(`Permissions: ${evidence.manifest.permissions?.length ?? "not reported"}`);
    lines.push(`Manifest components: ${evidence.manifest.components?.length ?? "not reported"}`);
  }
  if (evidence.analysis) {
    lines.push(`JADX: ${evidence.analysis.jadx ?? "not reported"}`);
    lines.push(`Apktool: ${evidence.analysis.apktool ?? "not reported"}`);
  }
  if (evidence.dex) {
    lines.push(`DEX: ${evidence.dex.parsedDexCount ?? "?"}/${evidence.dex.dexFileCount ?? "?"} parsed`);
    lines.push(`Classes / methods: ${evidence.dex.classCount ?? "?"} / ${evidence.dex.methodCount ?? "?"}`);
    lines.push(`DEX errors: ${evidence.dex.errors ?? "not reported"}`);
  }
  if (evidence.web) {
    const i = evidence.web.indicators;
    lines.push(`Web indicators: network=${i.network_calls ?? "?"}, storage=${i.storage_apis ?? "?"}, dynamic-execution=${i.dynamic_execution ?? "?"}, DOM-sinks=${i.dom_injection_sinks ?? "?"}, secret-like=${i.secret_like_patterns ?? "?"}`);
    lines.push(`External endpoints: ${evidence.web.externalEndpoints.length}`);
    lines.push(`Missing files / references: ${evidence.web.missingFiles.length} / ${evidence.web.missingLocalReferences.length}`);
  }
  lines.push("Mode: local report intake only · no upload · no APK execution");
  return lines.join("\n");
}
