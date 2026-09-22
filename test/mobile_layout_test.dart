import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/main.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:todo_app/utils/task_formatters.dart';
import 'package:todo_app/widgets/glass_nav_bar.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpPhoneApp(WidgetTester tester) async {
    // A typical modern phone in logical pixels.
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3.0;
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

  testWidgets('New Task pill clears the nav bar and hides on Subjects',
      (tester) async {
    await pumpPhoneApp(tester);

    expect(find.text('New Task'), findsOneWidget);
    final pill = tester.getRect(find.text('New Task'));
    final navBar = tester.getRect(find.byType(GlassNavBar));
    expect(pill.bottom, lessThan(navBar.top),
        reason: 'the pill must sit above the glass nav bar, not on top of it');

    // Subjects owns the "New note" action instead.
    await tester.tap(find.byIcon(Icons.auto_stories_outlined));
    await tester.pumpAndSettle();
    expect(find.text('New Task'), findsNothing);
    expect(find.text('New note'), findsOneWidget);
  });

  testWidgets('daily view titles stay pinned to the left edge', (tester) async {
    // Tablet-ish width so the header slot is much wider than the text: any
    // centering of the title block shows up as an offset from the padding.
    tester.view.physicalSize = const Size(800, 900);
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

    final now = DateTime.now();
    final eyebrow =
        find.textContaining(DateFormat('MMMM yyyy').format(now).toUpperCase());
    final title = find.text(DateFormat('EEEE, d').format(now));
    expect(eyebrow, findsOneWidget);
    expect(title, findsOneWidget);

    final eyebrowLeft = tester.getRect(eyebrow).left;
    final titleLeft = tester.getRect(title).left;
    expect((titleLeft - eyebrowLeft).abs(), lessThan(2),
        reason: 'the greeting and the date must share one left edge');
    expect(titleLeft, lessThan(40),
        reason: 'the date must sit at the header padding, not be centred');
  });

  testWidgets('date and time fields match height once a time is picked',
      (tester) async {
    await pumpPhoneApp(tester);

    await tester.tap(find.text('New Task'));
    await tester.pumpAndSettle();

    // Pick a time so the time field gains its clear (×) button.
    await tester.tap(find.text('No time'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('OK'));
    await tester.pumpAndSettle();

    double fieldHeight(String label) {
      final field = find
          .ancestor(of: find.text(label), matching: find.byType(Container))
          .first;
      return tester.getRect(field).height;
    }

    final dateLabel = DateFormat('MMM d').format(DateTime.now());
    final timeLabel = formatTimeOfDay(TimeOfDay.fromDateTime(DateTime.now()));

    expect(find.text(dateLabel), findsOneWidget);
    expect(fieldHeight(dateLabel), fieldHeight(timeLabel),
        reason: 'the date and time fields must stay the same height');
  });

  testWidgets('subjects empty state scrolls with the page and clears the bar',
      (tester) async {
    await pumpPhoneApp(tester);

    await tester.tap(find.byIcon(Icons.auto_stories_outlined));
    await tester.pumpAndSettle();

    // The page itself scrolls the copy into view (no nested scroll area).
    final emptyText = find.text('Your study notes live here');
    await tester.scrollUntilVisible(emptyText, 240,
        scrollable: find.byType(Scrollable).first);
    await tester.pumpAndSettle();

    expect(emptyText, findsOneWidget);
    final text = tester.getRect(emptyText);
    final navBar = tester.getRect(find.byType(GlassNavBar));
    expect(text.bottom, lessThanOrEqualTo(navBar.top),
        reason: 'scrolling the page must fully reveal the copy');
  });
}
