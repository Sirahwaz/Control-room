from __future__ import annotations
import argparse, hashlib, ipaddress, json, shutil, socket, subprocess, zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException
from dex_intelligence import analyze_apk_dex, summarize_smali_tree
from web_bundle_intelligence import analyze_apk_web_bundle

MAX_APK_BYTES = 200 * 1024 * 1024
MAX_ANDROID_MANIFEST_BYTES = 2 * 1024 * 1024
ANDROID_NS = "{http://schemas.android.com/apk/res/android}"

def validate_public_url(raw: str, expected_host: str | None = None):
    parts = urlsplit(raw)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password or parts.port not in (None, 443):
        raise ValueError("HTTPS_PUBLIC_URL_REQUIRED")
    host = parts.hostname.lower().rstrip(".")
    if expected_host and host != expected_host:
        raise ValueError("CROSS_HOST_REDIRECT_BLOCKED")
    records = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    addresses = {r[4][0] for r in records}
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError("TARGET_HOST_NOT_PUBLIC")
    return host

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def download_apk(url: str, destination: Path):
    host = validate_public_url(url)
    opener = build_opener(NoRedirect)
    current = url
    for _ in range(4):
        validate_public_url(current, host)
        try:
            response = opener.open(Request(current, headers={"User-Agent":"MIDAD-Authorized-APK-Static-Analysis/1.0"}), timeout=25)
        except HTTPError as exc:
            response = exc
        status = getattr(response, "status", response.code)
        if status in (301,302,303,307,308):
            location = response.headers.get("Location"); response.close()
            if not location: raise ValueError("REDIRECT_WITHOUT_LOCATION")
            current = urljoin(current, location); continue
        if status < 200 or status >= 300: raise ValueError(f"APK_DOWNLOAD_HTTP_{status}")
        length = int(response.headers.get("Content-Length") or "0")
        if length > MAX_APK_BYTES: raise ValueError("APK_TOO_LARGE")
        digest = hashlib.sha256(); total = 0
        with destination.open("wb") as out:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk: break
                total += len(chunk)
                if total > MAX_APK_BYTES: raise ValueError("APK_TOO_LARGE")
                digest.update(chunk); out.write(chunk)
        response.close()
        if total < 4 or destination.read_bytes()[:2] != b"PK": raise ValueError("INPUT_NOT_VALID_APK_ZIP")
        return total, digest.hexdigest(), current
    raise ValueError("REDIRECT_LIMIT_EXCEEDED")

def parse_android_manifest(manifest_path: Path):
    """Parse an APK-derived Android manifest with bounded, DTD-free XML handling."""
    manifest_path = Path(manifest_path)
    try:
        manifest_size = manifest_path.stat().st_size
    except OSError:
        raise ValueError("ANDROID_MANIFEST_UNAVAILABLE") from None
    if manifest_size > MAX_ANDROID_MANIFEST_BYTES:
        raise ValueError("ANDROID_MANIFEST_TOO_LARGE")

    try:
        document = ET.parse(
            manifest_path,
            forbid_dtd=True,
            forbid_entities=True,
            forbid_external=True,
        )
    except (ET.ParseError, DefusedXmlException):
        raise ValueError("ANDROID_MANIFEST_XML_REJECTED") from None
    return document.getroot()


def file_digest(path: Path):
    if not path.is_file() or path.stat().st_size > MAX_APK_BYTES or not zipfile.is_zipfile(path):
        raise ValueError("INPUT_NOT_VALID_APK_ZIP")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return path.stat().st_size, digest.hexdigest()

def run_tool(command, tool_name: str):
    """Run a static-analysis tool and return bounded diagnostics instead of hiding failures."""
    try:
        result = subprocess.run(
            command, check=True, timeout=300,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True
        )
        return {"status": "completed", "returncode": result.returncode, "error": None}
    except subprocess.CalledProcessError as exc:
        output = exc.stdout or exc.output or ""
        if isinstance(output, bytes):
            output = output.decode("utf-8", "replace")
        detail = str(output)[-4096:].strip() or f"{tool_name} exited with status {exc.returncode}"
        return {"status": "failed", "returncode": exc.returncode, "error": detail}
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        if isinstance(output, bytes):
            output = output.decode("utf-8", "replace")
        detail = str(output)[-3500:].strip()
        suffix = f"Timed out after {exc.timeout} seconds"
        if detail:
            suffix += f": {detail}"
        return {"status": "timeout", "returncode": None, "error": suffix[-4096:]}

def run_jadx(jadx: str, apk: str, output_dir: str):
    """Run isolated JADX strategies and retain the most useful output, even on partial failure."""
    output = Path(output_dir)
    attempts_root = output / "attempts"
    standard_dir = attempts_root / "standard"
    fallback_dir = attempts_root / "simple_fallback"
    shutil.rmtree(attempts_root, ignore_errors=True)
    standard_dir.mkdir(parents=True, exist_ok=True)

    standard_command = [jadx, "--verbose", "-d", str(standard_dir), "--deobf", str(apk)]
    standard = run_tool(standard_command, "jadx")
    standard_count = count_decompiled_sources(standard_dir)
    standard.update({"strategy": "standard", "output_dir": str(standard_dir), "source_file_count": standard_count})
    if standard["status"] == "completed":
        return {"status": "completed", "strategy": "standard", "attempts": [standard],
                "output_dir": str(standard_dir), "source_file_count": standard_count, "error": None}

    fallback_dir.mkdir(parents=True, exist_ok=True)
    fallback_command = [
        jadx, "--verbose", "--show-bad-code", "--decompilation-mode", "simple",
        "--no-inline-anonymous", "--no-inline-methods", "--no-inline-kotlin-lambda",
        "--no-move-inner-classes", "-j", "1", "-d", str(fallback_dir), "--deobf", str(apk)
    ]
    fallback = run_tool(fallback_command, "jadx")
    fallback_count = count_decompiled_sources(fallback_dir)
    fallback.update({"strategy": "simple_fallback", "output_dir": str(fallback_dir), "source_file_count": fallback_count})
    if fallback["status"] == "completed":
        return {"status": "completed", "strategy": "simple_fallback", "attempts": [standard, fallback],
                "output_dir": str(fallback_dir), "source_file_count": fallback_count, "error": None}

    best = standard if standard_count >= fallback_count else fallback
    error = ("standard: " + str(standard["error"] or standard["status"]) +
             "; simple_fallback: " + str(fallback["error"] or fallback["status"]))[-4096:]
    return {"status": "failed", "strategy": "best_effort_partial", "attempts": [standard, fallback],
            "output_dir": best["output_dir"], "source_file_count": best["source_file_count"], "error": error}


def count_decompiled_sources(directory: Path) -> int:
    if not directory.exists():
        return 0
    return sum(1 for pattern in ("*.java", "*.kt") for _ in directory.rglob(pattern))


def main():
    parser=argparse.ArgumentParser()
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--file")
    parser.add_argument("--jadx",required=True); parser.add_argument("--apktool",required=True); parser.add_argument("--product-key"); parser.add_argument("--out",default="artifacts/apk")
    args=parser.parse_args()
    out=Path(args.out); out.mkdir(parents=True,exist_ok=True)
    temporary_download = bool(args.url)
    if args.url:
        apk=out/"input.apk"
        size,sha,url=download_apk(args.url,apk)
        source_host=urlsplit(url).hostname
    else:
        apk=Path(args.file).resolve()
        size,sha=file_digest(apk)
        source_host="github-actions-artifact"
    decoded=out/"apktool"; decompiled=out/"jadx"
    apktool_result = run_tool(["java","-jar",args.apktool,"d","-f","-o",str(decoded),str(apk)], "apktool")
    if apktool_result["status"] != "completed":
        raise RuntimeError(f"APKTOOL_{apktool_result['status'].upper()}: {apktool_result['error']}")
    # JADX is best-effort: APKtool can still provide a useful manifest/archive report.
    jadx_result = run_jadx(args.jadx, str(apk), str(decompiled))
    decompiled = Path(jadx_result["output_dir"])
    manifest=parse_android_manifest(decoded/"AndroidManifest.xml")
    package_name=manifest.attrib.get("package")
    product_manifest = None
    if args.product_key:
        product_manifest_path = Path("mobile/factory/products") / (args.product_key + ".json")
        product_manifest = json.loads(product_manifest_path.read_text(encoding="utf-8"))
        if product_manifest.get("product_key") != args.product_key:
            raise ValueError("PRODUCT_MANIFEST_KEY_MISMATCH")
    web_report = analyze_apk_web_bundle(apk, product_manifest=product_manifest, package_name=package_name, apk_sha256=sha)
    (out/"web-intelligence-report.json").write_text(json.dumps(web_report,ensure_ascii=False,indent=2),encoding="utf-8")
    dex_report = analyze_apk_dex(apk, apk_sha256=sha, package_name=package_name)
    dex_report["smali"] = summarize_smali_tree(decoded, package_name=package_name)
    (out/"dex-intelligence-report.json").write_text(json.dumps(dex_report,ensure_ascii=False,indent=2),encoding="utf-8")
    permissions=sorted({e.attrib.get(ANDROID_NS+"name","") for e in manifest.findall("uses-permission") if e.attrib.get(ANDROID_NS+"name")})
    app=manifest.find("application")
    components=[]
    if app is not None:
        for tag in ("activity","activity-alias","service","receiver","provider"):
            for node in app.findall(tag):
                components.append({"type":tag,"name":node.attrib.get(ANDROID_NS+"name","")})
    with zipfile.ZipFile(apk) as archive:
        names=archive.namelist()
        dex=sorted(n for n in names if n.endswith(".dex"))
        native=sorted({n.split("/")[1] for n in names if n.startswith("lib/") and len(n.split("/"))>2})
        assets=sum(1 for n in names if n.startswith("assets/"))
        resources=sum(1 for n in names if n.startswith("res/"))
    source_count=jadx_result["source_file_count"]
    report={"schema":"midad-android-static-v1","generated_at":datetime.now(timezone.utc).isoformat(),
      "input":{"source_url_host":source_host,"bytes":size,"sha256":sha},
      "manifest":{"package":manifest.attrib.get("package"),"version_code":manifest.attrib.get(ANDROID_NS+"versionCode"),"version_name":manifest.attrib.get(ANDROID_NS+"versionName"),"min_sdk":(decoded/"apktool.yml").read_text(encoding="utf-8",errors="replace").split("minSdkVersion:",1)[-1].splitlines()[0].strip() if "minSdkVersion:" in (decoded/"apktool.yml").read_text(encoding="utf-8",errors="replace") else None,"permissions":permissions,"components":components},
      "archive":{"dex_files":dex,"native_abis":native,"asset_file_count":assets,"resource_file_count":resources},
      "analysis":{"status":"completed" if jadx_result["status"] == "completed" and jadx_result["strategy"] == "standard" else "partial",
                  "jadx_java_kt_source_file_count":source_count,
                  "jadx":jadx_result["status"],"jadx_strategy":jadx_result["strategy"],
                  "jadx_attempts":jadx_result["attempts"],"jadx_error":jadx_result["error"],
                  "apktool":apktool_result["status"],
                  "dex_intelligence": {"status":dex_report["status"],"dex_file_count":dex_report["dex_file_count"],
                    "parsed_dex_count":dex_report["parsed_dex_count"],"class_count":dex_report["class_count"],
                    "method_count":dex_report["method_count"],
                    "app_owned_class_count":dex_report["app_owned_class_count"],
                    "app_owned_method_count":dex_report["app_owned_method_count"],
                    "error_count":len(dex_report["errors"]),
                    "smali_file_count":dex_report["smali"]["smali_file_count"],
                    "smali_method_count":dex_report["smali"]["method_definition_count"],
                    "first_party_smali_file_count":dex_report["smali"]["first_party_smali_file_count"],
                    "first_party_smali_method_count":dex_report["smali"]["first_party_method_definition_count"],
                    "first_party_smali_api_categories":dex_report["smali"]["first_party_api_category_counts"],
                    "smali_api_categories":dex_report["smali"]["api_category_counts"],
                    "report":"dex-intelligence-report.json"},
                  "web_bundle": {"status":web_report["status"],"file_count":web_report["file_count"],
                    "scanned_text_file_count":web_report["scanned_text_file_count"],
                    "framework_file_count":web_report.get("framework_file_count",0),
                    "framework_network_calls":web_report.get("framework_indicators",{}).get("network_calls",0),
                    "framework_capacitor_bridge":web_report.get("framework_indicators",{}).get("capacitor_bridge",0),
                    "capacitor_plugin_count":len(web_report.get("framework_plugin_inventory",[])),
                    "undeclared_file_count":len(web_report.get("undeclared_files",[])),
                    "missing_file_count":len(web_report.get("missing_files",[])),
                    "network_calls":web_report.get("indicators",{}).get("network_calls",0),
                    "storage_apis":web_report.get("indicators",{}).get("storage_apis",0),
                    "capacitor_bridge":web_report.get("indicators",{}).get("capacitor_bridge",0),
                    "dynamic_execution":web_report.get("indicators",{}).get("dynamic_execution",0),
                    "report":"web-intelligence-report.json"}},
      "safety":{"static_only":True,"no_install":True,"no_execution":True,"decompiled_sources_not_published":True}}
    (out/"android-static-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    if temporary_download: apk.unlink(missing_ok=True)
    print("ANDROID_STATIC_REPORT_READY",out/"android-static-report.json")

if __name__=="__main__": main()
