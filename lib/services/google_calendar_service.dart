import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart'
    show
        TargetPlatform,
        defaultTargetPlatform,
        kDebugMode,
        kIsWeb,
        debugPrint,
        visibleForTesting;
import 'package:flutter/services.dart' show MissingPluginException;
import 'package:google_sign_in/google_sign_in.dart';
import 'package:googleapis/calendar/v3.dart' as calendar;
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import '../firebase_options.dart';
import 'google_calendar_web_auth_stub.dart'
    if (dart.library.html) 'google_calendar_web_auth.dart' as web_auth;

/// Authenticated access to the user's primary Google Calendar.
///
/// Native sessions refresh through GoogleSignIn. `canAccessScopes` is web-only
/// and throws [UnimplementedError] on Android/iOS, so native code uses
/// [GoogleSignIn.requestScopes] plus a real Calendar API check.
///
/// Web sessions cache the short-lived access token in local storage and
/// silently request a replacement from Google Identity Services after reload.
class GoogleCalendarService {
  static bool get isSupported {
    if (kIsWeb) return true;
    return defaultTargetPlatform == TargetPlatform.android ||
        defaultTargetPlatform == TargetPlatform.iOS ||
        defaultTargetPlatform == TargetPlatform.macOS;
  }

  static final GoogleCalendarService _instance =
      GoogleCalendarService._internal();
  factory GoogleCalendarService() => _instance;
  GoogleCalendarService._internal();

  GoogleCalendarService.forTesting(http.Client client,
      {String email = 'test@example.com'}) {
    _replaceClient(client);
    _currentUserEmail = email;
  }

  static const scopes = [calendar.CalendarApi.calendarEventsScope];
  GoogleSignIn? _nativeGoogleSignIn;
  GoogleSignIn get _googleSignIn =>
      _nativeGoogleSignIn ??= GoogleSignIn(scopes: scopes);

  GoogleSignInAccount? _currentUser;
  String? _currentUserEmail;
  calendar.CalendarApi? _calendarApi;
  http.Client? _authClient;
  String? _sessionUid;
  String? _webAccessToken;
  DateTime? _webTokenExpiry;

  GoogleSignInAccount? get currentUser => _currentUser;
  String? get currentUserEmail => _currentUserEmail;
  bool get isConnected => _calendarApi != null && _currentUserEmail != null;

  static String _webSessionKey(String uid) => 'calendar.webSession.$uid';

  /// Connects Calendar for [uid]. Returns the Google account email.
  ///
  /// Native: Google Sign-In plus [GoogleSignIn.requestScopes].
  /// Web: cached token, then a GIS token request. [interactive] must be true
  /// from a button click so the consent popup is allowed.
  Future<String?> authorize({
    required bool interactive,
    String? email,
    String? uid,
  }) async {
    if (!isSupported) return null;
    if (uid != null) _sessionUid = uid;
    if (kIsWeb) {
      return _authorizeWeb(interactive: interactive, email: email, uid: uid);
    }
    try {
      final account = interactive
          ? await _googleSignIn.signIn()
          : await _googleSignIn.signInSilently();
      if (account == null) return null;
      if (interactive && !await _requestNativeCalendarScope()) {
        _setError('Calendar permission denied',
            StateError('Google Calendar access was not granted.'));
        return null;
      }
      _initializeNativeSession(account);
      return account.email;
    } catch (e) {
      _setError(interactive ? 'Sign-in failed' : 'Silent sign-in failed', e);
      return null;
    }
  }

  Future<GoogleSignInAccount?> signIn() async {
    final email = await authorize(interactive: true);
    if (email == null) return null;
    return _currentUser;
  }

  Future<GoogleSignInAccount?> signInSilently() async {
    final email = await authorize(interactive: false);
    if (email == null) return null;
    return _currentUser;
  }

  /// [canAccessScopes] is unimplemented on Android/iOS and throws
  /// `UnimplementedError`. Incremental auth on those platforms is
  /// [GoogleSignIn.requestScopes], which returns true when already granted.
  Future<bool> _requestNativeCalendarScope() async {
    try {
      return await _googleSignIn.requestScopes(scopes);
    } on UnimplementedError {
      return true;
    } on MissingPluginException {
      return true;
    }
  }

  Future<String?> _authorizeWeb({
    required bool interactive,
    String? email,
    String? uid,
  }) async {
    try {
      if (!interactive &&
          await _restoreCachedWebSession(expectedEmail: email)) {
        if (await verifyAccess()) return _currentUserEmail;
      }
      final token = await _requestWebAccessToken(
        interactive: interactive,
        email: email,
      );
      if (token == null) return null;
      final connectedEmail = email ?? _currentUserEmail;
      if (connectedEmail == null) {
        _setError(
            'Sign-in failed',
            StateError(
                'Google Calendar did not return an account email.'));
        return null;
      }
      _applyWebToken(
        email: connectedEmail,
        accessToken: token.accessToken,
        expiry: token.expiry,
        uid: uid,
      );
      await _persistWebSession();
      return connectedEmail;
    } catch (e) {
      _setError(interactive ? 'Sign-in failed' : 'Silent sign-in failed', e);
      return null;
    }
  }

  Future<web_auth.WebCalendarToken?> _requestWebAccessToken({
    required bool interactive,
    String? email,
  }) {
    return web_auth.requestWebCalendarToken(
      clientId: DefaultFirebaseOptions.googleWebClientId,
      scopes: scopes,
      interactive: interactive,
      loginHint: email ?? _currentUserEmail,
    );
  }

  void connectWithAccessToken({
    required String email,
    required String accessToken,
    DateTime? expiry,
    String? uid,
  }) {
    _applyWebToken(
      email: email,
      accessToken: accessToken,
      expiry: expiry ?? DateTime.now().add(const Duration(minutes: 55)),
      uid: uid,
    );
    unawaited(_persistWebSession());
  }

  void _applyWebToken({
    required String email,
    required String accessToken,
    required DateTime expiry,
    String? uid,
  }) {
    if (uid != null) _sessionUid = uid;
    _webAccessToken = accessToken;
    _webTokenExpiry = expiry;
    _replaceClient(_BearerClient(_currentWebToken));
    _currentUser = null;
    _currentUserEmail = email;
  }

  Future<String?> _currentWebToken() async {
    if (_webAccessToken != null && !_webTokenNeedsRefresh) {
      return _webAccessToken;
    }
    if (kIsWeb) {
      final refreshed = await _requestWebAccessToken(
        interactive: false,
        email: _currentUserEmail,
      );
      if (refreshed != null) {
        _webAccessToken = refreshed.accessToken;
        _webTokenExpiry = refreshed.expiry;
        await _persistWebSession();
        return _webAccessToken;
      }
    }
    return _webAccessToken;
  }

  bool get _webTokenNeedsRefresh {
    final expiry = _webTokenExpiry;
    if (_webAccessToken == null || expiry == null) return true;
    return !DateTime.now()
        .isBefore(expiry.subtract(const Duration(minutes: 2)));
  }

  Future<void> _persistWebSession() async {
    final uid = _sessionUid;
    final token = _webAccessToken;
    final email = _currentUserEmail;
    final expiry = _webTokenExpiry;
    if (uid == null || token == null || email == null || expiry == null) {
      return;
    }
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(
        _webSessionKey(uid),
        jsonEncode({
          'token': token,
          'email': email,
          'expiry': expiry.toIso8601String(),
        }),
      );
    } catch (e) {
      if (kDebugMode) debugPrint('Calendar session persist failed: $e');
    }
  }

  Future<bool> _restoreCachedWebSession({String? expectedEmail}) async {
    final uid = _sessionUid;
    if (uid == null) return false;
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(_webSessionKey(uid));
      if (raw == null) return false;
      final data = jsonDecode(raw) as Map<String, dynamic>;
      final token = data['token'] as String?;
      final email = data['email'] as String?;
      final expiryRaw = data['expiry'] as String?;
      if (token == null || email == null || expiryRaw == null) return false;
      if (expectedEmail != null && email != expectedEmail) return false;
      final expiry = DateTime.parse(expiryRaw);
      if (!expiry
          .isAfter(DateTime.now().add(const Duration(minutes: 2)))) {
        return false;
      }
      _applyWebToken(
          email: email, accessToken: token, expiry: expiry, uid: uid);
      return true;
    } catch (e) {
      if (kDebugMode) debugPrint('Calendar session restore failed: $e');
      return false;
    }
  }

  Future<void> _clearCachedWebSession() async {
    final uid = _sessionUid;
    if (uid == null) return;
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.remove(_webSessionKey(uid));
    } catch (_) {}
  }

  @visibleForTesting
  Future<void> saveWebSessionForTesting({
    required String uid,
    required String email,
    required String accessToken,
    required DateTime expiry,
  }) async {
    _sessionUid = uid;
    _currentUserEmail = email;
    _webAccessToken = accessToken;
    _webTokenExpiry = expiry;
    await _persistWebSession();
  }

  @visibleForTesting
  Future<bool> restoreWebSessionForTesting({
    required String uid,
    String? email,
  }) {
    _sessionUid = uid;
    return _restoreCachedWebSession(expectedEmail: email);
  }

  @visibleForTesting
  void forgetMemorySession() {
    _authClient?.close();
    _authClient = null;
    _currentUser = null;
    _currentUserEmail = null;
    _calendarApi = null;
    _webAccessToken = null;
    _webTokenExpiry = null;
    _sessionUid = null;
  }

  /// Clears local credentials. [revoke] is reserved for an explicit Calendar
  /// disconnect; ordinary app sign-out should retain the user's Google grant.
  Future<void> clearSession({bool revoke = false}) async {
    if (!kIsWeb && revoke) {
      try {
        await _googleSignIn.disconnect();
      } catch (e) {
        if (kDebugMode) debugPrint('Calendar session cleanup failed: $e');
      }
    }
    await _clearCachedWebSession();
    _authClient?.close();
    _authClient = null;
    _currentUser = null;
    _currentUserEmail = null;
    _calendarApi = null;
    _webAccessToken = null;
    _webTokenExpiry = null;
    _sessionUid = null;
  }

  Future<void> signOut() async {
    if (!kIsWeb) {
      try {
        await _googleSignIn.signOut();
      } catch (e) {
        if (kDebugMode) debugPrint('Calendar sign-out failed: $e');
      }
    }
    await clearSession();
  }

  void _initializeNativeSession(GoogleSignInAccount user) {
    _replaceClient(GoogleAuthClient(user));
    _currentUser = user;
    _currentUserEmail = user.email;
  }

  void _replaceClient(http.Client client) {
    _authClient?.close();
    _authClient = client;
    _calendarApi = calendar.CalendarApi(client);
  }

  String? _lastError;
  String? get lastError => _lastError;
  int? _lastErrorStatus;
  int? get lastErrorStatus => _lastErrorStatus;

  void _clearError() {
    _lastError = null;
    _lastErrorStatus = null;
  }

  void _setError(String prefix, Object e) {
    _lastError = '$prefix: $e';
    _lastErrorStatus = e is calendar.DetailedApiRequestError ? e.status : null;
    if (_lastErrorStatus == 401) {
      _authClient?.close();
      _authClient = null;
      _currentUser = null;
      _currentUserEmail = null;
      _calendarApi = null;
      _webAccessToken = null;
      _webTokenExpiry = null;
      unawaited(_clearCachedWebSession());
    }
    if (kDebugMode) debugPrint(_lastError);
  }

  /// Performs a real Calendar request before the UI reports a connection.
  /// Account selection alone does not prove that the Calendar scope was
  /// granted, the API is enabled, or the access token is usable.
  Future<bool> verifyAccess() async {
    _clearError();
    final api = _calendarApi;
    if (api == null) {
      _setError('Calendar verification failed',
          StateError('No Google Calendar session is available.'));
      return false;
    }
    try {
      await api.events.list('primary', maxResults: 1, $fields: 'items(id)');
      return true;
    } catch (e) {
      _setError('Calendar verification failed', e);
      return false;
    }
  }

  calendar.Event _event({
    String? eventId,
    required String title,
    String? description,
    required DateTime startTime,
    required int durationMinutes,
    required bool isAllDay,
    String? taskId,
    String? ownerUid,
  }) {
    // Task times are minute-resolution. Dropping fractional seconds keeps the
    // Calendar payload stable across old records and all supported platforms.
    final startAt = startTime.isUtc
        ? DateTime.utc(startTime.year, startTime.month, startTime.day,
            startTime.hour, startTime.minute, startTime.second)
        : DateTime(startTime.year, startTime.month, startTime.day,
            startTime.hour, startTime.minute, startTime.second);
    final event = calendar.Event()
      ..id = eventId
      ..summary = title
      ..description = description;
    final start = calendar.EventDateTime();
    final end = calendar.EventDateTime();
    if (!isAllDay) {
      final safeDuration = durationMinutes > 0 ? durationMinutes : 30;
      final endAt = startAt.add(Duration(minutes: safeDuration));
      start
        ..dateTime = startAt.toUtc()
        ..timeZone = 'UTC';
      end
        ..dateTime = endAt.toUtc()
        ..timeZone = 'UTC';
    } else {
      final dateOnly = DateTime.utc(startAt.year, startAt.month, startAt.day);
      start.date = dateOnly;
      end.date = dateOnly.add(const Duration(days: 1));
    }
    event
      ..start = start
      ..end = end
      ..reminders = (calendar.EventReminders()
        ..useDefault = false
        ..overrides = [
          calendar.EventReminder()
            ..method = 'popup'
            ..minutes = 5,
        ]);
    if (taskId != null && ownerUid != null) {
      event.extendedProperties = (calendar.EventExtendedProperties()
        ..private = {'todoTaskId': taskId, 'firebaseUid': ownerUid});
    }
    return event;
  }

  Future<String?> insertEvent({
    String? eventId,
    required String title,
    String? description,
    required DateTime startTime,
    required int durationMinutes,
    required bool isAllDay,
    String? taskId,
    String? ownerUid,
  }) async {
    _clearError();
    final api = _calendarApi;
    if (api == null) return null;
    final event = _event(
      eventId: eventId,
      title: title,
      description: description,
      startTime: startTime,
      durationMinutes: durationMinutes,
      isAllDay: isAllDay,
      taskId: taskId,
      ownerUid: ownerUid,
    );
    try {
      return (await api.events.insert(event, 'primary')).id;
    } catch (e) {
      final status = e is calendar.DetailedApiRequestError ? e.status : null;
      if (eventId != null && status == 409) {
        try {
          event.id = null;
          // A full replacement clears stale mutually-exclusive `date` and
          // `dateTime` fields left by an older version of the app.
          await api.events.update(event, 'primary', eventId);
          return eventId;
        } catch (patchError) {
          _setError('Insert conflict recovery failed', patchError);
          return null;
        }
      }
      _setError('Insert failed', e);
      return null;
    }
  }

  Future<bool> deleteEvent(String eventId) async {
    _clearError();
    final api = _calendarApi;
    if (api == null) return false;
    try {
      await api.events.delete('primary', eventId);
      return true;
    } catch (e) {
      final status = e is calendar.DetailedApiRequestError ? e.status : null;
      if (status == 404 || status == 410) return true;
      _setError('Delete failed', e);
      return false;
    }
  }

  Future<bool> updateEvent({
    required String eventId,
    required String title,
    String? description,
    required DateTime startTime,
    required int durationMinutes,
    required bool isAllDay,
    String? taskId,
    String? ownerUid,
  }) async {
    _clearError();
    final api = _calendarApi;
    if (api == null) return false;
    final event = _event(
      title: title,
      description: description,
      startTime: startTime,
      durationMinutes: durationMinutes,
      isAllDay: isAllDay,
      taskId: taskId,
      ownerUid: ownerUid,
    );
    try {
      // PATCH preserves omitted nested fields. When a task moves between
      // all-day (`date`) and timed (`dateTime`), that can leave both forms on
      // the event and Calendar rejects it as "Invalid start time". This app
      // owns the exported event, so replace its resource atomically instead.
      await api.events.update(event, 'primary', eventId);
      return true;
    } catch (e) {
      _setError('Update failed', e);
      return false;
    }
  }
}

class GoogleAuthClient extends http.BaseClient {
  GoogleAuthClient(this._account);
  final GoogleSignInAccount _account;
  final http.Client _client = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    request.headers.addAll(await _account.authHeaders);
    return _client.send(request);
  }

  @override
  void close() => _client.close();
}

class _BearerClient extends http.BaseClient {
  _BearerClient(this._token);
  final Future<String?> Function() _token;
  final http.Client _client = http.Client();

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final token = await _token();
    if (token != null) {
      request.headers['Authorization'] = 'Bearer $token';
    }
    return _client.send(request);
  }

  @override
  void close() => _client.close();
}
