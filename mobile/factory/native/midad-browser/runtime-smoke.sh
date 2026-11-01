#!/usr/bin/env bash
set -euo pipefail
APP_ID="${1:-ai.midad.browser}"
APK_PATH="${2:-}"
mkdir -p dist
fail(){ echo "::error::$2"; exit 1; }
test -f "$APK_PATH" || fail "apk" "Browser APK missing"
adb get-state >/dev/null 2>&1 || fail "emulator" "Android emulator unavailable"
adb install -r "$APK_PATH" >/dev/null || fail "install" "APK install failed"
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || fail "launch" "Browser launcher failed"
sleep 5
adb shell pidof "$APP_ID" >/dev/null || fail "process" "Browser process did not remain alive"
adb shell am start -W -a android.intent.action.VIEW -d "https://example.com/" "$APP_ID" >/dev/null || fail "view-intent" "HTTPS VIEW intent failed"
sleep 3
FOREGROUND="$(adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | grep -F "$APP_ID" | head -n 1 || true)"
test -n "$FOREGROUND" || fail "foreground" "Browser activity is not foreground after VIEW intent"
echo "MIDAD_BROWSER_ANDROID_SMOKE_PASSED"
