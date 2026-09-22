import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/project.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/screens/add_task_sheet.dart';
import 'package:todo_app/state/task_provider.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpSheet(WidgetTester tester) async {
    final provider = TaskProvider();
    provider.addProject(Project(
      id: 'p-phys',
      title: 'Physics HL',
      colorValue: 0xFF66BB6A,
    ));
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: provider)],
        child: const MaterialApp(home: AddTaskSheetTestHost()),
      ),
    );
    await tester.pumpAndSettle();
    return provider;
  }

  testWidgets('default settings show difficulty and priority above subject',
      (tester) async {
    await pumpSheet(tester);

    expect(find.text('Difficulty'), findsOneWidget);
    final priorityTop = tester.getTopLeft(find.text('Priority')).dy;
    final subjectTop = tester.getTopLeft(find.text('No subject')).dy;
    expect(priorityTop < subjectTop, isTrue,
        reason: 'default order places Priority before Subject');
  });

  testWidgets('hidden difficulty disappears and order is honoured',
      (tester) async {
    final provider = await pumpSheet(tester);

    // Close the sheet, change settings, then reopen so the form rebuilds
    // with the new configuration.
    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();
    provider.updateWorkspaceSettings(
      provider.workspaceSettings.copyWith(
        showDifficulty: false,
        fieldOrder: List.unmodifiable(<String>[
          'type',
          'date',
          'time',
          'notes',
          'duration',
          'subject',
          'priority',
          'labels',
          'difficulty',
        ]),
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('open-add-task')));
    await tester.pumpAndSettle();

    expect(find.text('Difficulty'), findsNothing);
    final priorityTop = tester.getTopLeft(find.text('Priority')).dy;
    final subjectTop = tester.getTopLeft(find.text('No subject')).dy;
    expect(subjectTop < priorityTop, isTrue,
        reason: 'reordered order places Subject before Priority');
  });

  testWidgets('priority slider starts dormant and activates at Medium',
      (tester) async {
    await pumpSheet(tester);

    await tester
        .ensureVisible(find.byKey(const ValueKey('priority-dormant')));
    await tester.tap(find.byKey(const ValueKey('priority-dormant')));
    await tester.pumpAndSettle();

    expect(find.text('Medium'), findsOneWidget);
    expect(find.byTooltip('Clear priority'), findsOneWidget);
  });

  testWidgets('activated priority slider slides up to Critical',
      (tester) async {
    await pumpSheet(tester);

    await tester
        .ensureVisible(find.byKey(const ValueKey('priority-dormant')));
    await tester.tap(find.byKey(const ValueKey('priority-dormant')));
    await tester.pumpAndSettle();

    await tester.drag(
        find.byKey(const ValueKey('priority-active')), const Offset(400, 0));
    await tester.pumpAndSettle();

    expect(find.text('Critical'), findsOneWidget);
  });

  testWidgets('clearing priority returns it to none', (tester) async {
    await pumpSheet(tester);

    await tester
        .ensureVisible(find.byKey(const ValueKey('priority-dormant')));
    await tester.tap(find.byKey(const ValueKey('priority-dormant')));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('Clear priority'));
    await tester.pumpAndSettle();

    expect(find.text('Medium'), findsNothing);
    expect(
        find.byKey(const ValueKey('priority-dormant')), findsOneWidget);
  });

  testWidgets('difficulty slider starts dormant and activates at Lvl 2',
      (tester) async {
    await pumpSheet(tester);

    await tester
        .ensureVisible(find.byKey(const ValueKey('difficulty-dormant')));
    await tester.tap(find.byKey(const ValueKey('difficulty-dormant')));
    await tester.pumpAndSettle();

    expect(find.text('Lvl 2'), findsOneWidget);
    expect(find.byTooltip('Clear difficulty'), findsOneWidget);
  });

  testWidgets('creating without touching the sliders stores none / Lvl 1',
      (tester) async {
    final provider = await pumpSheet(tester);

    await tester.enterText(find.byType(TextField).first, 'Untouched task');
    await tester.ensureVisible(find.text('Create Task'));
    await tester.tap(find.text('Create Task'));
    await tester.pumpAndSettle();

    final saved = provider.tasks.single;
    expect(saved.priority, TaskPriority.none);
    expect(saved.difficulty, 1);
  });
}

class AddTaskSheetTestHost extends StatefulWidget {
  const AddTaskSheetTestHost({super.key});

  @override
  State<AddTaskSheetTestHost> createState() => _AddTaskSheetTestHostState();
}

class _AddTaskSheetTestHostState extends State<AddTaskSheetTestHost> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) showAddTaskDialog(context);
    });
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        floatingActionButton: FloatingActionButton(
          key: const ValueKey('open-add-task'),
          onPressed: () => showAddTaskDialog(context),
          child: const Icon(Icons.add),
        ),
      );
}
