package ai.midad.browser;

import android.app.Activity;
import android.app.DownloadManager;
import android.database.Cursor;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputMethodManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.SafeBrowsingResponse;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.URLUtil;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebStorage;
import android.webkit.CookieManager;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;

public final class BrowserActivity extends Activity {
    private static final String MIDAD_HOME =
        "https://appassets.androidplatform.net/assets/public/index.html";
    private static final String SEARCH_URL = "https://www.google.com/search?q=";
    private static final int MAX_TABS = 8;
    private static final String TAB_PREFS = "midad_browser_tabs_v1";
    private static final String TAB_URLS_KEY = "restorable_urls";
    private static final String TAB_INDEX_KEY = "active_index";
    private static final String LAST_CLOSED_TAB_KEY = "last_closed_url";
    private static final String PINNED_TAB_INDEXES_KEY = "pinned_tab_indexes_v1";
    private final List<Boolean> pinnedTabs = new ArrayList<>();
    private static final String LIBRARY_PREFS = "midad_browser_library_v1";
    private static final String HISTORY_PREFS_KEY = "history_v1";
    private static final String BOOKMARKS_PREFS_KEY = "bookmarks_v1";
    private static final int MAX_HISTORY_ITEMS = 100;
    private static final int MAX_BOOKMARK_ITEMS = 100;
    private final List<WebView> tabs = new ArrayList<>();
    private int activeTabIndex = 0;
    private WebView webView;
    private LinearLayout tabsContainer;
    private LinearLayout webViewContainer;
    private TextView tabCount;
    private SharedPreferences tabPrefs;
    private SharedPreferences libraryPrefs;
    private WebViewAssetLoader assetLoader;
    private EditText address;
    private ProgressBar progress;
    private TextView securityState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildBrowserUi();
        tabPrefs = getSharedPreferences(TAB_PREFS, MODE_PRIVATE);
        libraryPrefs = getSharedPreferences(LIBRARY_PREFS, MODE_PRIVATE);
        restoreTabs();
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingIntent(intent);
    }

    private void buildBrowserUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(5, 13, 22));
        root.setPadding(dp(8), dp(4), dp(8), dp(6));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(6), dp(10), dp(6), dp(10));

        TextView brand = new TextView(this);
        brand.setText("MIDAD");
        brand.setTextColor(Color.rgb(115, 229, 251));
        brand.setTextSize(16);
        brand.setLetterSpacing(0.08f);
        brand.setGravity(Gravity.CENTER_VERTICAL);
        brand.setTypeface(null, android.graphics.Typeface.BOLD);
        header.addView(brand, new LinearLayout.LayoutParams(dp(70), dp(44)));

        address = new EditText(this);
        address.setSingleLine(true);
        address.setTextColor(Color.WHITE);
        address.setHintTextColor(Color.LTGRAY);
        address.setHint("ابحث أو أدخل عنوان الموقع");
        address.setTextSize(14);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT |
            android.text.InputType.TYPE_TEXT_VARIATION_URI);
        address.setImeOptions(EditorInfo.IME_ACTION_GO);
        address.setSelectAllOnFocus(true);
        address.setPadding(dp(12), 0, dp(12), 0);
        address.setBackground(round(Color.rgb(15, 32, 46), dp(16)));
        address.setElevation(dp(2));
        LinearLayout.LayoutParams addressParams =
            new LinearLayout.LayoutParams(0, dp(44), 1f);
        addressParams.setMargins(0, 0, dp(8), 0);
        header.addView(address, addressParams);

        Button go = button("اذهب", true);
        header.addView(go, new LinearLayout.LayoutParams(dp(56), dp(44)));
        go.setOnClickListener(v -> navigateFromAddress());
        address.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_GO ||
                (event != null && event.getKeyCode() == android.view.KeyEvent.KEYCODE_ENTER)) {
                navigateFromAddress();
                return true;
            }
            return false;
        });
        root.addView(header);

        LinearLayout controls = new LinearLayout(this);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        controls.setGravity(Gravity.CENTER_VERTICAL);
        controls.setPadding(dp(5), dp(5), dp(5), dp(5));
        controls.setBackground(round(Color.rgb(10, 25, 37), dp(16)));
        LinearLayout.LayoutParams controlsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        controlsParams.setMargins(dp(2), dp(2), dp(2), dp(7));

        addControl(controls, "رجوع", v -> { if (webView.canGoBack()) webView.goBack(); });
        addControl(controls, "تقدم", v -> { if (webView.canGoForward()) webView.goForward(); });
        addControl(controls, "تحديث", v -> webView.reload());
        addControl(controls, "MIDAD AI", v -> webView.loadUrl(MIDAD_HOME));
        addControl(controls, "افتراضي", v -> requestDefaultBrowserRole());
        root.addView(controls, controlsParams);

        tabsContainer = new LinearLayout(this);
        tabsContainer.setOrientation(LinearLayout.HORIZONTAL);
        tabsContainer.setGravity(Gravity.CENTER_VERTICAL);
        tabsContainer.setPadding(dp(7), dp(5), dp(7), dp(5));
        tabsContainer.setBackground(round(Color.rgb(10, 25, 37), dp(16)));
        LinearLayout.LayoutParams tabsParams = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        tabsParams.setMargins(dp(2), 0, dp(2), dp(5));
        tabCount = new TextView(this);
        tabCount.setTextColor(Color.rgb(151, 210, 225));
        tabCount.setTextSize(11);
        tabsContainer.addView(tabCount, new LinearLayout.LayoutParams(0, dp(38), 1f));
        addControl(tabsContainer, "تبويب +", v -> createTab(null));
        addControl(tabsContainer, "التبويبات", v -> showTabPicker());
        addControl(tabsContainer, "إغلاق", v -> closeCurrentTab());
        addControl(tabsContainer, "القائمة", v -> showBrowserMenu());
        root.addView(tabsContainer, tabsParams);

        securityState = new TextView(this);
        securityState.setText("جاهز · التصفح محمي");
        securityState.setTextColor(Color.rgb(145, 170, 186));
        securityState.setTextSize(11);
        securityState.setPadding(dp(12), dp(7), dp(12), dp(7));
        root.addView(securityState);

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setProgress(0);
        root.addView(progress, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(3)));

        webViewContainer = new LinearLayout(this);
        webViewContainer.setOrientation(LinearLayout.VERTICAL);
        root.addView(webViewContainer, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        setContentView(root);
        getWindow().setStatusBarColor(Color.rgb(7, 17, 26));
        getWindow().setNavigationBarColor(Color.rgb(7, 17, 26));
    }

    private void configureWebView(WebView target) {
        if (assetLoader == null) {
            assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        }

        WebSettings settings = target.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setSupportZoom(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(target, false);

        target.setBackgroundColor(Color.WHITE);
        target.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = assetLoader.shouldInterceptRequest(request.getUrl());
                return local != null ? local : super.shouldInterceptRequest(view, request);
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse local = assetLoader.shouldInterceptRequest(Uri.parse(url));
                return local != null ? local : super.shouldInterceptRequest(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return routeNavigation(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return routeNavigation(Uri.parse(url));
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                if (view == webView) {
                    address.setText(url);
                    securityState.setText(url.startsWith(MIDAD_HOME)
                        ? "MIDAD LOCAL · الصفحة الرئيسية متاحة دون اتصال"
                        : (url.startsWith("https://")
                            ? "HTTPS · اتصال مشفّر"
                            : "HTTP · اتصال غير مشفّر"));
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (view == webView) {
                    address.setText(url);
                    progress.setProgress(100);
                }
                if (view.getUrl() != null && view.getUrl().equals(url)) {
                    recordHistory(view, url);
                }
                if (url != null && url.startsWith(MIDAD_HOME)) {
                    android.util.Log.i("MIDAD_BROWSER", "LOCAL_HOME_LOADED");
                } else if (url != null && url.startsWith("https://")) {
                    String host = Uri.parse(url).getHost();
                    if (host != null) {
                        android.util.Log.i("MIDAD_BROWSER", "ONLINE_PAGE_LOADED:" + host);
                    }
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                Toast.makeText(BrowserActivity.this,
                    "تم إيقاف اتصال TLS غير الموثوق", Toast.LENGTH_LONG).show();
                securityState.setText("اتصال TLS مرفوض");
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    Uri failedUri = request.getUrl();
                    if (failedUri != null && "https".equalsIgnoreCase(failedUri.getScheme())) {
                        String host = failedUri.getHost();
                        android.util.Log.e(
                            "MIDAD_BROWSER",
                            "ONLINE_MAIN_FRAME_ERROR:" + (host == null ? "unknown" : host) +
                                ":" + error.getErrorCode()
                        );
                    }
                    if (view == webView) securityState.setText("تعذر تحميل الصفحة");
                }
            }

            @Override
            public void onSafeBrowsingHit(WebView view, WebResourceRequest request,
                                          int threatType, SafeBrowsingResponse callback) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                    callback.backToSafety(true);
                }
                securityState.setText("تم حظر موقع مصنّف خطراً");
            }
        });

        target.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int value) {
                if (view == webView) {
                    progress.setProgress(value);
                    progress.setVisibility(value >= 100 ? View.GONE : View.VISIBLE);
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (title != null && !title.trim().isEmpty()) {
                    if (view == webView) setTitle(title);
                }
            }
        });
        target.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) ->
            confirmDownload(url, userAgent, contentDisposition, mimeType));
    }

    private boolean routeNavigation(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
        if ("https".equals(scheme) || "http".equals(scheme)) return false;
        if ("mailto".equals(scheme) || "tel".equals(scheme)) {
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (Exception ignored) {
                Toast.makeText(this, "لا يوجد تطبيق مناسب لهذا الرابط", Toast.LENGTH_SHORT).show();
            }
        } else {
            Toast.makeText(this, "تم حظر نوع رابط غير مدعوم", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private void navigateFromAddress() {
        String raw = address.getText().toString().trim();
        if (raw.isEmpty()) return;
        String target;
        if (raw.matches("(?i)^https?://.*")) {
            target = raw;
        } else if (raw.matches("(?i)^[a-z][a-z0-9+.-]*:.*")) {
            Toast.makeText(this, "يسمح فقط بروابط HTTP وHTTPS", Toast.LENGTH_SHORT).show();
            return;
        } else if (!raw.contains(" ") && raw.contains(".")) {
            target = "https://" + raw;
        } else {
            try {
                target = SEARCH_URL + URLEncoder.encode(raw, StandardCharsets.UTF_8.name());
            } catch (Exception e) {
                target = SEARCH_URL + raw.replace(" ", "+");
            }
        }
        webView.loadUrl(target);
        saveTabs();
        hideKeyboard();
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent != null && Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            Uri uri = intent.getData();
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if ("https".equals(scheme) || "http".equals(scheme)) {
                webView.loadUrl(uri.toString());
                saveTabs();
                return;
            }
        }
        if (webView == null) createTab(MIDAD_HOME);
    }

    private void createTab(String initialUrl) {
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, "الحد الأقصى 8 تبويبات", Toast.LENGTH_SHORT).show();
            return;
        }
        WebView next = new WebView(this);
        configureWebView(next);
        tabs.add(next);
        pinnedTabs.add(false);
        webViewContainer.addView(next, new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
        switchToTab(tabs.size() - 1);
        next.loadUrl(initialUrl == null || initialUrl.trim().isEmpty() ? MIDAD_HOME : initialUrl);
        saveTabs();
    }

    private void switchToTab(int index) {
        if (index < 0 || index >= tabs.size()) return;
        activeTabIndex = index;
        for (int i = 0; i < tabs.size(); i++) {
            tabs.get(i).setVisibility(i == index ? View.VISIBLE : View.GONE);
        }
        webView = tabs.get(index);
        String currentUrl = webView.getUrl();
        address.setText(currentUrl == null ? "" : currentUrl);
        updateTabCount();
        saveTabs();
    }

    private void closeCurrentTab() {
        if (tabs.isEmpty() || webView == null) return;
        if (activeTabIndex < pinnedTabs.size() && pinnedTabs.get(activeTabIndex)) {
            Toast.makeText(this, "فك تثبيت التبويب قبل إغلاقه", Toast.LENGTH_SHORT).show();
            return;
        }
        String closingUrl = sanitizeRestorableUrl(webView.getUrl());
        tabPrefs.edit().putString(LAST_CLOSED_TAB_KEY, closingUrl).apply();
        if (tabs.size() == 1) {
            webView.loadUrl(MIDAD_HOME);
            saveTabs();
            return;
        }
        WebView closing = tabs.remove(activeTabIndex);
        pinnedTabs.remove(activeTabIndex);
        webViewContainer.removeView(closing);
        closing.stopLoading();
        closing.destroy();
        if (activeTabIndex >= tabs.size()) activeTabIndex = tabs.size() - 1;
        switchToTab(activeTabIndex);
        saveTabs();
    }

    private void restoreLastClosedTab() {
        if (tabPrefs == null) return;
        String savedUrl = tabPrefs.getString(LAST_CLOSED_TAB_KEY, "");
        if (!isHttpUrl(savedUrl)) {
            Toast.makeText(this, "لا يوجد تبويب مغلق للاستعادة", Toast.LENGTH_SHORT).show();
            return;
        }
        if (tabs.size() >= MAX_TABS) {
            Toast.makeText(this, "أغلق تبويباً أولاً لإتاحة مساحة", Toast.LENGTH_SHORT).show();
            return;
        }
        String safeUrl = sanitizeRestorableUrl(savedUrl);
        createTab(safeUrl);
        tabPrefs.edit().remove(LAST_CLOSED_TAB_KEY).apply();
    }

    private void showTabPicker() {
        if (tabs.isEmpty()) return;
        List<Integer> order = new ArrayList<>();
        for (int i = 0; i < tabs.size(); i++) if (pinnedTabs.get(i)) order.add(i);
        for (int i = 0; i < tabs.size(); i++) if (!pinnedTabs.get(i)) order.add(i);
        String[] labels = new String[tabs.size()];
        for (int j = 0; j < order.size(); j++) {
            int i = order.get(j);
            String url = tabs.get(i).getUrl();
            String host = url == null ? "صفحة جديدة" : Uri.parse(url).getHost();
            labels[j] = (pinnedTabs.get(i) ? "📌 " : "") + (j + 1) + ". " + (host == null ? "صفحة" : host);
        }
        new AlertDialog.Builder(this)
            .setTitle("تبويبات MIDAD")
            .setItems(labels, (dialog, which) -> switchToTab(order.get(which)))
            .setNegativeButton("إغلاق", null)
            .show();
    }

    private void togglePinCurrentTab() {
        if (webView == null || !isHttpUrl(webView.getUrl())) {
            Toast.makeText(this, "يمكن تثبيت صفحات HTTP/HTTPS فقط", Toast.LENGTH_SHORT).show();
            return;
        }
        pinnedTabs.set(activeTabIndex, !pinnedTabs.get(activeTabIndex));
        saveTabs();
        Toast.makeText(this, pinnedTabs.get(activeTabIndex) ? "تم تثبيت التبويب" : "تم فك التثبيت", Toast.LENGTH_SHORT).show();
    }

    private void updateTabCount() {
        if (tabCount != null) tabCount.setText("التبويبات " + tabs.size() + "/" + MAX_TABS +
            " · النشط " + (tabs.isEmpty() ? 0 : activeTabIndex + 1));
    }

    private String sanitizeRestorableUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return MIDAD_HOME;
        try {
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            if (!("https".equals(scheme) || "http".equals(scheme)) ||
                uri.getHost() == null || uri.getUserInfo() != null) {
                return MIDAD_HOME;
            }
            return uri.buildUpon().path("/").clearQuery().fragment(null).build().toString();
        } catch (Exception ignored) {
            return MIDAD_HOME;
        }
    }

    private void saveTabs() {
        if (tabPrefs == null || tabs.isEmpty()) return;
        JSONArray urls = new JSONArray();
        JSONArray pinned = new JSONArray();
        for (WebView tab : tabs) urls.put(sanitizeRestorableUrl(tab.getUrl()));
        for (int i = 0; i < pinnedTabs.size(); i++) if (pinnedTabs.get(i)) pinned.put(i);
        tabPrefs.edit().putString(TAB_URLS_KEY, urls.toString())
            .putString(PINNED_TAB_INDEXES_KEY, pinned.toString())
            .putInt(TAB_INDEX_KEY, Math.min(activeTabIndex, tabs.size() - 1)).apply();
    }

    private void restoreTabs() {
        JSONArray urls;
        try {
            urls = new JSONArray(tabPrefs.getString(TAB_URLS_KEY, "[]"));
        } catch (JSONException ignored) {
            urls = new JSONArray();
        }
        int count = Math.min(urls.length(), MAX_TABS);
        for (int i = 0; i < count; i++) {
            String url = sanitizeRestorableUrl(urls.optString(i, MIDAD_HOME));
            WebView restored = new WebView(this);
            configureWebView(restored);
            tabs.add(restored);
            pinnedTabs.add(false);
            webViewContainer.addView(restored, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
            restored.loadUrl(url);
        }
        if (tabs.isEmpty()) {
            createTab(MIDAD_HOME);
        } else {
            JSONArray pinned = new JSONArray();
            try { pinned = new JSONArray(tabPrefs.getString(PINNED_TAB_INDEXES_KEY, "[]")); } catch (JSONException ignored) {}
            for (int i = 0; i < pinned.length(); i++) {
                int index = pinned.optInt(i, -1);
                if (index >= 0 && index < pinnedTabs.size()) pinnedTabs.set(index, true);
            }
            int savedIndex = tabPrefs.getInt(TAB_INDEX_KEY, 0);
            switchToTab(Math.max(0, Math.min(savedIndex, tabs.size() - 1)));
        }
    }


    private boolean isHttpUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.trim().isEmpty()) return false;
        try {
            Uri uri = Uri.parse(rawUrl);
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase();
            return ("https".equals(scheme) || "http".equals(scheme)) &&
                uri.getHost() != null && uri.getUserInfo() == null;
        } catch (Exception ignored) {
            return false;
        }
    }

    private JSONArray readLibraryArray(String key) {
        try {
            return new JSONArray(libraryPrefs.getString(key, "[]"));
        } catch (JSONException ignored) {
            return new JSONArray();
        }
    }

    private void recordHistory(WebView page, String url) {
        if (libraryPrefs == null || !isHttpUrl(url)) return;
        JSONArray oldItems = readLibraryArray(HISTORY_PREFS_KEY);
        JSONArray nextItems = new JSONArray();
        try {
            JSONObject entry = new JSONObject();
            String title = page.getTitle();
            entry.put("title", title == null || title.trim().isEmpty()
                ? Uri.parse(url).getHost() : title.trim());
            entry.put("url", url);
            entry.put("visitedAt", System.currentTimeMillis());
            nextItems.put(entry);
            for (int i = 0; i < oldItems.length() && nextItems.length() < MAX_HISTORY_ITEMS; i++) {
                JSONObject previous = oldItems.optJSONObject(i);
                if (previous != null && !url.equals(previous.optString("url"))) {
                    nextItems.put(previous);
                }
            }
            libraryPrefs.edit().putString(HISTORY_PREFS_KEY, nextItems.toString()).apply();
        } catch (JSONException ignored) {
            android.util.Log.w("MIDAD_BROWSER", "HISTORY_ENTRY_REJECTED");
        }
    }

    private void saveBookmark() {
        if (webView == null || !isHttpUrl(webView.getUrl())) {
            Toast.makeText(this, "لا يوجد عنوان HTTP(S) صالح لحفظه", Toast.LENGTH_SHORT).show();
            return;
        }
        String url = webView.getUrl();
        JSONArray oldItems = readLibraryArray(BOOKMARKS_PREFS_KEY);
        JSONArray nextItems = new JSONArray();
        try {
            JSONObject entry = new JSONObject();
            String title = webView.getTitle();
            entry.put("title", title == null || title.trim().isEmpty()
                ? Uri.parse(url).getHost() : title.trim());
            entry.put("url", url);
            entry.put("savedAt", System.currentTimeMillis());
            nextItems.put(entry);
            for (int i = 0; i < oldItems.length() && nextItems.length() < MAX_BOOKMARK_ITEMS; i++) {
                JSONObject previous = oldItems.optJSONObject(i);
                if (previous != null && !url.equals(previous.optString("url"))) {
                    nextItems.put(previous);
                }
            }
            libraryPrefs.edit().putString(BOOKMARKS_PREFS_KEY, nextItems.toString()).apply();
            Toast.makeText(this, "تم حفظ الإشارة المرجعية", Toast.LENGTH_SHORT).show();
        } catch (JSONException ignored) {
            Toast.makeText(this, "تعذر حفظ الإشارة المرجعية", Toast.LENGTH_SHORT).show();
        }
    }

    private void removeBookmark(String url) {
        JSONArray oldItems = readLibraryArray(BOOKMARKS_PREFS_KEY);
        JSONArray nextItems = new JSONArray();
        for (int i = 0; i < oldItems.length(); i++) {
            JSONObject item = oldItems.optJSONObject(i);
            if (item != null && !url.equals(item.optString("url"))) nextItems.put(item);
        }
        libraryPrefs.edit().putString(BOOKMARKS_PREFS_KEY, nextItems.toString()).apply();
    }

    private void showBookmarks() {
        JSONArray items = readLibraryArray(BOOKMARKS_PREFS_KEY);
        if (items.length() == 0) {
            Toast.makeText(this, "لا توجد إشارات مرجعية بعد", Toast.LENGTH_SHORT).show();
            return;
        }
        String[] labels = new String[items.length()];
        String[] urls = new String[items.length()];
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            labels[i] = item == null ? "عنصر غير صالح" : item.optString("title", item.optString("url"));
            urls[i] = item == null ? "" : item.optString("url");
        }
        new AlertDialog.Builder(this)
            .setTitle("الإشارات المرجعية")
            .setItems(labels, (dialog, which) -> new AlertDialog.Builder(this)
                .setTitle(labels[which])
                .setItems(new String[]{"فتح", "حذف"}, (actionDialog, action) -> {
                    if (action == 0 && isHttpUrl(urls[which])) webView.loadUrl(urls[which]);
                    else if (action == 1) {
                        removeBookmark(urls[which]);
                        Toast.makeText(this, "تم حذف الإشارة", Toast.LENGTH_SHORT).show();
                    }
                }).setNegativeButton("إلغاء", null).show())
            .setNeutralButton("مسح الكل", (dialog, which) -> {
                libraryPrefs.edit().putString(BOOKMARKS_PREFS_KEY, "[]").apply();
                Toast.makeText(this, "تم مسح الإشارات المرجعية", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("إغلاق", null).show();
    }

    private void showHistory() {
        JSONArray items = readLibraryArray(HISTORY_PREFS_KEY);
        if (items.length() == 0) {
            Toast.makeText(this, "السجل فارغ", Toast.LENGTH_SHORT).show();
            return;
        }
        String[] labels = new String[items.length()];
        String[] urls = new String[items.length()];
        for (int i = 0; i < items.length(); i++) {
            JSONObject item = items.optJSONObject(i);
            labels[i] = item == null ? "عنصر غير صالح" : item.optString("title", item.optString("url"));
            urls[i] = item == null ? "" : item.optString("url");
        }
        new AlertDialog.Builder(this)
            .setTitle("سجل التصفح")
            .setItems(labels, (dialog, which) -> {
                if (isHttpUrl(urls[which])) webView.loadUrl(urls[which]);
            })
            .setNeutralButton("مسح السجل", (dialog, which) -> {
                libraryPrefs.edit().putString(HISTORY_PREFS_KEY, "[]").apply();
                Toast.makeText(this, "تم مسح سجل التصفح", Toast.LENGTH_SHORT).show();
            })
            .setNegativeButton("إغلاق", null).show();
    }

    private void showBrowserMenu() {
        String[] actions = {
            pinnedTabs.get(activeTabIndex) ? "فك تثبيت التبويب" : "تثبيت التبويب",
            "استعادة آخر تبويب مغلق", "إضافة إشارة مرجعية", "الإشارات المرجعية", "السجل",
            "التنزيلات", "بحث في الصفحة", "مشاركة الرابط"
        };
        new AlertDialog.Builder(this)
            .setTitle("قائمة MIDAD Browser")
            .setItems(actions, (dialog, which) -> {
                switch (which) {
                    case 0: togglePinCurrentTab(); break;
                    case 1: restoreLastClosedTab(); break;
                    case 2: saveBookmark(); break;
                    case 3: showBookmarks(); break;
                    case 4: showHistory(); break;
                    case 5: showDownloads(); break;
                    case 6: findInPage(); break;
                    case 7: shareCurrentPage(); break;
                    default: break;
                }
            })
            .setNegativeButton("إغلاق", null).show();
    }

    private void findInPage() {
        EditText query = new EditText(this);
        query.setSingleLine(true);
        query.setHint("ابحث داخل الصفحة");
        new AlertDialog.Builder(this)
            .setTitle("بحث في الصفحة")
            .setView(query)
            .setPositiveButton("بحث", (dialog, which) -> {
                String value = query.getText().toString().trim();
                if (!value.isEmpty() && webView != null) webView.findAllAsync(value);
            })
            .setNeutralButton("إلغاء التحديد", (dialog, which) -> {
                if (webView != null) webView.clearMatches();
            })
            .setNegativeButton("إغلاق", null).show();
    }

    private void shareCurrentPage() {
        if (webView == null || !isHttpUrl(webView.getUrl())) return;
        Intent share = new Intent(Intent.ACTION_SEND);
        share.setType("text/plain");
        share.putExtra(Intent.EXTRA_TEXT, webView.getUrl());
        share.putExtra(Intent.EXTRA_SUBJECT, webView.getTitle());
        startActivity(Intent.createChooser(share, "مشاركة الصفحة"));
    }

    private void confirmDownload(String rawUrl, String userAgent, String contentDisposition, String mimeType) {
        if (!isHttpUrl(rawUrl)) {
            Toast.makeText(this, "تم حظر تنزيل بعنوان غير مدعوم", Toast.LENGTH_LONG).show();
            return;
        }
        String fileName = URLUtil.guessFileName(rawUrl, contentDisposition, mimeType);
        fileName = fileName.replaceAll("[\\\\/:*?\"<>|]", "_").trim();
        if (fileName.isEmpty() || ".".equals(fileName) || "..".equals(fileName)) fileName = "midad-download";
        final String safeName = fileName.length() > 120 ? fileName.substring(0, 120) : fileName;
        final String downloadUrl = rawUrl;
        final String downloadAgent = userAgent;
        final String downloadMime = mimeType;
        new AlertDialog.Builder(this)
            .setTitle("تنزيل ملف؟")
            .setMessage(safeName + "\nسيُحفظ داخل مساحة تنزيلات MIDAD الخاصة بالتطبيق.")
            .setPositiveButton("تنزيل", (dialog, which) -> {
                try {
                    DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                    if (manager == null) throw new IllegalStateException("download_manager_unavailable");
                    DownloadManager.Request request = new DownloadManager.Request(Uri.parse(downloadUrl));
                    request.setTitle(safeName);
                    request.setDescription("MIDAD Browser");
                    request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                    request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, safeName);
                    request.setAllowedOverMetered(true);
                    request.setAllowedOverRoaming(false);
                    if (downloadMime != null && !downloadMime.trim().isEmpty()) request.setMimeType(downloadMime);
                    if (downloadAgent != null && !downloadAgent.trim().isEmpty()) {
                        request.addRequestHeader("User-Agent", downloadAgent);
                    }
                    manager.enqueue(request);
                    Toast.makeText(this, "بدأ التنزيل: " + safeName, Toast.LENGTH_LONG).show();
                } catch (Exception error) {
                    Toast.makeText(this, "تعذر بدء التنزيل", Toast.LENGTH_LONG).show();
                    android.util.Log.e("MIDAD_BROWSER", "DOWNLOAD_ENQUEUE_FAILED", error);
                }
            })
            .setNegativeButton("إلغاء", null).show();
    }

    private void showDownloads() {
        DownloadManager manager = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
        if (manager == null) {
            Toast.makeText(this, "مدير التنزيلات غير متاح", Toast.LENGTH_SHORT).show();
            return;
        }
        Cursor cursor = null;
        ArrayList<Long> ids = new ArrayList<>();
        ArrayList<String> labels = new ArrayList<>();
        try {
            cursor = manager.query(new DownloadManager.Query());
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_ID));
                    String title = cursor.getString(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
                    int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                    long soFar = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
                    long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
                    String state = status == DownloadManager.STATUS_SUCCESSFUL ? "مكتمل"
                        : status == DownloadManager.STATUS_FAILED ? "فشل"
                        : status == DownloadManager.STATUS_PAUSED ? "متوقف مؤقتاً" : "قيد التنزيل";
                    labels.add((title == null ? "ملف" : title) + " · " + state +
                        (total > 0 ? " · " + (soFar * 100 / total) + "%" : ""));
                    ids.add(id);
                }
            }
        } catch (Exception error) {
            android.util.Log.e("MIDAD_BROWSER", "DOWNLOAD_QUERY_FAILED", error);
        } finally {
            if (cursor != null) cursor.close();
        }
        if (ids.isEmpty()) {
            Toast.makeText(this, "لا توجد تنزيلات بعد", Toast.LENGTH_SHORT).show();
            return;
        }
        new AlertDialog.Builder(this)
            .setTitle("التنزيلات")
            .setItems(labels.toArray(new String[0]), (dialog, which) -> {
                long id = ids.get(which);
                Uri fileUri = manager.getUriForDownloadedFile(id);
                if (fileUri == null) {
                    Toast.makeText(this, "الملف لم يكتمل تنزيله بعد", Toast.LENGTH_SHORT).show();
                    return;
                }
                String type = manager.getMimeTypeForDownloadedFile(id);
                Intent open = new Intent(Intent.ACTION_VIEW);
                open.setDataAndType(fileUri, type == null ? "*/*" : type);
                open.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                try {
                    startActivity(open);
                } catch (Exception ignored) {
                    Toast.makeText(this, "لا يوجد تطبيق لفتح هذا الملف", Toast.LENGTH_SHORT).show();
                }
            })
            .setNegativeButton("إغلاق", null).show();
    }

    private void flushCookies() {
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onPause() {
        saveTabs();
        flushCookies();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        flushCookies();
        for (WebView tab : tabs) {
            tab.stopLoading();
            tab.destroy();
        }
        tabs.clear();
        super.onDestroy();
    }

    private void requestDefaultBrowserRole() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            RoleManager roleManager = (RoleManager) getSystemService(Context.ROLE_SERVICE);
            if (roleManager != null && roleManager.isRoleAvailable(RoleManager.ROLE_BROWSER)) {
                if (roleManager.isRoleHeld(RoleManager.ROLE_BROWSER)) {
                    Toast.makeText(this, "MIDAD هو المتصفح الافتراضي بالفعل", Toast.LENGTH_SHORT).show();
                } else {
                    startActivityForResult(roleManager.createRequestRoleIntent(RoleManager.ROLE_BROWSER), 4102);
                }
                return;
            }
        }
        Toast.makeText(this, "افتح إعدادات التطبيقات الافتراضية واختر المتصفح", Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == 4102) {
            Toast.makeText(this, resultCode == RESULT_OK
                ? "تم تعيين MIDAD كمتصفح افتراضي"
                : "لم يتم تغيير المتصفح الافتراضي", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    private void hideKeyboard() {
        try {
            InputMethodManager imm = (InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            imm.hideSoftInputFromWindow(address.getWindowToken(), 0);
            address.clearFocus();
        } catch (Exception ignored) {}
    }

    private void addControl(LinearLayout row, String label, View.OnClickListener listener) {
        Button b = button(label, false);
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(0, dp(38), 1f);
        p.setMargins(dp(2), 0, dp(2), 0);
        row.addView(b, p);
        b.setOnClickListener(listener);
    }

    private Button button(String label, boolean primary) {
        Button b = new Button(this);
        b.setText(label);
        b.setTextSize(10);
        b.setTypeface(null, android.graphics.Typeface.BOLD);
        b.setLetterSpacing(0.015f);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setPadding(dp(4), 0, dp(4), 0);
        b.setBackground(round(primary ? Color.rgb(0, 137, 157) : Color.rgb(19, 39, 54), dp(13)));
        b.setElevation(dp(primary ? 3 : 1));
        b.setMinimumHeight(dp(36));
        return b;
    }

    private GradientDrawable round(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(radius);
        return drawable;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }
}
