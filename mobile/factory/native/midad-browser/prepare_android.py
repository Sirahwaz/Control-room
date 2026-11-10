#!/usr/bin/env python3
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ANDROID = ROOT / "mobile/android"
JAVA_SRC = Path(__file__).with_name("BrowserActivity.java")
JAVA_DST = ANDROID / "app/src/main/java/ai/midad/browser/BrowserActivity.java"
MANIFEST = ANDROID / "app/src/main/AndroidManifest.xml"
APP_GRADLE = ANDROID / "app/build.gradle"
WEBKIT_DEPENDENCY = 'implementation "androidx.webkit:webkit:1.18.0"'
ANDROID_NS = "http://schemas.android.com/apk/res/android"
ET.register_namespace("android", ANDROID_NS)
A = f"{{{ANDROID_NS}}}"

if not JAVA_SRC.is_file() or not MANIFEST.is_file():
    raise SystemExit("browser_android_sources_missing")
if not APP_GRADLE.is_file():
    raise SystemExit("android_app_gradle_missing")

gradle_text = APP_GRADLE.read_text(encoding="utf-8")
if not re.search(r"androidx\.webkit:webkit:", gradle_text):
    dependency_block = re.search(r"(?m)^\s*dependencies\s*\{", gradle_text)
    if dependency_block is None:
        raise SystemExit("android_app_dependencies_block_missing")
    gradle_text = (
        gradle_text[:dependency_block.end()] + "\n    " +
        WEBKIT_DEPENDENCY + gradle_text[dependency_block.end():]
    )
    APP_GRADLE.write_text(gradle_text, encoding="utf-8")
if not re.search(r"androidx\.webkit:webkit:", gradle_text):
    raise SystemExit("androidx_webkit_dependency_not_configured")

JAVA_DST.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(JAVA_SRC, JAVA_DST)

tree = ET.parse(MANIFEST)
root = tree.getroot()
app = root.find("application")
if app is None:
    raise SystemExit("android_application_missing")

main = None
for activity in app.findall("activity"):
    if activity.get(A + "name") in (".MainActivity", "ai.midad.browser.MainActivity"):
        main = activity
        break
if main is None:
    raise SystemExit("capacitor_main_activity_missing")

# Keep MainActivity available internally but remove its launcher filter.
for filt in list(main.findall("intent-filter")):
    actions = {x.get(A + "name") for x in filt.findall("action")}
    cats = {x.get(A + "name") for x in filt.findall("category")}
    if "android.intent.action.MAIN" in actions and "android.intent.category.LAUNCHER" in cats:
        main.remove(filt)

for activity in list(app.findall("activity")):
    if activity.get(A + "name") == ".BrowserActivity":
        app.remove(activity)

browser = ET.SubElement(app, "activity", {
    A + "name": ".BrowserActivity",
    A + "label": "MIDAD Browser",
    A + "exported": "true",
    A + "launchMode": "singleTask",
    A + "configChanges": "orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
})

launcher = ET.SubElement(browser, "intent-filter")
ET.SubElement(launcher, "action", {A + "name": "android.intent.action.MAIN"})
ET.SubElement(launcher, "category", {A + "name": "android.intent.category.LAUNCHER"})

view = ET.SubElement(browser, "intent-filter")
ET.SubElement(view, "action", {A + "name": "android.intent.action.VIEW"})
ET.SubElement(view, "category", {A + "name": "android.intent.category.DEFAULT"})
ET.SubElement(view, "category", {A + "name": "android.intent.category.BROWSABLE"})
ET.SubElement(view, "data", {A + "scheme": "http"})
ET.SubElement(view, "data", {A + "scheme": "https"})

# Browsers need cleartext HTTP support to handle legacy HTTP destinations.
app.set(A + "usesCleartextTraffic", "true")

permissions = {p.get(A + "name") for p in root.findall("uses-permission")}
if "android.permission.INTERNET" not in permissions:
    root.insert(0, ET.Element("uses-permission", {A + "name": "android.permission.INTERNET"}))

tree.write(MANIFEST, encoding="utf-8", xml_declaration=True)
print("MIDAD_BROWSER_ANDROID_MANIFEST_PATCHED")
print("MIDAD_BROWSER_WEBVIEW_ASSET_LOADER_READY")
