import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/services/google_calendar_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test('a deterministic insert conflict updates the existing event', () async {
    final requests = <http.Request>[];
    final client = MockClient((request) async {
      requests.add(request);
      if (request.method == 'POST') {
        return http.Response(
          jsonEncode({
            'error': {
              'code': 409,
              'message': 'duplicate',
              'errors': <Object>[],
            }
          }),
          409,
          headers: {'content-type': 'application/json'},
        );
      }
      return http.Response('{}', 200,
          headers: {'content-type': 'application/json'});
    });
    final service = GoogleCalendarService.forTesting(client);

    final id = await service.insertEvent(
      eventId: 'td0123456789abcdef',
      title: 'Study',
      startTime: DateTime(2026, 9, 19, 10),
      durationMinutes: 30,
      isAllDay: false,
      taskId: 'task-1',
      ownerUid: 'alice',
    );

    expect(id, 'td0123456789abcdef');
    expect(requests.map((request) => request.method), ['POST', 'PUT']);
    final inserted = jsonDecode(requests.first.body) as Map<String, dynamic>;
    expect(inserted['id'], 'td0123456789abcdef');
    expect(
      (inserted['extendedProperties'] as Map)['private'],
      {'todoTaskId': 'task-1', 'firebaseUid': 'alice'},
    );
  });

  test('an expired web token clears the connected session', () async {
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 401,
              'message': 'expired',
              'errors': <Object>[],
            }
          }),
          401,
          headers: {'content-type': 'application/json'},
        ));
    final service = GoogleCalendarService.forTesting(client);

    final success = await service.deleteEvent('expired-event');

    expect(success, false);
    expect(service.lastErrorStatus, 401);
    expect(service.isConnected, false);
  });

  test('an already deleted event is a successful delete', () async {
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 404,
              'message': 'gone',
              'errors': <Object>[],
            }
          }),
          404,
          headers: {'content-type': 'application/json'},
        ));
    final service = GoogleCalendarService.forTesting(client);

    expect(await service.deleteEvent('already-gone'), true);
    expect(service.lastError, isNull);
  });

  test('connection verification makes a real primary-calendar request',
      () async {
    http.Request? captured;
    final client = MockClient((request) async {
      captured = request;
      return http.Response('{"items":[]}', 200,
          headers: {'content-type': 'application/json'});
    });
    final service = GoogleCalendarService.forTesting(client);

    expect(await service.verifyAccess(), true);
    expect(captured?.method, 'GET');
    expect(captured?.url.path, contains('/calendars/primary/events'));
    expect(captured?.url.queryParameters['maxResults'], '1');
  });

  test('connection verification exposes Calendar API permission failures',
      () async {
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'error': {
              'code': 403,
              'message': 'Calendar scope missing',
              'errors': <Object>[],
            }
          }),
          403,
          headers: {'content-type': 'application/json'},
        ));
    final service = GoogleCalendarService.forTesting(client);

    expect(await service.verifyAccess(), false);
    expect(service.lastErrorStatus, 403);
    expect(service.lastError, contains('Calendar scope missing'));
  });

  test('a cached web calendar token is restored after a memory reset',
      () async {
    SharedPreferences.setMockInitialValues({});
    final service = GoogleCalendarService.forTesting(MockClient((_) async {
      return http.Response('{"items":[]}', 200,
          headers: {'content-type': 'application/json'});
    }));
    await service.saveWebSessionForTesting(
      uid: 'user-1',
      email: 'alex@example.com',
      accessToken: 'cached-token',
      expiry: DateTime.now().add(const Duration(hours: 1)),
    );
    service.forgetMemorySession();
    expect(service.isConnected, false);

    expect(
      await service.restoreWebSessionForTesting(
        uid: 'user-1',
        email: 'alex@example.com',
      ),
      isTrue,
    );
    expect(service.isConnected, true);
    expect(service.currentUserEmail, 'alex@example.com');
  });

  test('an expired cached web calendar token is not restored', () async {
    SharedPreferences.setMockInitialValues({});
    final service = GoogleCalendarService.forTesting(MockClient((_) async {
      return http.Response('{"items":[]}', 200,
          headers: {'content-type': 'application/json'});
    }));
    await service.saveWebSessionForTesting(
      uid: 'user-1',
      email: 'alex@example.com',
      accessToken: 'stale-token',
      expiry: DateTime.now().subtract(const Duration(minutes: 5)),
    );
    service.forgetMemorySession();

    expect(
      await service.restoreWebSessionForTesting(
        uid: 'user-1',
        email: 'alex@example.com',
      ),
      isFalse,
    );
    expect(service.isConnected, false);
  });

  test('a cached web calendar token is not restored for a different account',
      () async {
    SharedPreferences.setMockInitialValues({});
    final service = GoogleCalendarService.forTesting(MockClient((_) async {
      return http.Response('{"items":[]}', 200,
          headers: {'content-type': 'application/json'});
    }));
    await service.saveWebSessionForTesting(
      uid: 'user-1',
      email: 'alex@example.com',
      accessToken: 'cached-token',
      expiry: DateTime.now().add(const Duration(hours: 1)),
    );
    service.forgetMemorySession();

    expect(
      await service.restoreWebSessionForTesting(
        uid: 'user-1',
        email: 'other@example.com',
      ),
      isFalse,
    );
    expect(service.isConnected, false);
  });
}
