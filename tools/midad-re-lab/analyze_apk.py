from __future__ import annotations
import argparse, hashlib, ipaddress, json, socket, subprocess, zipfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import xml.etree.ElementTree as ET

MAX_APK_BYTES = 200 * 1024 * 1024
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

def file_digest(path: Path):
    if not path.is_file() or path.stat().st_size > MAX_APK_BYTES or not zipfile.is_zipfile(path):
        raise ValueError("INPUT_NOT_VALID_APK_ZIP")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return path.stat().st_size, digest.hexdigest()

def run(command):
    subprocess.run(command, check=True, timeout=300, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

def main():
    parser=argparse.ArgumentParser()
    source=parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--url")
    source.add_argument("--file")
    parser.add_argument("--jadx",required=True); parser.add_argument("--apktool",required=True); parser.add_argument("--out",default="artifacts/apk")
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
    run(["java","-jar",args.apktool,"d","-f","-o",str(decoded),str(apk)])
    run([args.jadx,"-d",str(decompiled),"--deobf",str(apk)])
    manifest=ET.parse(decoded/"AndroidManifest.xml").getroot()
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
    source_count=sum(1 for _ in decompiled.rglob("*.java")) + sum(1 for _ in decompiled.rglob("*.kt"))
    report={"schema":"midad-android-static-v1","generated_at":datetime.now(timezone.utc).isoformat(),
      "input":{"source_url_host":source_host,"bytes":size,"sha256":sha},
      "manifest":{"package":manifest.attrib.get("package"),"version_code":manifest.attrib.get(ANDROID_NS+"versionCode"),"version_name":manifest.attrib.get(ANDROID_NS+"versionName"),"min_sdk":(decoded/"apktool.yml").read_text(encoding="utf-8",errors="replace").split("minSdkVersion:",1)[-1].splitlines()[0].strip() if "minSdkVersion:" in (decoded/"apktool.yml").read_text(encoding="utf-8",errors="replace") else None,"permissions":permissions,"components":components},
      "archive":{"dex_files":dex,"native_abis":native,"asset_file_count":assets,"resource_file_count":resources},
      "analysis":{"jadx_java_kt_source_file_count":source_count,"jadx":"completed","apktool":"completed"},
      "safety":{"static_only":True,"no_install":True,"no_execution":True,"decompiled_sources_not_published":True}}
    (out/"android-static-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    if temporary_download: apk.unlink(missing_ok=True)
    print("ANDROID_STATIC_REPORT_READY",out/"android-static-report.json")

if __name__=="__main__": main()
