{{flutter_js}}
{{flutter_build_config}}

// The app stores its durable data in Firestore. Loading the current JavaScript
// directly avoids a stale Flutter service worker keeping an older Calendar
// exporter alive after a deployment.
_flutter.loader.load();
