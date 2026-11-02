from __future__ import annotations

import re
import zipfile
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit
from typing import Callable, Any

MAX_DEX_FILES = 16
MAX_DEX_BYTES = 64 * 1024 * 1024
MAX_CLASS_RECORDS = 2000
MAX_METHODS_PER_CLASS = 100
MAX_STRING_INDICATORS = 500

_SMALI_INVOKE = re.compile(r"\b(invoke-\S+)\s+\{[^}]*\},\s*(L[^;]+;->[^\s]+)")
_SMALI_CATEGORIES = {
    "network": ("Ljava/net/", "Lokhttp3/", "Lretrofit2/", "Lorg/apache/http/"),
    "webview": ("Landroid/webkit/WebView;",),
    "reflection": ("Ljava/lang/reflect/",),
    "dynamic_code_loading": ("Ldalvik/system/DexClassLoader;", "Ldalvik/system/PathClassLoader;", "Ljava/lang/ClassLoader;->loadClass"),
    "cryptography": ("Ljavax/crypto/", "Ljava/security/"),
    "location": ("Landroid/location/",),
    "sms": ("Landroid/telephony/SmsManager;",),
    "accessibility": ("Landroid/accessibilityservice/",),
    "process_execution": ("Ljava/lang/Runtime;->exec", "Ljava/lang/ProcessBuilder;"),
    "device_identifiers": ("Landroid/telephony/TelephonyManager;->getDeviceId", "Landroid/telephony/TelephonyManager;->getImei"),
}


def summarize_smali_tree(decoded_root: Path) -> dict:
    """Summarize APKtool Smali output without copying source code into reports."""
    files = sorted(decoded_root.glob("smali*/**/*.smali"))
    counts = {name: 0 for name in _SMALI_CATEGORIES}
    samples = {name: [] for name in _SMALI_CATEGORIES}
    method_count = 0
    invoke_count = 0
    for path in files:
        try:
            lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        for line in lines:
            stripped = line.strip()
            if stripped.startswith(".method "):
                method_count += 1
            match = _SMALI_INVOKE.search(stripped)
            if not match:
                continue
            invoke_count += 1
            reference = match.group(2)
            for category, prefixes in _SMALI_CATEGORIES.items():
                if any(prefix in reference for prefix in prefixes):
                    counts[category] += 1
                    if len(samples[category]) < 30 and reference not in samples[category]:
                        samples[category].append(reference[:240])
    return {
        "status": "completed" if files else "unavailable",
        "smali_file_count": len(files),
        "method_definition_count": method_count,
        "invoke_reference_count": invoke_count,
        "api_category_counts": counts,
        "api_reference_samples": samples,
        "source_code_included": False,
    }


_STRING_PATTERNS = (
    ("https_url", re.compile(r"https://[^\s\"'<>]{1,240}", re.IGNORECASE)),
    ("content_uri", re.compile(r"content://[^\s\"'<>]{1,200}", re.IGNORECASE)),
    ("file_uri", re.compile(r"file://[^\s\"'<>]{1,200}", re.IGNORECASE)),
    ("ip_literal", re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?![\w.])")),
)


def _is_dex_name(name: str) -> bool:
    if name == "classes.dex":
        return True
    if not name.startswith("classes") or not name.endswith(".dex"):
        return False
    suffix = name[len("classes"):-len(".dex")]
    return suffix.isdigit() and int(suffix) >= 2


def _default_dex_factory(raw: bytes):
    try:
        from androguard.core.dex import DEX
    except ImportError as exc:
        raise RuntimeError("ANDROGUARD_NOT_INSTALLED") from exc
    return DEX(raw)


def _safe_call(obj: Any, method_name: str, default=None):
    method = getattr(obj, method_name, None)
    if not callable(method):
        return default
    try:
        return method()
    except Exception:
        return default


def summarize_dex(dex_name: str, dex_obj: Any) -> dict:
    classes = list(_safe_call(dex_obj, "get_classes", []) or [])
    strings = list(_safe_call(dex_obj, "get_strings", []) or [])
    class_records = []
    method_count = 0

    for cls in classes:
        methods = list(_safe_call(cls, "get_methods", []) or [])
        method_count += len(methods)
        if len(class_records) >= MAX_CLASS_RECORDS:
            continue
        method_records = []
        for method in methods[:MAX_METHODS_PER_CLASS]:
            method_records.append({
                "name": _safe_call(method, "get_name", ""),
                "descriptor": _safe_call(method, "get_descriptor", ""),
                "access": _safe_call(method, "get_access_flags_string", ""),
            })
        class_records.append({
            "name": _safe_call(cls, "get_name", ""),
            "superclass": _safe_call(cls, "get_superclassname", ""),
            "method_count": len(methods),
            "methods_truncated": max(0, len(methods) - len(method_records)),
            "methods": method_records,
        })

    indicators = []
    seen = set()
    for value in strings:
        if not isinstance(value, str):
            continue
        for kind, pattern in _STRING_PATTERNS:
            for match in pattern.findall(value):
                safe_value = match[:512]
                if kind in ("https_url", "content_uri", "file_uri"):
                    parts = urlsplit(safe_value)
                    safe_value = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
                item = (kind, safe_value)
                if item not in seen:
                    seen.add(item)
                    indicators.append({"type": kind, "value": item[1]})
                if len(indicators) >= MAX_STRING_INDICATORS:
                    break
            if len(indicators) >= MAX_STRING_INDICATORS:
                break
        if len(indicators) >= MAX_STRING_INDICATORS:
            break

    return {
        "dex_name": dex_name,
        "status": "completed",
        "class_count": len(classes),
        "method_count": method_count,
        "string_count": len(strings),
        "class_records_truncated": max(0, len(classes) - len(class_records)),
        "classes": class_records,
        "string_indicators": indicators,
        "string_indicators_truncated": len(indicators) >= MAX_STRING_INDICATORS,
    }


def analyze_apk_dex(apk_path: Path, dex_factory: Callable[[bytes], Any] | None = None) -> dict:
    """Parse every canonical DEX entry without installing or executing the APK."""
    factory = dex_factory or _default_dex_factory
    try:
        with zipfile.ZipFile(apk_path) as archive:
            all_names = sorted(
                (name for name in archive.namelist() if _is_dex_name(name)),
                key=lambda name: (0 if name == "classes.dex" else int(name[7:-4])),
            )
            names = all_names[:MAX_DEX_FILES]
            results = []
            errors = []
            if len(all_names) > MAX_DEX_FILES:
                errors.append({
                    "dex_name": None,
                    "error": "DEX_FILE_LIMIT_EXCEEDED",
                    "omitted_count": len(all_names) - MAX_DEX_FILES,
                })
            for name in names:
                info = archive.getinfo(name)
                if info.file_size > MAX_DEX_BYTES:
                    errors.append({"dex_name": name, "error": "DEX_ENTRY_TOO_LARGE"})
                    continue
                try:
                    raw = archive.read(name)
                    if not raw.startswith(b"dex\n"):
                        raise ValueError("INVALID_DEX_MAGIC")
                    results.append(summarize_dex(name, factory(raw)))
                except Exception as exc:
                    errors.append({"dex_name": name, "error": str(exc)[:512]})
    except (OSError, zipfile.BadZipFile) as exc:
        return {
            "schema": "midad-dex-intelligence-v1",
            "status": "failed",
            "dex_file_count": 0,
            "parsed_dex_count": 0,
            "class_count": 0,
            "method_count": 0,
            "errors": [{"dex_name": None, "error": str(exc)[:512]}],
            "dex_files": [],
        }

    parsed = len(results)
    total = len(all_names)
    status = "completed" if total and parsed == total and not errors else (
        "partial" if parsed else "failed"
    )
    return {
        "schema": "midad-dex-intelligence-v1",
        "status": status,
        "dex_file_count": total,
        "parsed_dex_count": parsed,
        "class_count": sum(item["class_count"] for item in results),
        "method_count": sum(item["method_count"] for item in results),
        "errors": errors,
        "dex_files": results,
        "safety": {"static_only": True, "no_install": True, "no_execution": True},
    }
