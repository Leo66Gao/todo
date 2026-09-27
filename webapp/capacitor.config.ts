import type { CapacitorConfig } from "@capacitor/cli";

// The Android app is the web app (the static export in out/) in a native
// shell. It keeps the Flutter app's ID, so it installs as an update over it
// and signs in with the Google client already registered for that app.
const config: CapacitorConfig = {
  appId: "com.example.todo_app",
  appName: "Todo",
  webDir: "out",
  backgroundColor: "#f2f2f7",
  android: {
    // Only the app's own pages load in the web view.
    allowMixedContent: false,
  },
  plugins: {
    // Edge to edge: the page draws behind the status and navigation bars and
    // pads itself with env(safe-area-inset-*).
    SystemBars: { insetsHandling: "css", initialViewportFitValueHint: "cover" },
    SplashScreen: { launchAutoHide: false, backgroundColor: "#f2f2f7", showSpinner: false },
    Keyboard: { resize: "native", resizeOnFullScreen: true },
    // Google sign-in runs natively; the Firebase web SDK then signs in with
    // the returned credential, so sync works exactly as on the web.
    FirebaseAuthentication: { skipNativeAuth: true, providers: ["google.com"] },
  },
};

export default config;
