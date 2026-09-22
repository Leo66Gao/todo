/// VM/native stub. Flutter web uses [google_calendar_web_auth.dart].
class WebCalendarToken {
  const WebCalendarToken({required this.accessToken, required this.expiry});
  final String accessToken;
  final DateTime expiry;
}

Future<WebCalendarToken?> requestWebCalendarToken({
  required String clientId,
  required List<String> scopes,
  required bool interactive,
  String? loginHint,
}) async =>
    null;
