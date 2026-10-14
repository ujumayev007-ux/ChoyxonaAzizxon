package com.choyxona.azizxon;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.os.Vibrator;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends Activity {

    private WebView webView;
    private FrameLayout rootLayout;
    private SharedPreferences prefs;

    private static final String PREF_NAME = "choyxona_prefs";
    private static final String KEY_SERVER_URL = "server_url";
    private static final String KEY_ROLE = "selected_role";

    private static final String DEFAULT_SERVER = "http://192.168.1.100:3000";
    private static final String DEFAULT_ROLE = "waiter";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Keep screen on for restaurant waiters & cashiers
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        prefs = getSharedPreferences(PREF_NAME, MODE_PRIVATE);

        rootLayout = new FrameLayout(this);
        rootLayout.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(0xFF0F172A);

        configureWebViewSettings();

        webView.setWebViewClient(new CustomWebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new WebAppInterface(this), "AndroidApp");

        // Long click on title/header area opens server settings
        webView.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                showServerConfigDialog();
                return true;
            }
        });

        rootLayout.addView(webView);
        setContentView(rootLayout);

        // Check if first run
        if (!prefs.contains(KEY_SERVER_URL)) {
            showServerConfigDialog();
        } else {
            loadAppPage();
        }
    }

    private void configureWebViewSettings() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);

        // Set distinctive mobile app user agent
        String customUA = settings.getUserAgentString() + " ChoyxonaAzizxon-AndroidApp/2.1.0";
        settings.setUserAgentString(customUA);
    }

    private String getTargetUrl() {
        String base = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER).trim();
        if (base.endsWith("/")) {
            base = base.substring(0, base.length() - 1);
        }
        String role = prefs.getString(KEY_ROLE, DEFAULT_ROLE);
        if ("cashier".equalsIgnoreCase(role)) {
            return base + "/cashier/";
        } else if ("admin".equalsIgnoreCase(role)) {
            return base + "/admin/";
        } else if ("super-owner".equalsIgnoreCase(role)) {
            return base + "/super-owner/";
        } else if ("kitchen".equalsIgnoreCase(role)) {
            return base + "/kitchen/";
        } else {
            return base + "/waiter/";
        }
    }

    private void loadAppPage() {
        String url = getTargetUrl();
        webView.loadUrl(url);
    }

    public void showServerConfigDialog() {
        AlertDialog.Builder builder = new AlertDialog.Builder(this);
        builder.setTitle("Choyxona Azizxon — Server Sozlamalari");

        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(48, 32, 48, 16);

        TextView labelUrl = new TextView(this);
        labelUrl.setText("Server IP manzili yoki Domen:");
        labelUrl.setTextSize(14);
        labelUrl.setTextColor(0xFFE2E8F0);
        layout.addView(labelUrl);

        final EditText inputUrl = new EditText(this);
        inputUrl.setText(prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER));
        inputUrl.setHint("Masalan: http://192.168.1.100:3000");
        inputUrl.setTextColor(0xFFFFFFFF);
        inputUrl.setSingleLine(true);
        layout.addView(inputUrl);

        TextView labelRole = new TextView(this);
        labelRole.setText("\nUshbu telefon vazifasi (Rol):");
        labelRole.setTextSize(14);
        labelRole.setTextColor(0xFFE2E8F0);
        layout.addView(labelRole);

        final RadioGroup radioGroup = new RadioGroup(this);
        String currentRole = prefs.getString(KEY_ROLE, DEFAULT_ROLE);

        final RadioButton rbWaiter = new RadioButton(this);
        rbWaiter.setText("🍽️ Ofitsiant paneli");
        rbWaiter.setTextColor(0xFFCBD5E1);
        radioGroup.addView(rbWaiter);

        final RadioButton rbCashier = new RadioButton(this);
        rbCashier.setText("💳 Kassa (Kassir) paneli");
        rbCashier.setTextColor(0xFFCBD5E1);
        radioGroup.addView(rbCashier);

        final RadioButton rbAdmin = new RadioButton(this);
        rbAdmin.setText("📊 Admin boshqaruv paneli");
        rbAdmin.setTextColor(0xFFCBD5E1);
        radioGroup.addView(rbAdmin);

        final RadioButton rbOwner = new RadioButton(this);
        rbOwner.setText("👑 Super Owner (HQ)");
        rbOwner.setTextColor(0xFFCBD5E1);
        radioGroup.addView(rbOwner);

        if ("cashier".equalsIgnoreCase(currentRole)) rbCashier.setChecked(true);
        else if ("admin".equalsIgnoreCase(currentRole)) rbAdmin.setChecked(true);
        else if ("super-owner".equalsIgnoreCase(currentRole)) rbOwner.setChecked(true);
        else rbWaiter.setChecked(true);

        layout.addView(radioGroup);
        builder.setView(layout);

        builder.setPositiveButton("Ulanish", new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                String newUrl = inputUrl.getText().toString().trim();
                if (!newUrl.startsWith("http://") && !newUrl.startsWith("https://")) {
                    newUrl = "http://" + newUrl;
                }

                String newRole = "waiter";
                if (rbCashier.isChecked()) newRole = "cashier";
                else if (rbAdmin.isChecked()) newRole = "admin";
                else if (rbOwner.isChecked()) newRole = "super-owner";

                prefs.edit()
                    .putString(KEY_SERVER_URL, newUrl)
                    .putString(KEY_ROLE, newRole)
                    .apply();

                Toast.makeText(MainActivity.this, "Server saqlandi: " + newUrl, Toast.LENGTH_SHORT).show();
                loadAppPage();
            }
        });

        builder.setNegativeButton("Yopish", null);
        AlertDialog dialog = builder.create();
        dialog.show();
    }

    private class CustomWebViewClient extends WebViewClient {
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            showErrorPage(failingUrl, description);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                showErrorPage(request.getUrl().toString(), "Serverga ulanishda xatolik yuz berdi");
            }
        }

        private void showErrorPage(String failingUrl, String errorMsg) {
            String server = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER);
            String errorHtml = "<!DOCTYPE html><html lang='uz'><head><meta charset='UTF-8'><meta name='viewport' content='width=device-width, initial-scale=1.0'>" +
                "<style>" +
                "body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 24px; text-align: center; box-sizing: border-box; }" +
                ".card { background: #1e293b; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 24px; padding: 32px; max-width: 400px; width: 100%; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5); }" +
                ".icon { font-size: 48px; margin-bottom: 16px; }" +
                "h2 { font-size: 20px; font-weight: 800; margin: 0 0 10px 0; color: #fbbf24; }" +
                "p { font-size: 13px; color: #94a3b8; line-height: 1.5; margin: 0 0 20px 0; }" +
                ".code { background: #0f172a; border-radius: 8px; padding: 6px 12px; font-family: monospace; color: #38bdf8; font-size: 12px; display: inline-block; margin-bottom: 20px; word-break: break-all; }" +
                "button { width: 100%; padding: 14px; font-weight: 700; font-size: 13px; border-radius: 14px; border: none; cursor: pointer; margin-bottom: 10px; }" +
                ".btn-retry { background: linear-gradient(135deg, #f59e0b, #d97706); color: #0f172a; }" +
                ".btn-settings { background: #334155; color: #f8fafc; }" +
                "</style></head><body>" +
                "<div class='card'>" +
                "<div class='icon'>📡</div>" +
                "<h2>Serverga Ulanib Bo‘lmadi</h2>" +
                "<p>Iltimos, telefoningiz restoranning Wi-Fi tarmog‘iga ulanganligini va server kompyuter yoqilganligini tekshiring.</p>" +
                "<div class='code'>" + server + "</div>" +
                "<button class='btn-retry' onclick='window.location.reload()'>🔄 Qayta Sinash</button>" +
                "<button class='btn-settings' onclick='AndroidApp.openSettings()'>⚙️ Server Manzilini O‘zgartirish</button>" +
                "</div></body></html>";

            webView.loadDataWithBaseURL(null, errorHtml, "text/html", "UTF-8", null);
        }
    }

    public class WebAppInterface {
        Context mContext;

        WebAppInterface(Context c) {
            mContext = c;
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showServerConfigDialog();
                }
            });
        }

        @JavascriptInterface
        public void vibrate(long milliseconds) {
            Vibrator v = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (v != null) {
                v.vibrate(milliseconds);
            }
        }

        @JavascriptInterface
        public void showToast(String message) {
            Toast.makeText(mContext, message, Toast.LENGTH_SHORT).show();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            } else {
                new AlertDialog.Builder(this)
                    .setTitle("Chiqish")
                    .setMessage("Ilovadan chiqishni xohlaysizmi?")
                    .setPositiveButton("Ha", new DialogInterface.OnClickListener() {
                        @Override
                        public void onClick(DialogInterface dialog, int which) {
                            finish();
                        }
                    })
                    .setNegativeButton("Yo‘q", null)
                    .show();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }
}
