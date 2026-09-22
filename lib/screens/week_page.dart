import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../utils/workload.dart';
import '../widgets/glass_button.dart';
import '../widgets/task_card.dart';

// Scrollable week view: one page per week (swipe horizontally), the whole
// week scrolls vertically, and tasks can be dragged between days. Opens
// scrolled so today's day is the first one visible.
class WeekPage extends StatefulWidget {
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateChanged;

  const WeekPage(
      {super.key, required this.selectedDate, required this.onDateChanged});

  @override
  WeekPageState createState() => WeekPageState();
}

class WeekPageState extends State<WeekPage> {
  // UTC epoch so week indexing is immune to DST shifts
  static final DateTime _epoch = DateTime.utc(2021, 1, 4); // a Monday
  static const int _pageCount = 840; // ~16 years

  late final PageController _controller;
  late final ScrollController _todayScroll;
  final Map<DateTime, GlobalKey> _dayKeys = {};
  late int _page;

  GlobalKey _dayKey(DateTime day) =>
      _dayKeys.putIfAbsent(dayKey(day), () => GlobalKey());

  @override
  void initState() {
    super.initState();
    _page = _weekIndexOf(DateTime.now());
    _controller = PageController(initialPage: _page);
    _todayScroll = ScrollController();

    WidgetsBinding.instance.addPostFrameCallback((_) => _scrollToDay(DateTime.now()));
  }

  @override
  void dispose() {
    _controller.dispose();
    _todayScroll.dispose();
    super.dispose();
  }

  static DateTime _mondayOf(DateTime d) =>
      DateTime(d.year, d.month, d.day).subtract(Duration(days: d.weekday - 1));

  static int _weekIndexOf(DateTime d) =>
      DateTime.utc(d.year, d.month, d.day)
          .subtract(Duration(days: d.weekday - 1))
          .difference(_epoch)
          .inDays ~/
      7;

  static DateTime _weekStartAt(int index) {
    final utc = _epoch.add(Duration(days: index * 7));
    return DateTime(utc.year, utc.month, utc.day);
  }

  void _goTo(int page) {
    if (page < 0 || page >= _pageCount) return;
    _controller.animateToPage(page,
        duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
  }

  void _jumpToToday() {
    _goTo(_weekIndexOf(DateTime.now()));
    widget.onDateChanged(DateTime.now());
    // wait for the page to settle, then bring today's day into view
    Future.delayed(
        const Duration(milliseconds: 400), () => _scrollToDay(DateTime.now()));
  }

  // Scrolls the week list so the target day's section sits at the top. If
  // the section isn't built yet (lazy list), estimate the offset, jump, then
  // fine-tune with ensureVisible.
  void _scrollToDay(DateTime target) {
    if (!mounted) return;

    final ctx = _dayKeys[dayKey(target)]?.currentContext;
    if (ctx != null) {
      Scrollable.ensureVisible(ctx,
          alignment: 0.0,
          duration: const Duration(milliseconds: 250),
          curve: Curves.easeOutCubic);
      return;
    }

    if (!_todayScroll.hasClients) return;
    _todayScroll.jumpTo(
        _estimateOffsetBefore(target).clamp(0.0, _todayScroll.position.maxScrollExtent));
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      final c = _dayKeys[dayKey(target)]?.currentContext;
      if (c != null) {
        Scrollable.ensureVisible(c, alignment: 0.0);
      }
    });
  }

  double _estimateOffsetBefore(DateTime target) {
    final provider = Provider.of<TaskProvider>(context, listen: false);
    final monday = _mondayOf(target);

    double offset = 8; // top padding of the list
    for (int i = 0; i < target.weekday - 1; i++) {
      final day = monday.add(Duration(days: i));
      final count = provider.getTasksForDate(day).length;
      offset += 44 + count * 90 + (count == 0 ? 32 : 0) + 10;
    }
    return offset;
  }

  void _movedSnack(Task task, DateTime day) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content:
            Text('Moved "${task.title}" to ${DateFormat('MMM d').format(day)}'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: Colors.black87,
        duration: const Duration(milliseconds: 1600),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);

    final weekStart = _weekStartAt(_page);
    final days = List.generate(7, (i) => weekStart.add(Duration(days: i)));
    final isThisWeek = sameDay(weekStart, _mondayOf(DateTime.now()));

    var totalTasks = 0;
    var doneTasks = 0;
    var minutesLeft = 0;
    for (final day in days) {
      final dayTasks = provider.getTasksForDate(day);
      totalTasks += dayTasks.length;
      for (final t in dayTasks) {
        if (t.isDone) {
          doneTasks++;
        } else {
          minutesLeft +=
              t.remainingMinutes > 0 ? t.remainingMinutes : t.durationMinutes;
        }
      }
    }

    final weekEnd = weekStart.add(const Duration(days: 6));
    final sameMonth = weekStart.month == weekEnd.month;
    final rangeText =
        '${DateFormat('MMM d').format(weekStart)} – ${sameMonth ? DateFormat('d').format(weekEnd) : DateFormat('MMM d').format(weekEnd)}';

    return SafeArea(
      child: Stack(
        children: [
          Column(
            children: [
              // HEADER — centered title, chevrons on both sides
              Padding(
                padding: EdgeInsets.fromLTRB(8, 16, 8, 0),
                child: Row(
                  children: [
                    IconButton(
                      icon: Icon(Icons.chevron_left, size: 28),
                      onPressed: () => _goTo(_page - 1),
                    ),
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 150),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        child: Column(
                          key: ValueKey(dayKey(weekStart)),
                          children: [
                            Text(
                              isThisWeek ? 'This Week' : rangeText,
                              style: TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.bold),
                            ),
                            SizedBox(height: 2),
                            Text(
                              DateFormat('MMMM yyyy').format(weekStart),
                              style: TextStyle(
                                  fontSize: 12, color: context.inkSoft),
                            ),
                          ],
                        ),
                      ),
                    ),
                    IconButton(
                      icon: Icon(Icons.chevron_right, size: 28),
                      onPressed: () => _goTo(_page + 1),
                    ),
                  ],
                ),
              ),

          // WEEK SUMMARY — day chips with task counts + completion progress
          Padding(
            padding: EdgeInsets.fromLTRB(16, 12, 16, 6),
            child: Container(
              padding: EdgeInsets.symmetric(horizontal: 18, vertical: 20),
              decoration: BoxDecoration(
                color: context.card,
                borderRadius: BorderRadius.circular(20),
                border: Border.all(color: context.hairline),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withValues(alpha: 0.02),
                    blurRadius: 10,
                    offset: Offset(0, 4),
                  )
                ],
              ),
              child: Column(
                children: [
                  Row(
                    children: days.map((day) {
                      final selected = sameDay(day, widget.selectedDate);
                      final isToday = sameDay(day, DateTime.now());
                      final dayCount =
                          provider.getTasksForDate(day).length;
                      return Expanded(
                        child: GestureDetector(
                          onTap: () {
                            widget.onDateChanged(day);
                            _scrollToDay(day);
                          },
                          child: Container(
                            margin: EdgeInsets.only(right: 7),
                            decoration: BoxDecoration(
                              color:
                                  selected ? context.ink : context.fillSoft,
                              borderRadius: BorderRadius.circular(10),
                              border: selected
                                  ? null
                                  : isToday
                                      ? Border.all(color: context.inkSoft)
                                      : Border.all(
                                          color: context.hairline),
                            ),
                            padding: EdgeInsets.symmetric(vertical: 7),
                            child: Column(
                              children: [
                                Text(
                                  DateFormat('E').format(day).substring(0, 1),
                                  style: TextStyle(
                                    fontSize: 10,
                                    fontWeight: FontWeight.w600,
                                    color: selected
                                        ? context.inkInverse.withValues(alpha: 0.70)
                                        : context.inkSoft,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  '${day.day}',
                                  style: TextStyle(
                                    fontSize: 13,
                                    fontWeight: FontWeight.bold,
                                    color: selected
                                        ? context.inkInverse
                                        : context.ink,
                                  ),
                                ),
                                SizedBox(height: 3),
                                Text(
                                  dayCount == 0 ? '' : '$dayCount',
                                  style: TextStyle(
                                    fontSize: 9.5,
                                    fontWeight: FontWeight.w600,
                                    color: selected
                                        ? context.inkInverse.withValues(alpha: 0.70)
                                        : context.inkSoft,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      );
                    }).toList(),
                  ),
                  SizedBox(height: 14),
                  Row(
                    children: [
                      Expanded(
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 160),
                          switchInCurve: Curves.easeOutCubic,
                          switchOutCurve: Curves.easeInCubic,
                          transitionBuilder: (child, anim) =>
                              FadeTransition(opacity: anim, child: child),
                          child: Text(
                            '$doneTasks of $totalTasks done · ${minutesLeft == 0 ? '0m' : formatDuration(minutesLeft)} left',
                            key: ValueKey(
                                'stats-$doneTasks-$totalTasks-$minutesLeft'),
                            style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: context.ink),
                          ),
                        ),
                      ),
                    ],
                  ),
                  SizedBox(height: 10),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(4),
                    child: LinearProgressIndicator(
                      value: totalTasks == 0 ? 0 : doneTasks / totalTasks,
                      backgroundColor: context.fillSoft,
                      color: context.ink,
                      minHeight: 4,
                    ),
                  ),
                ],
              ),
            ),
          ),

          SizedBox(height: 2),

          // THE WEEK — vertical scroll, horizontal page swipe, fading edges
          Expanded(
            child: Stack(
              children: [
                PageView.builder(
                  controller: _controller,
                  itemCount: _pageCount,
                  onPageChanged: (index) => setState(() => _page = index),
                  itemBuilder: (context, index) =>
                      _weekList(_weekStartAt(index), provider),
                ),
                // top fade
                IgnorePointer(
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: Container(
                      height: 30,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topCenter,
                          end: Alignment.bottomCenter,
                          colors: [context.bg, context.bg.withValues(alpha: 0)],
                        ),
                      ),
                    ),
                  ),
                ),
                // bottom fade
                IgnorePointer(
                  child: Align(
                    alignment: Alignment.bottomCenter,
                    child: Container(
                      height: 26,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.bottomCenter,
                          end: Alignment.topCenter,
                          colors: [context.bg, context.bg.withValues(alpha: 0)],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
            ],
          ),

          // TODAY — circle button, bottom-left, level with the New Task
          // button and clear of the floating glass bar
          Positioned(
            left: 16,
            bottom: 98,
            child: GlassCircleButton(
              onTap: _jumpToToday,
              tooltip: 'Jump to today',
              child: Icon(Icons.calendar_today_outlined,
                  size: 22, color: context.ink),
            ),
          ),
        ],
      ),
    );
  }

  Widget _weekList(DateTime weekStart, TaskProvider provider) {
    // Only the current page carries the scroll controller and day keys —
    // adjacent pages stay keyless so nothing clashes while swiping.
    final isCurrentPage = sameDay(weekStart, _weekStartAt(_page));

    return ListView(
      controller: isCurrentPage ? _todayScroll : null,
      // generous bottom padding so Sunday clears the floating buttons
      padding: EdgeInsets.fromLTRB(16, 8, 16, 200),
      children: List.generate(7, (i) {
        final day = weekStart.add(Duration(days: i));
        return _daySection(day, provider,
            key: isCurrentPage ? _dayKey(day) : null);
      }),
    );
  }

  Widget _daySection(DateTime day, TaskProvider provider, {Key? key}) {
    final tasks = provider.getTasksForDate(day);
    final isToday = sameDay(day, DateTime.now());
    final isSelected = sameDay(day, widget.selectedDate);

    return DragTarget<Task>(
      onWillAcceptWithDetails: (details) =>
          !sameDay(details.data.date, day),
      onAcceptWithDetails: (details) {
        provider.rescheduleTask(details.data.id, day);
        _movedSnack(details.data, day);
      },
      builder: (context, candidate, _) {
        final hover = candidate.isNotEmpty;

        return KeyedSubtree(
          key: key,
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOutCubic,
            margin: EdgeInsets.only(bottom: 6),
            padding: EdgeInsets.symmetric(vertical: 4, horizontal: hover ? 8 : 0),
            decoration: BoxDecoration(
              color: hover ? context.card : Colors.transparent,
              borderRadius: BorderRadius.circular(20),
              border:
                  hover ? Border.all(color: context.ink, width: 2) : null,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // DAY HEADER
                InkWell(
                  onTap: () => widget.onDateChanged(day),
                  borderRadius: BorderRadius.circular(10),
                  child: Padding(
                    padding: EdgeInsets.symmetric(horizontal: 8, vertical: 10),
                    child: Row(
                      children: [
                        Text(
                          DateFormat('EEEE').format(day),
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: context.ink,
                          ),
                        ),
                        SizedBox(width: 10),
                        Text(
                          DateFormat('MMM d').format(day) +
                              (tasks.isEmpty
                                  ? ''
                                  : '  ·  ${tasks.length} task${tasks.length > 1 ? 's' : ''}'),
                          style: TextStyle(
                              fontSize: 12, color: context.inkSoft),
                        ),
                        Spacer(),
                        if (isSelected)
                          Padding(
                            padding: EdgeInsets.only(right: 6),
                            child: Icon(Icons.arrow_forward_ios,
                                size: 11, color: context.inkFaint),
                          ),
                        if (isToday)
                          Container(
                            padding: EdgeInsets.symmetric(
                                horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: context.ink,
                              borderRadius: BorderRadius.circular(8),
                            ),
                            child: Text('TODAY',
                                style: TextStyle(
                                    fontSize: 9,
                                    color: context.inkInverse,
                                    fontWeight: FontWeight.bold,
                                    letterSpacing: 0.5)),
                          ),
                      ],
                    ),
                  ),
                ),
                // TASKS — long-press the left side to drag onto another day
                // (no swipe-delete here: swiping is for changing weeks)
                ...tasks.map((t) => TaskCard(
                    key: ValueKey(t.id), task: t, dismissible: false)),
                if (tasks.isEmpty)
                  Padding(
                    padding: EdgeInsets.only(left: 8, bottom: 12),
                    child: Text(
                      'Nothing scheduled',
                      style:
                          TextStyle(fontSize: 12, color: context.inkFaint),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}
