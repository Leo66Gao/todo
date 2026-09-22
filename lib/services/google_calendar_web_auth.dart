import 'dart:async';

import 'package:google_identity_services_web/loader.dart' as gis_loader;
import 'package:google_identity_services_web/oauth2.dart';

class WebCalendarToken {
  const WebCalendarToken({required this.accessToken, required this.expiry});
  final String accessToken;
  final DateTime expiry;
}

/// Requests a Google Calendar access token through GIS.
///
/// [interactive] must be true from a user gesture (Connect). Silent calls use
/// `prompt: none` so a page reload never opens a popup; GIS returns a token
/// when this origin already has a grant for [loginHint].
Future<WebCalendarToken?> requestWebCalendarToken({
  required String clientId,
  required List<String> scopes,
  required bool interactive,
  String? loginHint,
}) async {
  await gis_loader.loadWebSdk();
  final completer = Completer<WebCalendarToken?>();

  void finish(WebCalendarToken? token, [Object? error]) {
    if (completer.isCompleted) return;
    if (error != null) {
      completer.completeError(error);
    } else {
      completer.complete(token);
    }
  }

  void callback(TokenResponse response) {
    if (response.error != null) {
      final desc = response.error_description;
      final msg = desc != null && desc.isNotEmpty
          ? '${response.error}: $desc'
          : '${response.error}';
      finish(null, StateError('Google auth error: $msg'));
      return;
    }
    final token = response.access_token;
    if (token == null || token.isEmpty) {
      finish(null);
      return;
    }
    final lifetime = response.expires_in ?? 3300;
    finish(WebCalendarToken(
      accessToken: token,
      expiry: DateTime.now().add(Duration(seconds: lifetime)),
    ));
  }

  void onError(GoogleIdentityServicesError? error) {
    if (error != null) {
      finish(null, StateError('Google Identity error: ${error.type}'));
    } else {
      finish(null);
    }
  }

  final client = oauth2.initTokenClient(TokenClientConfig(
    client_id: clientId,
    callback: callback,
    scope: scopes,
    include_granted_scopes: true,
    prompt: interactive ? '' : 'none',
    login_hint: loginHint,
    error_callback: onError,
  ));
  client.requestAccessToken();

  try {
    return await completer.future.timeout(
      Duration(seconds: interactive ? 120 : 8),
      onTimeout: () => null,
    );
  } catch (_) {
    return null;
  }
}
