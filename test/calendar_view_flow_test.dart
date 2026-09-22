import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/screens/calendar_page.dart';
import 'package:todo_app/state/task_provider.dart';

void main() {
  setUpAll(() {
    GoogleFonts.config.allowRuntimeFetching = false;
  });

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  testWidgets(
      'tapping a day previews it; tapping it again expands; arrows step days',
      (tester) async {
    DateTime selected = DateTime(2026, 9, 20);
    final provider = TaskProvider();
    await provider.ready;

    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: provider,
        child: MaterialApp(
          home: StatefulBuilder(
            builder: (context, setState) => Scaffold(
              body: CalendarPage(
                selectedDate: selected,
                onDateChanged: (d) => setState(() => selected = d),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // Collapsed (month) view: the month grid is showing.
    expect(find.text('September 2026'), findsOneWidget);

    // First tap on a day previews it — grid stays visible.
    final dayCell = find.text('27');
    expect(dayCell, findsWidgets);
    await tester.tap(dayCell.first, warnIfMissed: false);
    await tester.pumpAndSettle();
    expect(selected, DateTime(2026, 9, 27));
    expect(find.text('September 2026'), findsOneWidget,
        reason: 'first tap previews the day and keeps the month grid');

    // Second tap on the now-selected day expands into the full-day view.
    await tester.tap(find.text('27').first, warnIfMissed: false);
    await tester.pumpAndSettle();

    // In full-day view the top arrows step days instead of months.
    await tester.tap(find.byIcon(Icons.chevron_right));
    await tester.pumpAndSettle();
    expect(selected, DateTime(2026, 9, 28),
        reason: 'the right arrow steps one day in full-day view');
    await tester.tap(find.byIcon(Icons.chevron_left));
    await tester.pumpAndSettle();
    expect(selected, DateTime(2026, 9, 27));
  });
}
