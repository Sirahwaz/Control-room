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
  if (!input || !choose || !clear || !status || !output) return;

  const showStatus = (message, kind = "info") => {
    status.textContent = message;
    status.dataset.state = kind;
  };

  choose.addEventListener("click", () => input.click());
  clear.addEventListener("click", () => {
    input.value = "";
    output.textContent = "لم يتم إنشاء سجل بعد.";
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
      output.textContent = [
        `Evidence ID: ${evidence.evidenceId}`,
        `File: ${evidence.fileName}`,
        `Size: ${formatBytes(evidence.sizeBytes)}`,
        `SHA-256: ${evidence.sha256}`,
        `Status: ${evidence.status}`,
        "Mode: Static intake only",
        "Upload: No",
        "Target execution: No"
      ].join("\\n");
      showStatus("تم التحقق من الحاوية وإنشاء بصمة الملف. لم يُرفع الملف ولم يُشغّل.", "success");
    } catch (error) {
      showStatus(error?.message || "تعذر فحص الملف.", "error");
      output.textContent = `BLOCKED: ${error?.code || "UNKNOWN_ERROR"}`;
    }
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAndroidLab, { once: true });
  } else {
    mountAndroidLab();
  }
}
