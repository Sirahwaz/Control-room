import { InAppBrowser } from "@capgo/capacitor-inappbrowser";

// Explicitly expose the registered Capacitor plugin to the legacy static WebView surface.
window.MIDADInAppBrowser = InAppBrowser;
