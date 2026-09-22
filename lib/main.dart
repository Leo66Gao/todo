import 'package:flutter/material.dart';
import 'package:firebase_core/firebase_core.dart';
import 'firebase_options.dart';
import 'screens/subjects_page.dart';
import 'widgets/glass_button.dart';
import 'widgets/liquid_glass.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:provider/provider.dart';

import 'screens/add_task_sheet.dart';
import 'screens/assignments_page.dart';
import 'screens/calendar_page.dart';
import 'screens/dashboard_page.dart';
import 'screens/week_page.dart';
import 'screens/wide_today_view.dart';
import 'dart:async';
import 'state/task_provider.dart';
import 'theme/app_theme.dart';
import 'widgets/glass_nav_bar.dart';
import 'widgets/workspace_sidebar.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp(
        options: DefaultFirebaseOptions.currentPlatform);
  } catch (error) {
    debugPrint('Cloud initialization unavailable: $error');
  }
  unawaited(LiquidGlass.ensureLoaded());
  runApp(
    MultiProvider(
      providers: [ChangeNotifierProvider(create: (_) => TaskProvider())],
      child: const MyApp(),
    ),
  );
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    // Rebuild only when the appearance setting actually changes.
    final themeMode = context.select<TaskProvider, ThemeMode>((p) =>
        switch (p.workspaceSettings.themeMode) {
          'light' => ThemeMode.light,
          'dark' => ThemeMode.dark,
          _ => ThemeMode.system,
        });
    return MaterialApp(
      title: 'Minimal ToDo',
      debugShowCheckedModeBanner: false,
      theme: buildAppTheme(),
      darkTheme: buildAppDarkTheme(),
      themeMode: themeMode,
      themeAnimationDuration: const Duration(milliseconds: 250),
      localizationsDelegates: const [FlutterQuillLocalizations.delegate],
      home: const HomePage(),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  HomePageState createState() => HomePageState();
}

class HomePageState extends State<HomePage> {
  int _currentIndex = 0;
  DateTime _selectedDate = DateTime.now();

  void _onDateChanged(DateTime date) {
    setState(() {
      _selectedDate = date;
    });
  }

  @override
  Widget build(BuildContext context) {
    final pages = <Widget>[
      DashboardPage(selectedDate: _selectedDate, onDateChanged: _onDateChanged),
      WeekPage(selectedDate: _selectedDate, onDateChanged: _onDateChanged),
      CalendarPage(selectedDate: _selectedDate, onDateChanged: _onDateChanged),
      const AssignmentsPage(),
      const SubjectsPage(),
    ];

    final provider = context.watch<TaskProvider>();
    if (provider.isLoading) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }
    return LayoutBuilder(builder: (context, constraints) {
      final w = constraints.maxWidth;
      final h = constraints.maxHeight;
      // Use the side-rail layout whenever the window is genuinely wide AND
      // landscape. A width-only test misfires on square-ish or portrait-ish
      // windows, which is what made elements misalign when the aspect ratio
      // changed — the rail ate horizontal space the content couldn't spare.
      final isWide = w >= 880 && w > h * 1.05;

      final Widget page;
      if (isWide) {
        // Mac / tablet: an editorial sidebar (destinations, projects,
        // account) beside a real wide-screen stage. Today gets a flagship
        // two-column layout with a day-briefing rail; the other sections
        // keep their layouts but breathe in a comfortable reading width.
        page = Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            WorkspaceSidebar(
              selectedIndex: _currentIndex,
              onSelect: (index) => setState(() => _currentIndex = index),
            ),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 200),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeInCubic,
                transitionBuilder: (child, animation) =>
                    FadeTransition(opacity: animation, child: child),
                child: KeyedSubtree(
                  key: ValueKey('wide-$_currentIndex'),
                  child: _currentIndex == 0
                      ? WideTodayView(
                          selectedDate: _selectedDate,
                          onDateChanged: _onDateChanged,
                        )
                      : Center(
                          child: ConstrainedBox(
                            constraints: const BoxConstraints(maxWidth: 1000),
                            child: pages[_currentIndex],
                          ),
                        ),
                ),
              ),
            ),
          ],
        );
      } else {
        page = Stack(
          children: [
            Positioned.fill(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 180),
                switchInCurve: Curves.easeOutCubic,
                switchOutCurve: Curves.easeInCubic,
                transitionBuilder: (child, animation) =>
                    FadeTransition(opacity: animation, child: child),
                child: KeyedSubtree(
                  key: ValueKey(_currentIndex),
                  child: pages[_currentIndex],
                ),
              ),
            ),
            Positioned(
              left: 16,
              right: 16,
              bottom: 16 + MediaQuery.of(context).viewPadding.bottom,
              child: GlassNavBar(
                selectedIndex: _currentIndex,
                onDestinationSelected: (index) =>
                    setState(() => _currentIndex = index),
              ),
            ),
          ],
        );
      }

      return Scaffold(
        body: page,
        floatingActionButton: isWide
            ? (_currentIndex == 0 || _currentIndex == 4
                ? null
                : Padding(
                    // Matches the Subjects page's "New note" pill exactly, so
                    // the action sits in the same place on every tab.
                    padding: const EdgeInsets.only(bottom: 82),
                    child: GlassPillButton(
                      icon: Icons.add,
                      label: 'New Task',
                      onTap: () {
                        FocusScope.of(context).unfocus();
                        showAddTaskDialog(context, initialDate: _selectedDate);
                      },
                    ),
                  ))
            : (_currentIndex == 4
                ? null
                : Padding(
                    // Same 82px as the Subjects page's "New note" pill: the FAB
                    // slot adds its own max(16, system inset), so both pills sit
                    // at exactly the same height — and clear the glass nav bar
                    // on phones with a gesture bar.
                    padding: const EdgeInsets.only(bottom: 82),
                    child: GlassPillButton(
                      icon: Icons.add,
                      label: 'New Task',
                      onTap: () {
                        FocusScope.of(context).unfocus();
                        showAddTaskDialog(context, initialDate: _selectedDate);
                      },
                    ),
                  )),
      );
    });
  }
}
