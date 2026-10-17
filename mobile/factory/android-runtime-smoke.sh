#!/usr/bin/env bash
set -euo pipefail

APP_ID="${1:-}"
APK_PATH="${2:-}"
APK_NAME="$(basename "${APK_PATH:-unknown.apk}")"
REPORT_PATH="dist/runtime-smoke-report.json"
API_LEVEL="${MIDAD_ANDROID_RUNTIME_API_LEVEL:-35}"

mkdir -p dist

write_report() {
  python3 - "$REPORT_PATH" "$1" "$2" "$APP_ID" "$APK_NAME" "$API_LEVEL" "$3" <<'PY'
import json
import sys

path, status, phase, package_id, apk_name, api_level, detail = sys.argv[1:]
report = {
    "schema_version": 1,
    "status": status,
    "phase": phase,
    "package_id": package_id or None,
    "apk_name": apk_name or None,
    "android_api": int(api_level) if api_level.isdigit() else None,
    "detail": detail,
}
with open(path, "w", encoding="utf-8") as handle:
    json.dump(report, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
PY
}

fail() {
  write_report "FAILED" "$1" "$2"
  echo "::error::$2"
  exit 1
}

if [[ -z "$APP_ID" || -z "$APK_PATH" ]]; then
  fail "arguments" "Usage: android-runtime-smoke.sh <application-id> <apk-path>"
fi

if [[ ! "$APP_ID" =~ ^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$ ]]; then
  fail "package-validation" "Application ID is not a valid Android package identifier."
fi

if [[ ! -f "$APK_PATH" ]]; then
  fail "artifact-presence" "The signed APK was not found at the expected path."
fi

write_report "RUNNING" "emulator-ready" "Waiting for an available Android emulator."
if ! adb get-state >/dev/null 2>&1; then
  fail "emulator-ready" "ADB could not communicate with the Android emulator."
fi

write_report "RUNNING" "install" "Installing the signed APK."
if ! adb install -r "$APK_PATH" >/dev/null 2>&1; then
  fail "install" "APK installation failed on the Android emulator."
fi

write_report "RUNNING" "launch" "Launching the app from its Android launcher entry."
if ! adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1; then
  fail "launch" "Android could not launch the app through its launcher entry."
fi

sleep 8

APP_PID="$(adb shell pidof "$APP_ID" 2>/dev/null | tr -d '\r' | xargs || true)"
if [[ -z "$APP_PID" ]]; then
  fail "process-alive" "The app process did not remain alive after launch."
fi

FOREGROUND="$(adb shell dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity' | grep -F "$APP_ID" | head -n 1 || true)"
if [[ -z "$FOREGROUND" ]]; then
  FOREGROUND="$(adb shell dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | grep -F "$APP_ID" | head -n 1 || true)"
fi
if [[ -z "$FOREGROUND" ]]; then
  fail "foreground" "The application process survived, but its activity was not reported in the foreground."
fi

write_report "PASSED" "complete" "APK installed, launched, remained alive for eight seconds, and held the foreground activity."
echo "ANDROID_RUNTIME_SMOKE_PASSED package=$APP_ID api=$API_LEVEL apk=$APK_NAME"
