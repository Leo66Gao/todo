import 'dart:async';
import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/project.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/services/google_calendar_service.dart';
import 'package:todo_app/state/task_provider.dart';

class _TestUser extends Fake implements User {
  @override
  String get uid => 'alice';

  @override
  String? get email => 'alice@example.com';
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<TaskProvider> makeProvider() async {
    SharedPreferences.setMockInitialValues({});
    return TaskProvider();
  }

  Future<void> flush() => Future<void>.delayed(Duration.zero);

  Task sampleTask({String id = 't1', DateTime? date}) => Task(
        id: id,
        title: 'Task $id',
        date: date ?? DateTime(2026, 8, 10),
        durationMinutes: 60,
        remainingMinutes: 60,
      );

  test('malformed saved records are preserved while healthy tasks load',
      () async {
    final healthy = sampleTask();
    SharedPreferences.setMockInitialValues({
      'activeGuestWorkspace': jsonEncode({
        'task:t1': jsonEncode(healthy.toJson()),
        'task:broken': 'invalid json',
        'settings:tags': '42',
      }),
    });
    final provider = TaskProvider();
    addTearDown(provider.dispose);
    await provider.ready;
    expect(provider.tasks.single.id, 't1');
    await provider.saveData();
    final prefs = await SharedPreferences.getInstance();
    final saved = jsonDecode(prefs.getString('activeGuestWorkspace')!);
    expect(saved['task:broken'], 'invalid json');
    expect(saved['settings:tags'], '42');
  });

  test('loadData seeds default projects and tags when empty', () async {
    final provider = await makeProvider();
    await flush();

    expect(provider.projects.length, 2);
    expect(provider.projects[0].id, 'p1');
    expect(provider.projects[0].title, 'Work');
    expect(provider.projects[1].id, 'p2');
    expect(provider.tags, ['General', 'Urgent']);
    expect(provider.tasks, isEmpty);
  });

  test('addTask adds, notifies and persists to SharedPreferences', () async {
    final provider = await makeProvider();
    await flush();

    var notified = 0;
    provider.addListener(() => notified++);

    provider.addTask(sampleTask());
    await flush();
    await flush();

    expect(provider.tasks.length, 1);
    expect(provider.tasks.first.title, 'Task t1');
    expect(notified, greaterThan(0));

    final prefs = await SharedPreferences.getInstance();
    final stored = prefs.getStringList('tasks');
    expect(stored, isNotNull);
    expect(stored!.length, 1);
  });

  test('toggleTask flips completion and persists', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask());
    await flush();
    await flush();

    provider.toggleTask('t1');
    await flush();
    await flush();
    expect(provider.tasks.first.isDone, true);

    provider.toggleTask('t1');
    await flush();
    await flush();
    expect(provider.tasks.first.isDone, false);
  });

  test('completing a calendar task advances its event lifecycle', () async {
    final provider = await makeProvider();
    await flush();
    provider.addTask(Task(
      id: 'calendar-task',
      title: 'Study',
      date: DateTime(2026, 8, 10),
      googleEventId: 'old-event',
      calendarEventRevision: 3,
    ));
    await flush();

    provider.toggleTask('calendar-task');
    await flush();

    expect(provider.tasks.first.isDone, true);
    expect(provider.tasks.first.googleEventId, 'old-event');
    expect(provider.tasks.first.calendarEventRevision, 4,
        reason: 'uncompleting must use a fresh deterministic Calendar ID');
  });

  test('completing then reopening keeps the event so Calendar deletes it',
      () async {
    // Regression: with a shared task key, the reopen replaced the still-pending
    // deletion and the old event leaked into Google Calendar. The event link
    // must survive completion until the delete confirms.
    final provider = await makeProvider();
    await flush();
    provider.addTask(Task(
      id: 'cal',
      title: 'Study',
      date: DateTime(2026, 8, 10),
      googleEventId: 'ev-1',
      calendarEventRevision: 0,
    ));
    await flush();

    provider.toggleTask('cal'); // complete
    await flush();
    expect(provider.tasks.first.isDone, true);
    expect(provider.tasks.first.googleEventId, 'ev-1',
        reason: 'link is kept until the Calendar delete confirms');
    expect(provider.tasks.first.calendarEventRevision, 1);

    provider.toggleTask('cal'); // reopen
    await flush();
    expect(provider.tasks.first.isDone, false);
    // The reopened task keeps the old link until the outbox delete for ev-1
    // is confirmed; a fresh deterministic ID is derived from revision 1.
    expect(provider.tasks.first.calendarEventRevision, 1);
  });

  for (final removeTask in [false, true]) {
    test(
        '${removeTask ? 'deleting' : 'completing'} during an in-flight Calendar export cleans up the created event',
        () async {
      SharedPreferences.setMockInitialValues({});
      final insertStarted = Completer<void>();
      final finishInsert = Completer<void>();
      final deletedIds = <String>[];
      String? insertedId;
      final client = MockClient((request) async {
        if (request.method == 'PUT') {
          return http.Response(
              '{"error":{"code":404,"message":"missing"}}', 404,
              headers: {'content-type': 'application/json'});
        }
        if (request.method == 'POST') {
          insertedId = (jsonDecode(request.body) as Map)['id'] as String;
          insertStarted.complete();
          await finishInsert.future;
          return http.Response(jsonEncode({'id': insertedId}), 200,
              headers: {'content-type': 'application/json'});
        }
        if (request.method == 'DELETE') {
          deletedIds.add(request.url.pathSegments.last);
          return http.Response('', 204);
        }
        return http.Response('{}', 200,
            headers: {'content-type': 'application/json'});
      });
      final provider = TaskProvider(
          calendarService: GoogleCalendarService.forTesting(client,
              email: 'alice@example.com'));
      addTearDown(provider.dispose);
      await provider.ready;
      provider.connectCalendarForTesting(_TestUser());
      provider.addTask(sampleTask(id: 'exporting'));
      await insertStarted.future.timeout(const Duration(seconds: 2));

      if (removeTask) {
        provider.deleteTask('exporting');
      } else {
        provider.toggleTask('exporting');
      }
      finishInsert.complete();
      for (var i = 0; i < 100 && deletedIds.isEmpty; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 10));
      }
      expect(deletedIds, contains(insertedId));
    });
  }

  test('updateTask replaces the task in place', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask());
    await flush();
    await flush();

    provider.updateTask(Task(
      id: 't1',
      title: 'Renamed',
      date: DateTime(2026, 8, 10),
      isDone: true,
    ));
    await flush();
    await flush();

    expect(provider.tasks.length, 1);
    expect(provider.tasks.first.title, 'Renamed');
    expect(provider.tasks.first.isDone, true);
  });

  test('deleteTask removes the task and persists', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask(id: 't1'));
    provider.addTask(sampleTask(id: 't2'));
    await flush();
    await flush();

    provider.deleteTask('t1');
    await flush();
    await flush();

    expect(provider.tasks.length, 1);
    expect(provider.tasks.first.id, 't2');
  });

  test('updateTaskRemainingTime auto-completes when time runs out', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask());
    await flush();
    await flush();

    provider.updateTaskRemainingTime('t1', 0);
    await flush();
    await flush();

    expect(provider.tasks.first.remainingMinutes, 0);
    expect(provider.tasks.first.isDone, true);
  });

  test('subtask add, toggle and delete work', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask());
    await flush();
    await flush();

    provider.addSubtask('t1', 'Outline');
    await flush();
    await flush();
    expect(provider.tasks.first.subtasks.length, 1);

    final subtaskId = provider.tasks.first.subtasks.first.id;
    provider.toggleSubtask('t1', subtaskId);
    await flush();
    await flush();
    expect(provider.tasks.first.subtasks.first.isDone, true);

    provider.deleteSubtask('t1', subtaskId);
    await flush();
    await flush();
    expect(provider.tasks.first.subtasks, isEmpty);
  });

  test('getTasksForDate returns active before completed tasks', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask(id: 'done', date: DateTime(2026, 8, 10)));
    provider.addTask(sampleTask(id: 'active', date: DateTime(2026, 8, 10)));
    await flush();
    await flush();

    provider.toggleTask('done');
    await flush();
    await flush();

    final list = provider.getTasksForDate(DateTime(2026, 8, 10));
    expect(list.map((t) => t.id).toList(), ['active', 'done']);

    expect(provider.getTasksForDate(DateTime(2026, 8, 11)), isEmpty);
  });

  test('reorderTasks moves a task within the visible list', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask(id: 'a'));
    provider.addTask(sampleTask(id: 'b'));
    provider.addTask(sampleTask(id: 'c'));
    await flush();
    await flush();

    final visible = provider.getTasksForDate(DateTime(2026, 8, 10));
    // Move 'a' (index 0) to index 2 in the visible list.
    // Original algorithm: remove 'a' globally, then insert before visible[2]
    // ('c') in the *post-removal* global list → b, a, c.
    provider.reorderTasks(0, 2, visible);
    await flush();
    await flush();

    expect(provider.tasks.map((t) => t.id).toList(), ['b', 'a', 'c']);
  });

  test('deleteProject detaches projectId from tasks', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(Task(
      id: 't1',
      title: 'With project',
      date: DateTime(2026, 8, 10),
      projectId: 'p1',
    ));
    await flush();
    await flush();

    provider.deleteProject('p1');
    await flush();
    await flush();

    expect(provider.projects.any((p) => p.id == 'p1'), false);
    expect(provider.tasks.first.projectId, isNull);
  });

  test('addProject appends and persists', () async {
    final provider = await makeProvider();
    await flush();

    provider
        .addProject(Project(id: 'p3', title: 'School', colorValue: 0xFF00FF00));
    await flush();
    await flush();

    expect(provider.projects.length, 3);
    expect(provider.projects.last.title, 'School');
  });

  test('assignments getter filters by type', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask(id: 'todo'));
    provider.addTask(Task(
      id: 'asg',
      title: 'Homework',
      date: DateTime(2026, 8, 10),
      type: TaskType.assignment,
    ));
    await flush();
    await flush();

    expect(provider.assignments.length, 1);
    expect(provider.assignments.first.id, 'asg');
  });

  test('data survives reload from persisted storage', () async {
    final provider = await makeProvider();
    await flush();

    provider.addTask(sampleTask(id: 'persisted'));
    await flush();
    await flush();

    final reloaded = TaskProvider();
    await flush();
    await flush();

    expect(reloaded.tasks.length, 1);
    expect(reloaded.tasks.first.id, 'persisted');
  });
}
