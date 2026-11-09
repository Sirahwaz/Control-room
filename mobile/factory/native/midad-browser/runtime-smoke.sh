#!/usr/bin/env bash
set -euo pipefail
APP_ID="${1:-ai.midad.browser}"
APK_PATH="${2:-}"
mkdir -p dist
fail(){ echo "::error::$2"; exit 1; }
test -f "$APK_PATH" || fail "apk" "Browser APK missing"
adb get-state >/dev/null 2>&1 || fail "emulator" "Android emulator unavailable"
adb install -r "$APK_PATH" >/dev/null || fail "install" "APK install failed"
adb logcat -c
adb shell svc wifi disable >/dev/null 2>&1 || true
adb shell svc data disable >/dev/null 2>&1 || true
adb shell monkey -p "$APP_ID" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || fail "launch" "Browser launcher failed"
for attempt in $(seq 1 20); do
  if adb logcat -d -s MIDAD_BROWSER:I | grep -Fq "LOCAL_HOME_LOADED"; then
    echo "MIDAD_BROWSER_OFFLINE_HOME_PASSED"
    break
  fi
  sleep 1
done
if ! adb logcat -d -s MIDAD_BROWSER:I | grep -Fq "LOCAL_HOME_LOADED"; then
  adb shell svc wifi enable >/dev/null 2>&1 || true
  adb shell svc data enable >/dev/null 2>&1 || true
  fail "offline-home" "Packaged MIDAD home did not load while network was disabled"
fi
adb shell svc wifi enable >/dev/null 2>&1 || true
adb shell svc data enable >/dev/null 2>&1 || true
adb shell pidof "$APP_ID" >/dev/null || fail "process" "Browser process did not remain alive"
adb shell am start -W -a android.intent.action.VIEW -d "https://example.com/" "$APP_ID" >/dev/null || fail "view-intent" "HTTPS VIEW intent failed"
sleep 3
FOREGROUND="$(adb shell dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | grep -F "$APP_ID" | head -n 1 || true)"
test -n "$FOREGROUND" || fail "foreground" "Browser activity is not foreground after VIEW intent"
echo "MIDAD_BROWSER_ANDROID_SMOKE_PASSED"
