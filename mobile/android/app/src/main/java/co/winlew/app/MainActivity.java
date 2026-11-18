package co.winlew.app;

import android.os.Bundle;
import android.view.View;

import androidx.core.content.ContextCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

/**
 * Capacitor's generated MainActivity is an empty BridgeActivity. The one thing
 * added here is window-inset handling, which targetSdkVersion 35 (Android 15)
 * makes mandatory rather than optional.
 *
 * <p>Up to targetSdk 34 the system inset the app's window for the status and
 * navigation bars, so the WebView never drew underneath them. Targeting 35
 * removes that: the window is laid out edge-to-edge with no opt-out on
 * Android 16+ (the temporary {@code windowOptOutEdgeToEdgeEnforcement} flag is
 * deliberately not used), and {@code android:statusBarColor} /
 * {@code navigationBarColor} become no-ops. Left alone, winlew.co's header
 * would render underneath the clock and the gesture bar would sit on top of
 * the page footer.
 *
 * <p>The site's own CSS {@code env(safe-area-inset-*)} padding (see
 * src/public/assets/nav.css and the native bridge in nav.js) does NOT cover
 * this on Android: Android's WebView only reports a non-zero safe area for a
 * physical display cutout, never for the status or navigation bars, so on a
 * phone without a notch those values stay 0px. They remain correct and in use
 * on iOS, where WKWebView does report them — this listener is the Android half
 * of the same job, and the two do not double up, because once the WebView is
 * padded clear of the cutout region the WebView-reported inset goes to 0 too.
 *
 * <p>Insets are applied as padding on the content view, whose background is
 * painted with the site's own page colour, so the bars read as part of the app
 * instead of exposing the splash drawable behind them.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final View content = findViewById(android.R.id.content);
        // ContextCompat, not Resources.getColor(int, Theme) — that overload is
        // API 23 and minSdkVersion here is 22.
        content.setBackgroundColor(ContextCompat.getColor(this, R.color.winlewSystemBars));

        ViewCompat.setOnApplyWindowInsetsListener(content, (view, windowInsets) -> {
            // systemBars() covers status + navigation (and the caption bar on
            // desktop-mode devices); displayCutout() adds notches and punch
            // holes in landscape, where they fall on the left/right edges.
            // IME insets are deliberately not folded in: the window still pans
            // for the keyboard as it did before, and adding them here would
            // move the content twice.
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
    }
}
