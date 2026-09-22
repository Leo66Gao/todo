import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:todo_app/widgets/glass_button.dart';
import 'package:todo_app/widgets/task_card.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Widget host(Task task) {
    final provider = TaskProvider();
    provider.addTask(task);
    return MultiProvider(
      providers: [ChangeNotifierProvider.value(value: provider)],
      child: MaterialApp(
          home: Scaffold(body: ListView(children: [TaskCard(task: task)]))),
    );
  }

  BoxBorder checkboxBorder(WidgetTester tester) {
    final box = tester.widget<AnimatedContainer>(
      find.byKey(const ValueKey('task-checkbox')),
    );
    return (box.decoration as BoxDecoration).border!;
  }

  testWidgets('priority colour-codes the complete button border',
      (tester) async {
    await tester.pumpWidget(host(Task(
      id: 't-crit',
      title: 'Critical task',
      date: DateTime(2026, 9, 19),
      priority: TaskPriority.critical,
    )));
    await tester.pumpAndSettle();

    final side = checkboxBorder(tester).bottom;
    expect(side.color, Colors.red.shade600);
    expect(side.width, 2.4);
    // The priority chip itself is gone — priority lives on the border now.
    expect(find.text('Critical'), findsNothing);
  });

  testWidgets('no priority set leaves the border neutral', (tester) async {
    await tester.pumpWidget(host(Task(
      id: 't-plain',
      title: 'Plain task',
      date: DateTime(2026, 9, 19),
    )));
    await tester.pumpAndSettle();

    final element =
        tester.element(find.byKey(const ValueKey('task-checkbox')));
    final side = checkboxBorder(tester).bottom;
    expect(side.color, Theme.of(element).colorScheme.outlineVariant);
    expect(side.width, 2);
  });

  testWidgets('low and medium priorities tint green and yellow',
      (tester) async {
    await tester.pumpWidget(host(Task(
      id: 't-low',
      title: 'Low priority',
      date: DateTime(2026, 9, 19),
      priority: TaskPriority.low,
    )));
    await tester.pumpAndSettle();
    expect(checkboxBorder(tester).bottom.color, Colors.green.shade600);

    // Rebuild with a medium-priority task in a fresh provider.
    await tester.pumpWidget(host(Task(
      id: 't-med',
      title: 'Medium priority',
      date: DateTime(2026, 9, 19),
      priority: TaskPriority.medium,
    )));
    await tester.pumpAndSettle();
    expect(checkboxBorder(tester).bottom.color, Colors.yellow.shade700);
  });

  testWidgets('time chip renders as a solid ink box with the start time',
      (tester) async {
    await tester.pumpWidget(host(Task(
      id: 't-time',
      title: 'Timed task',
      date: DateTime(2026, 9, 19),
      startTime: DateTime(2026, 9, 19, 14, 0),
    )));
    await tester.pumpAndSettle();

    expect(find.text('14.00'), findsOneWidget);
    // Liquid glass is gone from the time chip — a plain box only.
    expect(find.byType(GlassShape), findsNothing);
  });
}
