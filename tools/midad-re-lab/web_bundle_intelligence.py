from __future__ import annotations

import hashlib
import json
import posixpath
import re
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

MAX_PUBLIC_FILES = 1000
MAX_TEXT_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_TEXT_BYTES = 30 * 1024 * 1024
TEXT_EXTENSIONS = {".html", ".htm", ".js", ".mjs", ".css", ".json", ".webmanifest", ".txt"}
FRAMEWORK_FILES = {"assets/public/cordova.js", "assets/public/cordova_plugins.js"}
FRAMEWORK_ASSETS = {"assets/native-bridge.js", "assets/proxy-bridge.js", "assets/capacitor.config.json", "assets/capacitor.plugins.json"}

_PATTERNS = {
    "network_calls": re.compile(r"\bfetch\s*\(|XMLHttpRequest|\bWebSocket\s*\(|\bEventSource\s*\(|sendBeacon\s*\(|\baxios\.", re.I),
    "storage_apis": re.compile(r"localStorage|sessionStorage|indexedDB|document\.cookie|Capacitor\.Plugins\.Preferences|Preferences\.(?:get|set|remove)", re.I),
    "capacitor_bridge": re.compile(r"nativeBridge|nativeCallback|window\.Capacitor|Capacitor\.Plugins|window\.mobileApp|webkit\.messageHandlers", re.I),
    "message_bridge": re.compile(r"postMessage\s*\(|addEventListener\s*\(\s*['\"]message['\"]|\bonmessage\s*=", re.I),
    "dynamic_execution": re.compile(r"\beval\s*\(|\bnew\s+Function\s*\(|(?:setTimeout|setInterval)\s*\(\s*['\"]|document\.write\s*\(", re.I),
    "dom_injection_sinks": re.compile(r"\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|dangerouslySetInnerHTML", re.I),
    "secret_like_patterns": re.compile(r"-----BEGIN (?:RSA|OPENSSH|EC|PRIVATE) KEY-----|\bsk-[A-Za-z0-9_-]{20,}\b|AIza[0-9A-Za-z_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}", re.I),
}
_URL = re.compile(r"\b(?:https?|wss?)://[^\s\"'<>]+", re.I)
_HTML_REF = re.compile(r"\b(?:src|href)\s*=\s*['\"]([^'\"]+)['\"]", re.I)


def _safe_url(raw: str) -> str | None:
    try:
        parts = urlsplit(raw.rstrip(").,;"))
        if parts.scheme.lower() not in {"http", "https", "ws", "wss"} or not parts.hostname:
            return None
        host = parts.hostname.lower()
        if parts.port and parts.port not in (80, 443):
            host += f":{parts.port}"
        return f"{parts.scheme.lower()}://{host}{parts.path or ''}"[:512]
    except ValueError:
        return None


def _manifest_files(product_manifest: dict | None):
    if not product_manifest:
        return None, None
    product_key = product_manifest.get("product_key")
    assets = product_manifest.get("web_assets")
    if not isinstance(assets, list):
        assets = []
    expected = {"assets/public/index.html"}
    expected.update("assets/public/" + Path(str(asset)).name for asset in assets if str(asset).strip())
    return product_key, expected


def analyze_apk_web_bundle(
    apk_path: Path,
    product_manifest: dict | None = None,
    package_name: str | None = None,
    apk_sha256: str | None = None,
) -> dict:
    """Inspect APK WebView files as inert bytes; never evaluates JavaScript or performs network requests."""
    try:
        with zipfile.ZipFile(apk_path) as archive:
            public_infos = [
                info for info in archive.infolist()
                if info.filename.startswith("assets/public/") and not info.is_dir()
            ]
            if not public_infos:
                return {
                    "schema": "midad-web-bundle-intelligence-v1",
                    "status": "failed",
                    "product_key": (product_manifest or {}).get("product_key"),
                    "package_name": package_name,
                    "apk_sha256": apk_sha256,
                    "file_count": 0,
                    "scanned_text_file_count": 0,
                    "errors": ["WEB_BUNDLE_NOT_FOUND"],
                    "files": [],
                    "safety": {"static_only": True, "javascript_executed": False, "network_access": False},
                }

            all_names = sorted(info.filename for info in public_infos)
            framework_infos = [
                archive.getinfo(name) for name in sorted(FRAMEWORK_ASSETS)
                if name in archive.namelist()
            ]
            scan_infos = public_infos + framework_infos
            product_key, expected = _manifest_files(product_manifest)
            allowed = expected | FRAMEWORK_FILES if expected is not None else None
            undeclared = sorted(name for name in all_names if allowed is not None and name not in allowed)
            missing = sorted(name for name in expected or [] if name not in all_names)
            errors = []
            file_reports = []
            total_text_bytes = 0
            aggregate = {name: 0 for name in _PATTERNS}
            public_aggregate = {name: 0 for name in _PATTERNS}
            framework_aggregate = {name: 0 for name in _PATTERNS}
            endpoints = set()

            for info in scan_infos[:MAX_PUBLIC_FILES + len(FRAMEWORK_ASSETS)]:
                scope = "public" if info.filename.startswith("assets/public/") else "framework"
                suffix = Path(info.filename).suffix.lower()
                if suffix not in TEXT_EXTENSIONS:
                    continue
                if info.file_size > MAX_TEXT_FILE_BYTES:
                    errors.append({"file": info.filename, "error": "TEXT_ASSET_TOO_LARGE"})
                    continue
                if total_text_bytes + info.file_size > MAX_TOTAL_TEXT_BYTES:
                    errors.append({"file": info.filename, "error": "TEXT_ASSET_BUDGET_EXCEEDED"})
                    continue
                raw = archive.read(info)
                total_text_bytes += len(raw)
                digest = hashlib.sha256(raw).hexdigest()
                text = raw.decode("utf-8", "replace")
                indicators = {name: len(pattern.findall(text)) for name, pattern in _PATTERNS.items()}
                for name, count in indicators.items():
                    aggregate[name] += count
                    (public_aggregate if scope == "public" else framework_aggregate)[name] += count
                urls = sorted({safe for match in _URL.findall(text) if (safe := _safe_url(match))})
                endpoints.update(urls)

                local_refs = []
                if scope == "public" and suffix in {".html", ".htm"}:
                    for ref in _HTML_REF.findall(text):
                        value = ref.strip()
                        if not value or value.startswith("#") or re.match(r"^(?:https?:|data:|mailto:|tel:|javascript:|wss?:)", value, re.I):
                            continue
                        clean = value.split("?", 1)[0].split("#", 1)[0]
                        target = posixpath.normpath(posixpath.join("assets/public", clean))
                        if target.startswith("assets/public/") and target not in all_names:
                            local_refs.append(clean)
                file_reports.append({
                    "path": info.filename,
                    "scope": scope,
                    "bytes": len(raw),
                    "sha256": digest,
                    "extension": suffix,
                    "indicators": indicators,
                    "external_endpoints": urls[:100],
                    "missing_local_references": sorted(set(local_refs)),
                })

            missing_local_refs = [
                {"file": item["path"], "reference": ref}
                for item in file_reports for ref in item["missing_local_references"]
            ]
            if len(public_infos) > MAX_PUBLIC_FILES:
                errors.append({"error": "PUBLIC_FILE_COUNT_LIMIT", "omitted_count": len(public_infos) - MAX_PUBLIC_FILES})
            capacitor_config = None
            try:
                raw_config = json.loads(archive.read("assets/capacitor.config.json"))
                capacitor_config = {
                    key: raw_config.get(key) for key in ("appId", "appName", "webDir")
                    if isinstance(raw_config.get(key), str)
                }
            except (KeyError, ValueError, UnicodeDecodeError):
                pass
            plugin_inventory = []
            try:
                raw_plugins = json.loads(archive.read("assets/capacitor.plugins.json"))
                if isinstance(raw_plugins, list):
                    plugin_inventory = [
                        {"package": item.get("pkg"), "classpath": item.get("classpath")}
                        for item in raw_plugins
                        if isinstance(item, dict) and item.get("pkg") and item.get("classpath")
                    ]
            except (KeyError, ValueError, UnicodeDecodeError):
                pass
            status = "completed" if not errors and not undeclared and not missing and not missing_local_refs else "partial"
            return {
                "schema": "midad-web-bundle-intelligence-v1",
                "status": status,
                "product_key": product_key,
                "package_name": package_name,
                "apk_sha256": apk_sha256,
                "file_count": len(all_names),
                "framework_file_count": len(framework_infos),
                "framework_files": sorted(info.filename for info in framework_infos),
                "scanned_text_file_count": len(file_reports),
                "scanned_public_text_file_count": sum(1 for item in file_reports if item["scope"] == "public"),
                "scanned_framework_text_file_count": sum(1 for item in file_reports if item["scope"] == "framework"),
                "scanned_text_bytes": total_text_bytes,
                "capacitor_config": capacitor_config,
                "framework_plugin_inventory": plugin_inventory,
                "expected_files": sorted(expected) if expected is not None else None,
                "undeclared_files": undeclared,
                "missing_files": missing,
                "missing_local_references": missing_local_refs[:500],
                "indicators": aggregate,
                "public_indicators": public_aggregate,
                "framework_indicators": framework_aggregate,
                "external_endpoints": sorted(endpoints)[:200],
                "errors": errors,
                "files": file_reports,
                "safety": {"static_only": True, "javascript_executed": False, "network_access": False},
            }
    except (OSError, zipfile.BadZipFile) as exc:
        return {
            "schema": "midad-web-bundle-intelligence-v1",
            "status": "failed",
            "product_key": (product_manifest or {}).get("product_key"),
            "package_name": package_name,
            "apk_sha256": apk_sha256,
            "file_count": 0,
            "scanned_text_file_count": 0,
            "errors": [str(exc)[:512]],
            "files": [],
            "safety": {"static_only": True, "javascript_executed": False, "network_access": False},
        }
