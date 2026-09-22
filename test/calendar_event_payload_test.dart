import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:todo_app/services/google_calendar_service.dart';

void main() {
  // The app writes minute-resolution events, so its RFC3339 payload should not
  // depend on fractional precision retained by an older task record.
  final rfc3339 = RegExp(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$');

  Future<({Map<String, dynamic> body, String method})> capturedUpdate(
      DateTime start, int durationMinutes,
      {required bool isAllDay}) async {
    final bodies = <String>[];
    final methods = <String>[];
    final client = MockClient((request) async {
      bodies.add(request.body);
      methods.add(request.method);
      return http.Response('{}', 200,
          headers: {'content-type': 'application/json'});
    });
    final service = GoogleCalendarService.forTesting(client);
    final ok = await service.updateEvent(
      eventId: 'ev-1',
      title: 'econ',
      startTime: start,
      durationMinutes: durationMinutes,
      isAllDay: isAllDay,
      taskId: 't1',
      ownerUid: 'u1',
    );
    expect(ok, true);
    return (
      body: jsonDecode(bodies.single) as Map<String, dynamic>,
      method: methods.single,
    );
  }

  test('a task date carrying microseconds is sent with second precision',
      () async {
    // Regression: tasks from the older app can retain microsecond dates.
    final request = await capturedUpdate(
        DateTime(2026, 6, 27, 11, 38, 58, 398, 318), 30,
        isAllDay: false);
    final body = request.body;

    final start = (body['start'] as Map)['dateTime'] as String;
    final end = (body['end'] as Map)['dateTime'] as String;
    expect(start, matches(rfc3339));
    expect(end, matches(rfc3339));
    expect((body['start'] as Map)['timeZone'], 'UTC');
    expect(request.method, 'PUT');
    expect(
      DateTime.parse(end).difference(DateTime.parse(start)),
      const Duration(minutes: 30),
    );
  });

  test('an untimed task stays all-day even when it has a duration', () async {
    final request =
        await capturedUpdate(DateTime(2026, 9, 20), 120, isAllDay: true);
    final body = request.body;

    final start = (body['start'] as Map)['date'] as String;
    final end = (body['end'] as Map)['date'] as String;
    expect(start, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(end, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    expect(
      DateTime.parse(end).difference(DateTime.parse(start)),
      const Duration(days: 1),
    );
    expect((body['start'] as Map).containsKey('dateTime'), false);
  });
}
