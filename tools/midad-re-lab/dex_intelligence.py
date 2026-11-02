from __future__ import annotations

import re
import zipfile
from pathlib import Path
from typing import Callable, Any

MAX_DEX_FILES = 16
MAX_DEX_BYTES = 64 * 1024 * 1024
MAX_CLASS_RECORDS = 2000
MAX_METHODS_PER_CLASS = 100
MAX_STRING_INDICATORS = 500

_DEX_NAME = re.compile(r"^classes(?:[2-9]|[1-9][0-9]+)?\.dex$")
_STRING_PATTERNS = (
    ("https_url", re.compile(r"https://[^\s\"'<>]{1,240}", re.IGNORECASE)),
    ("content_uri", re.compile(r"content://[^\s\"'<>]{1,200}", re.IGNORECASE)),
    ("file_uri", re.compile(r"file://[^\s\"'<>]{1,200}", re.IGNORECASE)),
    ("ip_literal", re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?(?![\w.])")),
)


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
                item = (kind, match[:512])
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
            names = sorted(
                (name for name in archive.namelist() if _DEX_NAME.fullmatch(name)),
                key=lambda name: (0 if name == "classes.dex" else int(name[7:-4])),
            )
            if len(names) > MAX_DEX_FILES:
                names = names[:MAX_DEX_FILES]
            results = []
            errors = []
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
    total = len(names)
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
