import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/state/calendar_outbox.dart';

void main() {
  Map<String, dynamic> upsert(String taskId, {int revision = 0}) => {
        'operation': 'upsert',
        'taskId': taskId,
        'eventId': 'ev-$taskId',
        'revision': revision,
      };

  Map<String, dynamic> delete(String taskId, String eventId,
          {int revision = 0}) =>
      {
        'operation': 'delete',
        'taskId': taskId,
        'eventId': eventId,
        'revision': revision,
      };

  group('calendarActionKey', () {
    test('upserts for a task share one slot; deletes are per event', () {
      expect(calendarActionKey(upsert('t1')), 'upsert:t1');
      expect(calendarActionKey(delete('t1', 'ev-a')), 'delete:ev-a');
      expect(calendarActionKey(delete('t1', 'ev-b')), 'delete:ev-b');
    });
  });

  group('outbox keying prevents the delete/reopen collision', () {
    test('a reopen (upsert) does not overwrite a pending delete', () {
      // Regression: when completion and reopening shared one task key, the
      // reopen replaced the still-pending deletion and the old event leaked
      // into Google Calendar. Now they occupy separate slots.
      final outbox = <String, Map<String, dynamic>>{};

      // Complete the task -> queue a delete of its event.
      final del = delete('t1', 'ev-t1');
      outbox[calendarActionKey(del)] = del;

      // Reopen before the flush -> queue an upsert for the same task.
      final up = upsert('t1', revision: 1);
      outbox[calendarActionKey(up)] = up;

      expect(outbox.keys, containsAll(['delete:ev-t1', 'upsert:t1']));
      expect(outbox.length, 2,
          reason: 'the pending delete must survive the reopen');
      expect(hasPendingDelete(outbox, 'ev-t1'), isTrue);
      expect(hasPendingUpsert(outbox, 't1'), isTrue);
    });

    test('repeated upserts collapse to the latest snapshot', () {
      final outbox = <String, Map<String, dynamic>>{};
      outbox[calendarActionKey(upsert('t1', revision: 0))] =
          upsert('t1', revision: 0);
      outbox[calendarActionKey(upsert('t1', revision: 2))] =
          upsert('t1', revision: 2);

      expect(outbox.length, 1);
      expect(outbox['upsert:t1']!['revision'], 2);
    });

    test('completion removes the upsert slot before queueing deletes', () {
      // Simulates _enqueueCalendarDeletion: a pending export is cleared and a
      // delete is queued for every event the task may own.
      final outbox = <String, Map<String, dynamic>>{};
      outbox[calendarActionKey(upsert('t1'))] = upsert('t1');
      expect(hasPendingUpsert(outbox, 't1'), isTrue);

      // Complete: drop the export, add a delete keyed by event.
      outbox.remove('upsert:t1');
      final del = delete('t1', 'ev-t1');
      outbox[calendarActionKey(del)] = del;

      expect(hasPendingUpsert(outbox, 't1'), isFalse);
      expect(hasPendingDelete(outbox, 'ev-t1'), isTrue);
    });
  });

  group('normalizeCalendarOutbox', () {
    test('re-keys a legacy raw-taskId outbox under canonical slots', () {
      // Older builds keyed entries by raw task ID.
      final legacy = <String, dynamic>{
        't1': upsert('t1'),
        't2': delete('t2', 'ev-t2'),
      };
      final normalized = normalizeCalendarOutbox(legacy);
      expect(normalized.keys, containsAll(['upsert:t1', 'delete:ev-t2']));
      expect(normalized.containsKey('t1'), isFalse);
      expect(normalized.containsKey('t2'), isFalse);
    });

    test('leaves canonical entries untouched', () {
      final current = <String, dynamic>{
        'upsert:t1': upsert('t1'),
        'delete:ev-t2': delete('t2', 'ev-t2'),
      };
      final normalized = normalizeCalendarOutbox(current);
      expect(normalized.keys, containsAll(['upsert:t1', 'delete:ev-t2']));
      expect(normalized.length, 2);
    });
  });
}
