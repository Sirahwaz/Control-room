package ai.midad.browser;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebMessageCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.WebViewCompat.WebMessageListener;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * Origin-bound, typed bridge from the packaged MIDAD control surface to native WebViews.
 * It deliberately exposes no JavaScript evaluator, shell, cookie, storage, or CDP endpoint.
 */
public final class BrowserAgentBridge {
    public static final String APP_ORIGIN = "https://appassets.androidplatform.net";
    public static final String JS_OBJECT_NAME = "midadNative";
    private static final int MAX_MESSAGE_CHARS = 16000;
    private static final int MAX_SNAPSHOT_CHARS = 12000;
    private static final int MAX_TABS = 8;
    private static final Pattern REQUEST_ID = Pattern.compile("^[A-Za-z0-9_-]{8,80}$");
    private static final Pattern SELECTOR = Pattern.compile("^[^\\u0000-\\u001f]{1,512}$");
    private static final Set<String> ALLOWED_KEYS = setOf(
        "ENTER", "TAB", "ESCAPE", "ARROW_UP", "ARROW_DOWN", "ARROW_LEFT", "ARROW_RIGHT", "SPACE"
    );
    private static final Set<String> COMMAND_TYPES = setOf(
        "getTabs", "switchTab", "navigate", "getDomSnapshot", "captureScreenshot",
        "click", "type", "select", "scroll", "pressKey", "waitFor"
    );

    private static Set<String> setOf(String... values) {
        Set<String> result = new HashSet<>();
        Collections.addAll(result, values);
        return Collections.unmodifiableSet(result);
    }

    private static JSONObject jsonObject(String key, Object value) {
        JSONObject result = new JSONObject();
        try { result.put(key, value); } catch (JSONException ignored) {}
        return result;
    }

    public interface Host {
        int getTabCount();
        int getActiveTabIndex();
        WebView getTab(int index);
        boolean switchToTab(int index);
    }

    private final Activity activity;
    private final Host host;

    public BrowserAgentBridge(@NonNull Activity activity, @NonNull Host host) {
        this.activity = activity;
        this.host = host;
    }

    public boolean attach(@NonNull WebView controlSurface) {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            android.util.Log.w("MIDAD_BROWSER", "AGENT_BRIDGE_UNAVAILABLE");
            return false;
        }
        WebViewCompat.addWebMessageListener(
            controlSurface,
            JS_OBJECT_NAME,
            Collections.singleton(APP_ORIGIN),
            new WebMessageListener() {
                @Override
                public void onPostMessage(
                    @NonNull WebView sourceView,
                    @NonNull WebMessageCompat message,
                    @NonNull Uri sourceOrigin,
                    boolean isMainFrame,
                    @NonNull JavaScriptReplyProxy replyProxy
                ) {
                    if (!isMainFrame || !APP_ORIGIN.equals(sourceOrigin.toString())) {
                        reply(replyProxy, null, false, null, "bridge_origin_rejected");
                        return;
                    }
                    String raw = message.getData();
                    if (raw == null || raw.length() > MAX_MESSAGE_CHARS) {
                        reply(replyProxy, null, false, null, "message_size_invalid");
                        return;
                    }
                    try {
                        JSONObject envelope = new JSONObject(raw);
                        if (envelope.optInt("v", 0) != 1) {
                            reply(replyProxy, envelope.optString("requestId", null), false, null, "protocol_version_unsupported");
                            return;
                        }
                        String requestId = envelope.optString("requestId", "");
                        if (!REQUEST_ID.matcher(requestId).matches()) {
                            reply(replyProxy, null, false, null, "request_id_invalid");
                            return;
                        }
                        JSONObject command = envelope.optJSONObject("command");
                        if (command == null) {
                            reply(replyProxy, requestId, false, null, "command_invalid");
                            return;
                        }
                        dispatch(command, requestId, replyProxy);
                    } catch (JSONException error) {
                        reply(replyProxy, null, false, null, "message_json_invalid");
                    }
                }
            }
        );
        android.util.Log.i("MIDAD_BROWSER", "AGENT_BRIDGE_ATTACHED");
        return true;
    }

    private void dispatch(JSONObject command, String requestId, JavaScriptReplyProxy reply) {
        String type = command.optString("type", "");
        if (!COMMAND_TYPES.contains(type)) {
            reply(reply, requestId, false, null, "command_unsupported");
            return;
        }

        if (type.equals("getTabs")) {
            reply(reply, requestId, true, tabSnapshot(), null);
            return;
        }

        int tabId = command.optInt("tabId", host.getActiveTabIndex());
        if (tabId < 0 || tabId >= Math.min(host.getTabCount(), MAX_TABS)) {
            reply(reply, requestId, false, null, "tab_id_invalid");
            return;
        }
        WebView target = host.getTab(tabId);
        if (target == null || target.getUrl() == null) {
            reply(reply, requestId, false, null, "tab_unavailable");
            return;
        }

        Set<String> allowedOrigins = readAllowedOrigins(command.optJSONArray("allowedOrigins"));
        if (allowedOrigins.isEmpty()) {
            reply(reply, requestId, false, null, "origin_scope_invalid");
            return;
        }
        String currentOrigin = originOf(target.getUrl());
        String commandOrigin = command.optString("origin", "");
        if (currentOrigin == null || !currentOrigin.equals(commandOrigin)) {
            reply(reply, requestId, false, null, "origin_scope_mismatch");
            return;
        }
        if (!allowedOrigins.contains(currentOrigin)) {
            reply(reply, requestId, false, null, "origin_not_allowed");
            return;
        }

        switch (type) {
            case "getTabs":
                reply(reply, requestId, true, tabSnapshot(), null);
                return;
            case "switchTab":
                int next = command.optInt("targetTabId", -1);
                boolean switched = next >= 0 && next < host.getTabCount() && next < MAX_TABS && host.switchToTab(next);
                reply(reply, requestId, switched, switched ? jsonObject("activeTabId", next) : null,
                    switched ? null : "target_tab_invalid");
                return;
            case "navigate":
                String url = command.optString("url", "");
                String destinationOrigin = originOf(url);
                if (destinationOrigin == null || !allowedOrigins.contains(destinationOrigin)) {
                    reply(reply, requestId, false, null, "navigation_origin_not_allowed");
                    return;
                }
                target.loadUrl(url);
                reply(reply, requestId, true, jsonObject("url", url), null);
                return;
            case "getDomSnapshot":
                if (!allowedOrigins.contains(currentOrigin)) {
                    reply(reply, requestId, false, null, "origin_not_allowed");
                    return;
                }
                int maxChars = Math.max(1, Math.min(MAX_SNAPSHOT_CHARS, command.optInt("maxChars", MAX_SNAPSHOT_CHARS)));
                String snapshotScript = "(()=>{const n=document.body.cloneNode(true);n.querySelectorAll('script,style,noscript,template,input,textarea,select,option,button,form,[contenteditable]').forEach(e=>e.remove());return (n.innerText||n.textContent||'').slice(0," + maxChars + ")})()";
                target.evaluateJavascript(snapshotScript, value -> {
                    String text = decodeJsString(value);
                    JSONObject result = new JSONObject();
                    try { result.put("text", text); result.put("source", "native_webview_dom_text"); }
                    catch (JSONException ignored) {}
                    reply(reply, requestId, true, result, null);
                });
                return;
            case "captureScreenshot":
                reply(reply, requestId, true, captureScreenshot(target), null);
                return;
            case "scroll":
                int x = command.optInt("x", 0);
                int y = command.optInt("y", 0);
                if (Math.abs(x) > 10000 || Math.abs(y) > 10000) {
                    reply(reply, requestId, false, null, "scroll_delta_invalid");
                    return;
                }
                target.evaluateJavascript("window.scrollBy(" + x + "," + y + ")", ignored ->
                    reply(reply, requestId, true, jsonObject("scrolled", true), null));
                return;
            case "waitFor":
                waitFor(target, command.optString("selector", ""), command.optInt("timeoutMs", 5000),
                    requestId, reply);
                return;
            case "click":
            case "type":
            case "select":
            case "pressKey":
                if (!allowedOrigins.contains(currentOrigin)) {
                    reply(reply, requestId, false, null, "origin_not_allowed");
                    return;
                }
                if (!validateMutation(command, type)) {
                    reply(reply, requestId, false, null, "command_arguments_invalid");
                    return;
                }
                requireHumanApproval(type, command, currentOrigin, () ->
                    executeMutation(target, type, command, requestId, reply));
                return;
            default:
                reply(reply, requestId, false, null, "command_unsupported");
        }
    }

    private void executeMutation(WebView target, String type, JSONObject command,
                                 String requestId, JavaScriptReplyProxy reply) {
        String script;
        String selector = JSONObject.quote(command.optString("selector", ""));
        switch (type) {
            case "click":
                script = "(()=>{const e=document.querySelector(" + selector + ");if(!e)return {ok:false,error:'selector_not_found'};e.click();return {ok:true}})()";
                break;
            case "type":
                String text = JSONObject.quote(command.optString("text", ""));
                script = "(()=>{const e=document.querySelector(" + selector + ");if(!e)return {ok:false,error:'selector_not_found'};if(!(e instanceof HTMLInputElement||e instanceof HTMLTextAreaElement)||e.type==='password'||e.type==='hidden'||e.type==='file'||e.disabled||e.readOnly)return {ok:false,error:'target_not_editable'};e.focus();e.value=" + text + ";e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()";
                break;
            case "select":
                String value = JSONObject.quote(command.optString("value", ""));
                script = "(()=>{const e=document.querySelector(" + selector + ");if(!e||e.tagName!=='SELECT')return {ok:false,error:'select_not_found'};e.value=" + value + ";e.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true}})()";
                break;
            case "pressKey":
                String key = command.optString("key", "");
                script = "(()=>{const k=" + JSONObject.quote(key) + ";const e=document.activeElement||document.body;e.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:k,bubbles:true}));return {ok:true,synthetic:true}})()";
                break;
            default:
                reply(reply, requestId, false, null, "command_unsupported");
                return;
        }
        target.evaluateJavascript(script, value -> {
            try {
                JSONObject result = new JSONObject(value == null || "null".equals(value) ? "{}" : value);
                boolean ok = result.optBoolean("ok", false);
                reply(reply, requestId, ok, result, ok ? null : result.optString("error", "page_action_failed"));
            } catch (JSONException error) {
                reply(reply, requestId, false, null, "page_action_result_invalid");
            }
        });
    }

    private boolean validateMutation(JSONObject command, String type) {
        if (type.equals("pressKey")) return ALLOWED_KEYS.contains(command.optString("key", ""));
        String selector = command.optString("selector", "");
        if (!SELECTOR.matcher(selector).matches()) return false;
        if (type.equals("type")) return command.has("text") && command.optString("text").length() <= 4000;
        if (type.equals("select")) return command.has("value") && command.optString("value").length() <= 1000;
        return true;
    }

    private void requireHumanApproval(String type, JSONObject command, String origin, Runnable approved) {
        String detail = type.equals("type") ? "إدخال نص في عنصر بالصفحة" :
            type.equals("select") ? "تغيير اختيار في الصفحة" :
            type.equals("pressKey") ? "إرسال مفتاح إلى الصفحة" : "النقر على عنصر في الصفحة";
        String selector = command.optString("selector", "");
        if (!selector.isEmpty()) detail += "\nالعنصر: " + selector;
        new AlertDialog.Builder(activity)
            .setTitle("موافقة MIDAD Agent")
            .setMessage(detail + "\nالنطاق: " + origin + "\n\nالسماح بهذه العملية مرة واحدة؟")
            .setPositiveButton("السماح مرة واحدة", (dialog, which) -> approved.run())
            .setNegativeButton("رفض", (dialog, which) ->
                android.util.Log.i("MIDAD_BROWSER", "AGENT_ACTION_DENIED:" + type))
            .setOnCancelListener(dialog ->
                android.util.Log.i("MIDAD_BROWSER", "AGENT_ACTION_CANCELLED:" + type))
            .show();
    }

    private void waitFor(WebView target, String selector, int timeoutMs,
                         String requestId, JavaScriptReplyProxy reply) {
        if (!SELECTOR.matcher(selector).matches() || timeoutMs < 100 || timeoutMs > 30000) {
            reply(reply, requestId, false, null, "wait_arguments_invalid");
            return;
        }
        Handler handler = new Handler(Looper.getMainLooper());
        long deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs;
        String script = "!!document.querySelector(" + JSONObject.quote(selector) + ")";
        Runnable[] poll = new Runnable[1];
        poll[0] = () -> target.evaluateJavascript(script, value -> {
            if ("true".equals(value)) {
                reply(reply, requestId, true, jsonObject("found", true), null);
            } else if (android.os.SystemClock.elapsedRealtime() >= deadline) {
                reply(reply, requestId, false, null, "wait_timeout");
            } else {
                handler.postDelayed(poll[0], 200);
            }
        });
        poll[0].run();
    }

    private JSONArray tabSnapshot() {
        JSONArray result = new JSONArray();
        for (int i = 0; i < Math.min(host.getTabCount(), MAX_TABS); i++) {
            WebView tab = host.getTab(i);
            if (tab == null) continue;
            JSONObject item = new JSONObject();
            try {
                item.put("id", i);
                String rawUrl = tab.getUrl() == null ? "" : tab.getUrl();
                String safeUrl = rawUrl;
                try {
                    Uri parsed = Uri.parse(rawUrl);
                    String authority = parsed.getHost();
                    if (authority != null && parsed.getPort() != -1) authority += ":" + parsed.getPort();
                    if (authority != null) {
                        safeUrl = parsed.buildUpon().encodedAuthority(authority).clearQuery().fragment(null).build().toString();
                    }
                } catch (Exception ignored) {}
                item.put("url", safeUrl);
                item.put("title", tab.getTitle() == null ? "" : tab.getTitle());
                item.put("active", i == host.getActiveTabIndex());
                result.put(item);
            } catch (JSONException ignored) {}
        }
        return result;
    }

    private JSONObject captureScreenshot(WebView target) {
        try {
            int width = target.getWidth();
            int height = target.getHeight();
            if (width < 1 || height < 1) return jsonObject("captured", false);
            float scale = Math.min(1f, Math.min(1200f / width, 1600f / height));
            int outWidth = Math.max(1, Math.round(width * scale));
            int outHeight = Math.max(1, Math.round(height * scale));
            Bitmap bitmap = Bitmap.createBitmap(outWidth, outHeight, Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(bitmap);
            canvas.scale(scale, scale);
            target.draw(canvas);
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 65, bytes);
            bitmap.recycle();
            return new JSONObject()
                .put("captured", true)
                .put("mimeType", "image/jpeg")
                .put("data", android.util.Base64.encodeToString(bytes.toByteArray(), android.util.Base64.NO_WRAP));
        } catch (Exception error) {
            return jsonObject("captured", false);
        }
    }

    private Set<String> readAllowedOrigins(JSONArray values) {
        Set<String> result = new HashSet<>();
        if (values == null || values.length() < 1 || values.length() > 20) return result;
        for (int i = 0; i < values.length(); i++) {
            String value = values.optString(i, "");
            if (!value.equals(originOf(value))) return Collections.emptySet();
            result.add(value);
        }
        return result;
    }

    private static String originOf(String value) {
        if (value == null || value.length() > 2048) return null;
        try {
            Uri uri = Uri.parse(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getUserInfo() != null || uri.getPort() != -1 && (uri.getPort() < 1 || uri.getPort() > 65535)) return null;
            String host = uri.getHost().toLowerCase();
            int port = uri.getPort();
            String origin = "https://" + host + (port == -1 || port == 443 ? "" : ":" + port);
            return origin;
        } catch (Exception ignored) {
            return null;
        }
    }

    private static String decodeJsString(String value) {
        if (value == null || "null".equals(value)) return "";
        try { return new JSONArray("[" + value + "]").optString(0, ""); }
        catch (JSONException ignored) { return ""; }
    }

    private static void reply(JavaScriptReplyProxy proxy, String requestId,
                              boolean ok, Object result, String error) {
        try {
            JSONObject response = new JSONObject();
            response.put("v", 1);
            if (requestId != null) response.put("requestId", requestId);
            response.put("ok", ok);
            if (result != null) response.put("result", result);
            if (error != null) response.put("error", error);
            proxy.postMessage(response.toString());
        } catch (JSONException ignored) {}
    }
}
