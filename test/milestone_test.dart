import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/subtask.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/state/task_provider.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  Future<TaskProvider> makeProvider() async {
    SharedPreferences.setMockInitialValues({});
    final provider = TaskProvider();
    await provider.ready;
    return provider;
  }

  Future<void> settle() async {
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
  }

  Task assignment({
    required String id,
    required DateTime date,
    required SubTask subtask,
    bool isDone = false,
  }) {
    return Task(
      id: id,
      title: 'History essay',
      date: date,
      type: TaskType.assignment,
      isDone: isDone,
      subtasks: [subtask],
    );
  }

  Future<TaskProvider> providerWithScheduledSubtask({
    DateTime? parentDate,
    DateTime? milestoneDate,
    bool parentDone = false,
  }) async {
    final provider = await makeProvider();
    provider.addTask(assignment(
      id: 'assignment-1',
      date: parentDate ?? DateTime(2026, 9, 20),
      isDone: parentDone,
      subtask: SubTask(
        id: 'milestone-1',
        title: 'Find sources',
        date: milestoneDate ?? DateTime(2026, 9, 18),
      ),
    ));
    await settle();
    return provider;
  }

  test('scheduled subtasks appear on their calendar date', () async {
    final provider = await makeProvider();
    addTearDown(provider.dispose);
    provider.addTask(assignment(
      id: 'assignment-1',
      date: DateTime(2026, 9, 20),
      subtask: SubTask(id: 'milestone-1', title: 'Find sources'),
    ));
    provider.scheduleSubtask(
        'assignment-1', 'milestone-1', DateTime(2026, 9, 18));
    await settle();

    final milestone = provider
        .getTasksForDate(DateTime(2026, 9, 18))
        .singleWhere((task) => task.id == 'milestone:assignment-1:milestone-1');

    expect(milestone.title, 'Find sources');
    expect(milestone.parentTaskId, 'assignment-1');
    expect(milestone.date, DateTime(2026, 9, 18));
  });

  test('toggling a milestone updates the source subtask', () async {
    final provider = await providerWithScheduledSubtask();
    addTearDown(provider.dispose);

    provider.toggleTask('milestone:assignment-1:milestone-1');
    await settle();

    final parent =
        provider.tasks.singleWhere((task) => task.id == 'assignment-1');
    expect(parent.subtasks.single.isDone, isTrue);
    expect(
      provider
          .getTasksForDate(DateTime(2026, 9, 18))
          .singleWhere((task) => task.parentTaskId == 'assignment-1')
          .isDone,
      isTrue,
    );
  });

  test('a completed parent does not create an overdue milestone', () async {
    final past = DateTime.now().subtract(const Duration(days: 2));
    final provider = await providerWithScheduledSubtask(
      parentDate: past,
      milestoneDate: past,
      parentDone: true,
    );
    addTearDown(provider.dispose);

    expect(provider.getOverdueTasks(DateTime.now()), isEmpty);
  });

  test('rescheduling a milestone updates its source subtask', () async {
    final provider = await providerWithScheduledSubtask();
    addTearDown(provider.dispose);
    final newDate = DateTime(2026, 9, 22);

    provider.rescheduleTask('milestone:assignment-1:milestone-1', newDate);
    await settle();

    final parent =
        provider.tasks.singleWhere((task) => task.id == 'assignment-1');
    expect(parent.subtasks.single.date, newDate);
    expect(
      provider.getTasksForDate(newDate).single.id,
      'milestone:assignment-1:milestone-1',
    );
    expect(provider.getTasksForDate(DateTime(2026, 9, 18)), isEmpty);
  });

  test('deleting a milestone removes the source subtask', () async {
    final provider = await providerWithScheduledSubtask();
    addTearDown(provider.dispose);

    provider.deleteTask('milestone:assignment-1:milestone-1');
    await settle();

    final parent =
        provider.tasks.singleWhere((task) => task.id == 'assignment-1');
    expect(parent.subtasks, isEmpty);
    expect(provider.tasks.any((task) => task.parentTaskId != null), isFalse);
  });

  test('undated subtasks are absent from the calendar task list', () async {
    final provider = await makeProvider();
    addTearDown(provider.dispose);
    provider.addTask(assignment(
      id: 'assignment-2',
      date: DateTime(2026, 9, 20),
      subtask: SubTask(id: 'undated', title: 'No date yet'),
    ));
    await settle();

    expect(provider.tasks.where((task) => task.parentTaskId != null), isEmpty);
  });

  test('subtask dates survive JSON round trips', () {
    final date = DateTime(2026, 9, 18, 15, 30);
    final original = Task(
      id: 'assignment-3',
      title: 'Oral presentation',
      date: DateTime(2026, 9, 20),
      subtasks: [SubTask(id: 'milestone-3', title: 'Rehearse', date: date)],
    );

    final restored = Task.fromJson(original.toJson());

    expect(restored.subtasks.single.date, date);
  });

  test('milestones inherit difficulty from their parent assignment',
      () async {
    SharedPreferences.setMockInitialValues({});
    final provider = TaskProvider();
    addTearDown(provider.dispose);
    provider.addTask(Task(
      id: 'assignment-4',
      title: 'Physics IA',
      date: DateTime(2026, 9, 30),
      type: TaskType.assignment,
      difficulty: 4,
      subtasks: [
        SubTask(id: 'milestone-4', title: 'Draft method', date: DateTime(2026, 9, 24)),
      ],
    ));
    await settle();

    final milestone =
        provider.tasks.firstWhere((task) => task.parentTaskId != null);
    expect(milestone.difficulty, 4);
    expect(milestone.priority, provider.tasks.first.priority);
  });
}
