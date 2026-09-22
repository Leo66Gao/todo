import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/main.dart';
import 'package:todo_app/models/task.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:todo_app/widgets/month_grid.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpApp(WidgetTester tester,
      {TaskProvider? provider}) async {
    final appProvider = provider ?? TaskProvider();
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: appProvider)],
        child: const MyApp(),
      ),
    );
    await appProvider.ready;
    await tester.pumpAndSettle();
    return appProvider;
  }

  testWidgets('app boots and shows the dashboard shell', (tester) async {
    await pumpApp(tester);

    // The glass bar is icons-only now.
    // Icons-only bar; the outline glyph is used in both states now.
    expect(find.byIcon(Icons.check_circle_outline), findsOneWidget);
    expect(find.text('Today'), findsNothing);
    expect(find.text('New Task'), findsOneWidget);
    // Contextual empty dashboard state
    expect(find.text('Nothing planned for today'), findsOneWidget);
  });

  testWidgets('adding a task via the FAB creates a card on the dashboard',
      (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('New Task'));
    await tester.pumpAndSettle();

    expect(find.text('New Task'), findsWidgets);
    expect(find.text('What needs to be done?'), findsOneWidget);

    await tester.enterText(find.byType(TextField).first, 'Buy milk');
    // The Create button can sit below the fold on short viewports — the
    // sheet is scrollable, so bring it into view before tapping.
    await tester.ensureVisible(find.text('Create Task'));
    await tester.tap(find.text('Create Task'));
    await tester.pumpAndSettle();

    expect(find.text('Buy milk'), findsOneWidget);
    expect(find.text('Nothing planned for today'), findsNothing);
  });

  testWidgets('completing a task shows the pale state with strikethrough',
      (tester) async {
    await pumpApp(tester);

    await tester.tap(find.text('New Task'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Read book');
    await tester.ensureVisible(find.text('Create Task'));
    await tester.tap(find.text('Create Task'));
    await tester.pumpAndSettle();

    // Tap the custom checkbox (Semantics-labeled in the task card)
    await tester.tap(find.bySemanticsLabel('Mark as done'));
    await tester.pumpAndSettle();

    // Completed tasks collapse into the COMPLETED section — expand it.
    await tester.tap(find.text('COMPLETED'));
    await tester.pumpAndSettle();

    final title = tester.widget<Text>(find.text('Read book'));
    expect(title.style?.decoration, TextDecoration.lineThrough);
  });

  testWidgets('navigation switches between the three tabs', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.byIcon(Icons.school_outlined));
    await tester.pumpAndSettle();
    expect(find.text('No assignments'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(MonthGrid), findsOneWidget);
    expect(find.text('Mon'), findsOneWidget);

    await tester.tap(find.byIcon(Icons.check_circle_outline));
    await tester.pumpAndSettle();
    expect(find.text('Nothing planned for today'), findsOneWidget);
  });

  testWidgets('selecting a calendar day expands its agenda', (tester) async {
    await pumpApp(tester);

    await tester.tap(find.byIcon(Icons.calendar_month_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(MonthGrid), findsOneWidget);

    final day = DateTime.now().day.toString();
    final dayCell = find.descendant(
      of: find.byType(MonthGrid),
      matching: find.text(day),
    );
    await tester.tap(dayCell.first);
    await tester.pumpAndSettle();

    expect(find.byType(MonthGrid), findsNothing);
    expect(find.text('Month'), findsOneWidget);

    await tester.tap(find.text('Month'));
    await tester.pumpAndSettle();
    expect(find.byType(MonthGrid), findsOneWidget);
  });

  testWidgets('settings opens workspace customization controls',
      (tester) async {
    await pumpApp(tester);

    await tester.tap(find.byIcon(Icons.settings_outlined));
    await tester.pumpAndSettle();
    expect(find.text('Settings'), findsOneWidget);
    expect(find.text('Customize tasks'), findsOneWidget);

    await tester.tap(find.text('Customize tasks'));
    await tester.pumpAndSettle();
    expect(find.text('Customize tasks'), findsWidgets);
    expect(find.text('TASK FORM'), findsOneWidget);
    expect(find.text('Priority'), findsOneWidget);
    // Lower sections live in a lazy ListView — scroll to them.
    await tester.scrollUntilVisible(find.text('FIELD ORDER'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('FIELD ORDER'), findsOneWidget);
    await tester.scrollUntilVisible(find.text('Add label'), 200,
        scrollable: find.byType(Scrollable).first);
    expect(find.text('Add label'), findsOneWidget);
  });

  testWidgets('notes editor remains usable when the keyboard is open',
      (tester) async {
    final provider = await pumpApp(
      tester,
      provider: TaskProvider(),
    );
    addTearDown(provider.dispose);
    provider.addTask(Task(
      id: 'notes-widget-test',
      title: 'Long notes task',
      date: DateTime.now(),
      notes:
          List.filled(40, 'A paragraph of notes that should remain readable.')
              .join('\n\n'),
    ));
    await tester.pumpAndSettle();

    final noteIcon = find.byIcon(Icons.sticky_note_2_outlined);
    expect(noteIcon, findsOneWidget);
    await tester.tap(noteIcon);
    await tester.pumpAndSettle();
    expect(find.text('Notes'), findsOneWidget);

    // The notes editor is the WYSIWYG quill editor now.
    expect(find.byType(QuillEditor), findsOneWidget);
    expect(find.byIcon(Icons.format_bold), findsOneWidget);
    await tester.pump();
    expect(tester.takeException(), isNull);
  });
}
