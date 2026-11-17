package ai.midad.browser;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.role.RoleManager;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
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
import java.nio.charset.StandardCharsets;

public final class BrowserActivity extends Activity {
    private static final String MIDAD_HOME =
        "https://appassets.androidplatform.net/assets/public/index.html";
    private static final String SEARCH_URL = "https://www.google.com/search?q=";
    private static final int MAX_TABS = 8;
    private static final String TAB_PREFS = "midad_browser_tabs_v1";
    private static final String TAB_URLS_KEY = "restorable_urls";
    private static final String TAB_INDEX_KEY = "active_index";
    private final List<WebView> tabs = new ArrayList<>();
    private int activeTabIndex = 0;
    private WebView webView;
    private LinearLayout tabsContainer;
    private LinearLayout webViewContainer;
    private TextView tabCount;
    private SharedPreferences tabPrefs;
    private WebViewAssetLoader assetLoader;
    private EditText address;
    private ProgressBar progress;
    private TextView securityState;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        buildBrowserUi();
        tabPrefs = getSharedPreferences(TAB_PREFS, MODE_PRIVATE);
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
        root.setBackgroundColor(Color.rgb(7, 17, 26));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(8), dp(8), dp(8), dp(6));

        TextView brand = new TextView(this);
        brand.setText("MIDAD");
        brand.setTextColor(Color.WHITE);
        brand.setTextSize(17);
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
        address.setBackground(round(Color.rgb(22, 38, 51), dp(14)));
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
        controls.setPadding(dp(8), 0, dp(8), dp(6));

        addControl(controls, "رجوع", v -> { if (webView.canGoBack()) webView.goBack(); });
        addControl(controls, "تقدم", v -> { if (webView.canGoForward()) webView.goForward(); });
        addControl(controls, "تحديث", v -> webView.reload());
        addControl(controls, "MIDAD AI", v -> webView.loadUrl(MIDAD_HOME));
        addControl(controls, "افتراضي", v -> requestDefaultBrowserRole());
        root.addView(controls);

        tabsContainer = new LinearLayout(this);
        tabsContainer.setOrientation(LinearLayout.HORIZONTAL);
        tabsContainer.setGravity(Gravity.CENTER_VERTICAL);
        tabsContainer.setPadding(dp(8), 0, dp(8), dp(6));
        tabCount = new TextView(this);
        tabCount.setTextColor(Color.rgb(151, 210, 225));
        tabCount.setTextSize(11);
        tabsContainer.addView(tabCount, new LinearLayout.LayoutParams(0, dp(38), 1f));
        addControl(tabsContainer, "تبويب +", v -> createTab(null));
        addControl(tabsContainer, "التبويبات", v -> showTabPicker());
        addControl(tabsContainer, "إغلاق", v -> closeCurrentTab());
        root.addView(tabsContainer);

        securityState = new TextView(this);
        securityState.setText("جاهز · التصفح محمي");
        securityState.setTextColor(Color.rgb(151, 177, 192));
        securityState.setTextSize(11);
        securityState.setPadding(dp(12), dp(2), dp(12), dp(4));
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
        if (tabs.isEmpty()) return;
        if (tabs.size() == 1) {
            webView.loadUrl(MIDAD_HOME);
            saveTabs();
            return;
        }
        WebView closing = tabs.remove(activeTabIndex);
        webViewContainer.removeView(closing);
        closing.stopLoading();
        closing.destroy();
        if (activeTabIndex >= tabs.size()) activeTabIndex = tabs.size() - 1;
        switchToTab(activeTabIndex);
        saveTabs();
    }

    private void showTabPicker() {
        if (tabs.isEmpty()) return;
        String[] labels = new String[tabs.size()];
        for (int i = 0; i < tabs.size(); i++) {
            String url = tabs.get(i).getUrl();
            labels[i] = (i + 1) + ". " + (url == null ? "صفحة جديدة" : url);
        }
        new AlertDialog.Builder(this)
            .setTitle("تبويبات MIDAD")
            .setItems(labels, (dialog, which) -> switchToTab(which))
            .setNegativeButton("إغلاق", null)
            .show();
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
        for (WebView tab : tabs) urls.put(sanitizeRestorableUrl(tab.getUrl()));
        tabPrefs.edit().putString(TAB_URLS_KEY, urls.toString())
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
            webViewContainer.addView(restored, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT));
            restored.loadUrl(url);
        }
        if (tabs.isEmpty()) {
            createTab(MIDAD_HOME);
        } else {
            int savedIndex = tabPrefs.getInt(TAB_INDEX_KEY, 0);
            switchToTab(Math.max(0, Math.min(savedIndex, tabs.size() - 1)));
        }
    }

    @Override
    protected void onPause() {
        saveTabs();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
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
        b.setTextSize(11);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setPadding(dp(4), 0, dp(4), 0);
        b.setBackground(round(primary ? Color.rgb(0, 133, 151) : Color.rgb(26, 48, 64), dp(12)));
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
