package org.christchurchhowick.leavemanager;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.NoCredentialException;

import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

import org.json.JSONObject;

/**
 * Leave Manager for Android.
 *
 * The app shows the Leave Manager website full screen, so staff and the Administrator always get the
 * newest version without updating the app. It adds the things a phone app should do: proper printing,
 * the back button, links opening in the browser, an offline screen and a status bar in your own colour.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = BuildConfig.APP_URL;
    /** Reload the leave data when the app comes back after this long in the background. */
    private static final long REFRESH_AFTER_MS = 10 * 60 * 1000;

    private WebView web;
    private long pausedAt = 0;
    private boolean showingOffline = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " LeaveManagerApp/" + BuildConfig.VERSION_NAME);

        web.addJavascriptInterface(new Bridge(), "LeaveApp");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());

        if (state != null) web.restoreState(state);
        else web.loadUrl(APP_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        pausedAt = SystemClock.elapsedRealtime();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        if (pausedAt > 0 && SystemClock.elapsedRealtime() - pausedAt > REFRESH_AFTER_MS) {
            if (showingOffline) web.loadUrl(APP_URL); else web.reload();
        }
        pausedAt = 0;
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Let Leave Manager close an open window or go back to Overview first.
        web.evaluateJavascript("(window.leaveAppBack && window.leaveAppBack()) ? 'y' : 'n'", result -> {
            if (result != null && result.contains("y")) return;
            if (web.canGoBack()) web.goBack();
            else MainActivity.super.onBackPressed();
        });
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    private boolean isAppUrl(Uri uri) {
        return uri != null && uri.toString().startsWith(APP_URL);
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone can open that link.", Toast.LENGTH_LONG).show();
        }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri uri = req.getUrl();
            if (isAppUrl(uri)) return false;
            // Google Form, Google Sheet, staff guide, app download, email links: open in the right app.
            openOutside(uri);
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && url.startsWith(APP_URL)) showingOffline = false;
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            showingOffline = true;
            view.loadDataWithBaseURL(null, OFFLINE_PAGE, "text/html", "utf-8", null);
        }
    }

    /** Functions the Leave Manager page can call, as window.LeaveApp.*. */
    private class Bridge {
        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                if (pm == null) return;
                PrintAttributes attrs = new PrintAttributes.Builder()
                        .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build();
                pm.print("Leave Manager report", web.createPrintDocumentAdapter("Leave report"), attrs);
            });
        }

        @JavascriptInterface
        public void setColour(String hex) {
            runOnUiThread(() -> tintBars(hex));
        }

        /** Shows Android's Google account picker; the result goes back to the page. */
        @JavascriptInterface
        public void googleSignIn(String webClientId) {
            runOnUiThread(() -> startGoogleSignIn(webClientId));
        }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(APP_URL));
        }
    }

    private void startGoogleSignIn(String webClientId) {
        if (webClientId == null || webClientId.trim().isEmpty()) {
            sendToPage("leaveAppGoogleError", "Sign in with Google isn't switched on yet. Use your email and PIN.");
            return;
        }
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(webClientId.trim()).build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        CredentialManager cm = CredentialManager.create(this);
        cm.getCredentialAsync(this, request, new CancellationSignal(), this::runOnUiThread,
                new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override
                    public void onResult(GetCredentialResponse response) {
                        Credential c = response.getCredential();
                        if (c instanceof CustomCredential) {
                            try {
                                GoogleIdTokenCredential g = GoogleIdTokenCredential.createFrom(c.getData());
                                sendToPage("leaveAppGoogle", g.getIdToken());
                                return;
                            } catch (Exception e) { /* fall through */ }
                        }
                        sendToPage("leaveAppGoogleError", "Google sign-in didn't return an account. Please try again.");
                    }

                    @Override
                    public void onError(GetCredentialException e) {
                        if (e instanceof GetCredentialCancellationException) return; // they closed the picker
                        String msg = (e instanceof NoCredentialException)
                                ? "No Google account is set up on this phone. Add one in Settings → Accounts, or sign in with your email and PIN."
                                : "Google sign-in didn't work on this phone. Sign in with your email and PIN instead.";
                        sendToPage("leaveAppGoogleError", msg);
                    }
                });
    }

    /** Calls window.<fn>(text) in the page, with the text safely quoted. */
    private void sendToPage(String fn, String text) {
        String arg = JSONObject.quote(text == null ? "" : text);
        web.evaluateJavascript("window." + fn + " && window." + fn + "(" + arg + ")", null);
    }

    /** Status bar in the signed-in person's colour, slightly darker; light icons on dark colours. */
    private void tintBars(String hex) {
        Window w = getWindow();
        int colour;
        try {
            colour = (hex == null || hex.isEmpty()) ? Color.parseColor("#0F4F43") : Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            colour = Color.parseColor("#0F4F43");
        }
        float[] hsv = new float[3];
        Color.colorToHSV(colour, hsv);
        hsv[2] = Math.max(0f, hsv[2] * 0.85f);
        int bar = Color.HSVToColor(hsv);
        w.setStatusBarColor(bar);
        double lum = 0.299 * Color.red(bar) + 0.587 * Color.green(bar) + 0.114 * Color.blue(bar);
        View decor = w.getDecorView();
        int flags = decor.getSystemUiVisibility();
        if (lum > 170) flags |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        else flags &= ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        decor.setSystemUiVisibility(flags);
    }

    private static final String OFFLINE_PAGE =
            "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>" +
            "<style>body{font-family:sans-serif;background:#F4F6F5;color:#17211F;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:24px}" +
            "@media (prefers-color-scheme:dark){body{background:#0D1513;color:#E3EDE9}}" +
            "h1{font-size:1.3rem}p{color:#5E6B68;max-width:280px;margin:8px auto 20px}" +
            "button{background:#0F4F43;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-size:1rem}</style></head>" +
            "<body><div><h1>You're offline</h1><p>Leave Manager needs the internet to show the latest leave. Check your Wi-Fi or mobile data.</p>" +
            "<button onclick='LeaveApp.retry()'>Try again</button></div></body></html>";
}
