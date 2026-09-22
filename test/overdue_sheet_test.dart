import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:todo_app/widgets/overdue_sheet.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpSheet(WidgetTester tester, Task task) async {
    final provider = TaskProvider();
    provider.addTask(task);
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: provider)],
        child: const MaterialApp(home: Scaffold(body: OverdueSheetTestHost())),
      ),
    );
    await tester.pumpAndSettle();
    return provider;
  }

  testWidgets('+ pulls an overdue task into today', (tester) async {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    final task = Task(
      id: 'overdue-1',
      title: 'Old homework',
      date: DateTime(yesterday.year, yesterday.month, yesterday.day),
    );
    final provider = await pumpSheet(tester, task);

    await tester.tap(find.bySemanticsLabel('Pull into today'));
    await tester.pumpAndSettle();

    final moved = provider.tasks.firstWhere((t) => t.id == 'overdue-1');
    final now = DateTime.now();
    expect(moved.date.day, now.day);
    expect(moved.date.month, now.month);
    expect(moved.date.year, now.year);
    expect(provider.getOverdueTasks(DateTime.now()), isEmpty);
  });

  testWidgets('checkbox completes an overdue task', (tester) async {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    final task = Task(
      id: 'overdue-2',
      title: 'Old reading',
      date: DateTime(yesterday.year, yesterday.month, yesterday.day),
    );
    final provider = await pumpSheet(tester, task);

    await tester.tap(find.bySemanticsLabel('Mark as done'));
    await tester.pumpAndSettle();

    expect(provider.tasks.first.isDone, isTrue);
    expect(provider.getOverdueTasks(DateTime.now()), isEmpty);
  });

  testWidgets('swipe deletes an overdue task', (tester) async {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));
    final task = Task(
      id: 'overdue-3',
      title: 'Old chore',
      date: DateTime(yesterday.year, yesterday.month, yesterday.day),
    );
    final provider = await pumpSheet(tester, task);

    await tester.drag(find.text('Old chore'), const Offset(-500, 0));
    await tester.pumpAndSettle();

    expect(provider.tasks.where((t) => t.id == 'overdue-3'), isEmpty);
  });
}

/// Host that opens the overdue sheet immediately so tests can drive it.
class OverdueSheetTestHost extends StatefulWidget {
  const OverdueSheetTestHost({super.key});

  @override
  State<OverdueSheetTestHost> createState() => _OverdueSheetTestHostState();
}

class _OverdueSheetTestHostState extends State<OverdueSheetTestHost> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) showOverdueSheet(context);
    });
  }

  @override
  Widget build(BuildContext context) => const SizedBox.expand();
}
