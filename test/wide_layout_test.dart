import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/main.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:todo_app/widgets/glass_nav_bar.dart';
import 'package:todo_app/widgets/weekly_strip.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpWideApp(WidgetTester tester) async {
    // A 13-inch MacBook logical resolution.
    tester.view.physicalSize = const Size(1600, 1000);
    tester.view.devicePixelRatio = 1.0;
    tester.view.padding = FakeViewPadding.zero;
    addTearDown(tester.view.reset);

    final appProvider = TaskProvider();
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

  testWidgets('wide layout shows the sidebar and day-briefing rail',
      (tester) async {
    await pumpWideApp(tester);

    // Sidebar destinations are labelled (icons-only on mobile).
    expect(find.text('Today'), findsOneWidget);
    expect(find.text('Week'), findsOneWidget);
    expect(find.text('Calendar'), findsOneWidget);
    expect(find.text('Assignments'), findsOneWidget);
    expect(find.text('Subjects'), findsOneWidget);
    expect(find.text('PROJECTS'), findsOneWidget);

    // An empty day keeps the very same frame as a day with tasks: the
    // briefing rail and the week strip are still there, only the list is
    // replaced by a calm message.
    expect(find.text('DAY BRIEFING'), findsOneWidget);
    expect(find.byType(WeeklyDateStrip), findsOneWidget);
    final today = DateFormat('MMMM d').format(DateTime.now());
    expect(find.text('Nothing on $today'), findsOneWidget);
    expect(find.text('Add a task'), findsOneWidget);
    // The mobile floating FAB is replaced by the header action.
    expect(find.text('New Task'), findsOneWidget);
    // ...and it sits fully inside the stage (the old empty state rendered
    // without the stage padding, which clipped this pill).
    expect(tester.getRect(find.text('New Task')).top, greaterThan(30));

    // The date lines up with the week strip's own 16px gutter instead of
    // being offset from the pills beneath it.
    final title = DateFormat('EEEE d MMMM').format(DateTime.now());
    final stripLeft = tester.getRect(find.byType(WeeklyDateStrip)).left;
    final titleLeft = tester.getRect(find.text(title)).left;
    expect(titleLeft - stripLeft, 16,
        reason: 'the day title must share the strip\'s left gutter');
  });

  testWidgets('a portrait-ish window falls back to the phone layout',
      (tester) async {
    // Wide in pixels but taller than it is wide: the side rail would squeeze
    // the content, so the app must use the compact layout instead of
    // misaligning.
    tester.view.physicalSize = const Size(1000, 1300);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final appProvider = TaskProvider();
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: appProvider)],
        child: const MyApp(),
      ),
    );
    await appProvider.ready;
    await tester.pumpAndSettle();

    expect(find.text('PROJECTS'), findsNothing,
        reason: 'no sidebar in a portrait window');
    expect(find.byType(GlassNavBar), findsOneWidget,
        reason: 'the phone nav bar is used instead');
    expect(find.text('New Task'), findsOneWidget);
  });

  testWidgets('a narrower landscape window stacks the briefing above the list',
      (tester) async {
    // Landscape, but too narrow for the list + rail side by side.
    tester.view.physicalSize = const Size(1100, 760);
    tester.view.devicePixelRatio = 1.0;
    addTearDown(tester.view.reset);

    final appProvider = TaskProvider();
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: appProvider)],
        child: const MyApp(),
      ),
    );
    await appProvider.ready;
    await tester.pumpAndSettle();

    // Sidebar is present (landscape + wide) and the briefing panel is still
    // shown — it just stacks above the task list instead of sitting beside it.
    expect(find.text('PROJECTS'), findsOneWidget);
    expect(find.text('DAY BRIEFING'), findsOneWidget);
    expect(tester.takeException(), isNull,
        reason: 'no overflow when the window is squarer');
  });

  testWidgets('adding a task in the wide layout updates the briefing rail',
      (tester) async {
    await pumpWideApp(tester);

    await tester.tap(find.text('New Task'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Write essay');
    await tester.ensureVisible(find.text('Create Task'));
    await tester.tap(find.text('Create Task'));
    await tester.pumpAndSettle();

    expect(find.text('Write essay'), findsOneWidget);
    // The briefing rail appears once the day has tasks.
    expect(find.text('DAY BRIEFING'), findsOneWidget);
    expect(find.text('0 of 1 done'), findsOneWidget);
    expect(find.text('Tasks left'), findsOneWidget);
  });
}
