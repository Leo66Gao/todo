import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/models/subtask.dart';
import 'package:todo_app/models/task.dart';

void main() {
  group('Task serialization', () {
    test('round-trips a fully populated task', () {
      final original = Task(
        id: 't1',
        title: 'Write report',
        notes: 'Include charts',
        isDone: false,
        date: DateTime(2026, 8, 10),
        type: TaskType.assignment,
        priority: TaskPriority.high,
        difficulty: 4,
        durationMinutes: 120,
        projectId: 'p1',
        category: 'Work',
        startTime: DateTime(2026, 8, 10, 14, 30),
        remainingMinutes: 45,
        googleEventId: 'evt-123',
        calendarEventRevision: 2,
        subtasks: [
          SubTask(id: 's1', title: 'Outline', isDone: true),
          SubTask(id: 's2', title: 'Draft'),
        ],
      );

      final restored = Task.fromJson(original.toJson());

      expect(restored.id, 't1');
      expect(restored.title, 'Write report');
      expect(restored.notes, 'Include charts');
      expect(restored.isDone, false);
      expect(restored.date, original.date);
      expect(restored.type, TaskType.assignment);
      expect(restored.priority, TaskPriority.high);
      expect(restored.difficulty, 4);
      expect(restored.durationMinutes, 120);
      expect(restored.projectId, 'p1');
      expect(restored.category, 'Work');
      expect(restored.startTime, original.startTime);
      expect(restored.remainingMinutes, 45);
      expect(restored.googleEventId, 'evt-123');
      expect(restored.calendarEventRevision, 2);
      expect(restored.subtasks.length, 2);
      expect(restored.subtasks[0].id, 's1');
      expect(restored.subtasks[0].isDone, true);
      expect(restored.subtasks[1].id, 's2');
      expect(restored.subtasks[1].isDone, false);
    });

    test('legacy JSON without optional fields falls back to defaults', () {
      final restored = Task.fromJson({
        'id': 'legacy-1',
        'title': 'Old task',
        'date': '2025-01-01T00:00:00.000',
      });

      expect(restored.notes, '');
      expect(restored.isDone, false);
      expect(restored.type, TaskType.todo);
      expect(restored.priority, TaskPriority.none);
      expect(restored.difficulty, 1);
      expect(restored.durationMinutes, 0);
      expect(restored.category, 'General');
      expect(restored.startTime, isNull);
      expect(restored.remainingMinutes, 0);
      expect(restored.subtasks, isEmpty);
      expect(restored.googleEventId, isNull);
      expect(restored.calendarEventRevision, 0);
    });

    test('legacy JSON with unknown enum values falls back to defaults', () {
      final restored = Task.fromJson({
        'id': 'legacy-2',
        'title': 'Old task',
        'date': '2025-01-01T00:00:00.000',
        'type': 'TaskType.unknown',
        'priority': 'TaskPriority.unknown',
      });

      expect(restored.type, TaskType.todo);
      expect(restored.priority, TaskPriority.none);
    });

    test('round-trips a plain todo with no optional fields', () {
      final original =
          Task(id: 't2', title: 'Buy milk', date: DateTime(2026, 8, 11));
      final restored = Task.fromJson(original.toJson());

      expect(restored.id, 't2');
      expect(restored.title, 'Buy milk');
      expect(restored.date, original.date);
      expect(restored.priority, TaskPriority.none,
          reason: 'an untouched task keeps the "no priority set" state');
    });
  });

  group('SubTask serialization', () {
    test('round-trips and defaults isDone', () {
      final done = SubTask(id: 's1', title: 'A', isDone: true);
      final restoredDone = SubTask.fromJson(done.toJson());
      expect(restoredDone.isDone, true);

      final legacy = SubTask.fromJson({'id': 's2', 'title': 'B'});
      expect(legacy.isDone, false);
    });
  });
}
