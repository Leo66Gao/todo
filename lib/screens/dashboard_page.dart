import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/workload.dart';
import '../widgets/overdue_sheet.dart';
import '../widgets/glass_button.dart';
import '../widgets/task_card.dart';
import '../widgets/weekly_strip.dart';
import 'add_task_sheet.dart';
import 'settings_page.dart';

class DashboardPage extends StatefulWidget {
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateChanged;

  const DashboardPage({
    super.key,
    required this.selectedDate,
    required this.onDateChanged,
  });

  @override
  DashboardPageState createState() => DashboardPageState();
}

class DashboardPageState extends State<DashboardPage> {
  bool _completedExpanded = false;

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'GOOD MORNING';
    if (h < 17) return 'GOOD AFTERNOON';
    return 'GOOD EVENING';
  }

  void _handleReorder(
      List<Object> items, List<Task> untimed, int oldIndex, int newIndex) {
    final moved = items[oldIndex];
    if (moved is! Task || !untimed.contains(moved)) return;

    final provider = Provider.of<TaskProvider>(context, listen: false);
    // onReorderItem already adjusts newIndex for the removed item.
    final ni = newIndex;

    // First untimed task sitting at/after the insertion slot — snap to it so
    // cards stay inside the TASKS section; none found means "move to end".
    Task? anchor;
    int seen = 0;
    for (int i = 0; i < items.length; i++) {
      if (i == oldIndex) continue;
      if (seen >= ni) {
        final it = items[i];
        if (it is Task && untimed.contains(it)) {
          anchor = it;
          break;
        }
      }
      seen++;
    }

    final oldT = untimed.indexOf(moved);
    final newT = anchor == null ? untimed.length : untimed.indexOf(anchor);
    provider.reorderTasks(oldT, newT, untimed);
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);
    final tasks = provider.getTasksForDate(widget.selectedDate);

    final now = DateTime.now();
    final viewingToday = sameDay(widget.selectedDate, now);
    final overdue = viewingToday ? provider.getOverdueTasks(now) : const [];

    final timed =
        tasks.where((t) => !t.isDone && t.startTime != null).toList();
    final untimed =
        tasks.where((t) => !t.isDone && t.startTime == null).toList();
    final doneTasks = tasks.where((t) => t.isDone).toList();

    // Flat list: section markers + tasks (only what's visible)
    final items = <Object>[];
    if (timed.isNotEmpty) {
      items.add('SCHEDULED');
      items.addAll(timed);
    }
    if (untimed.isNotEmpty) {
      items.add('TASKS');
      items.addAll(untimed);
    }
    if (doneTasks.isNotEmpty) {
      items.add('COMPLETED');
      if (_completedExpanded) items.addAll(doneTasks);
    }

    return SafeArea(
      child: Stack(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Padding(
                padding: EdgeInsets.fromLTRB(20, 20, 20, 10),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Flexible so a long greeting or a large system font size
                    // ellipsizes instead of overflowing the row on narrow
                    // phones.
                    Expanded(
                      child: AnimatedSwitcher(
                        duration: const Duration(milliseconds: 180),
                        switchInCurve: Curves.easeOutCubic,
                        switchOutCurve: Curves.easeInCubic,
                        // AnimatedSwitcher centres its child in the available
                        // width by default, which pushed the greeting and date
                        // to the right once this slot became an Expanded. Keep
                        // them pinned to the left edge.
                        layoutBuilder: (currentChild, previousChildren) =>
                            Stack(
                          alignment: Alignment.centerLeft,
                          children: [
                            ...previousChildren,
                            if (currentChild != null) currentChild,
                          ],
                        ),
                        transitionBuilder: (child, anim) => FadeTransition(
                            opacity: anim,
                            child: SlideTransition(
                                position: Tween<Offset>(
                                        begin: const Offset(0, 0.15),
                                        end: Offset.zero)
                                    .animate(anim),
                                child: child)),
                        child: Column(
                          key: ValueKey(dayKey(widget.selectedDate)),
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              viewingToday
                                  ? '${_greeting()} · ${DateFormat('MMMM yyyy').format(widget.selectedDate).toUpperCase()}'
                                  : DateFormat('MMMM yyyy')
                                      .format(widget.selectedDate)
                                      .toUpperCase(),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 13,
                                  letterSpacing: 1.2,
                                  fontWeight: FontWeight.w600,
                                  color: context.inkSoft),
                            ),
                            Text(
                              DateFormat('EEEE, d').format(widget.selectedDate),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                  fontSize: 28, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Settings',
                      icon: Icon(Icons.settings_outlined, color: context.ink),
                      onPressed: () {
                        Navigator.push(context,
                            MaterialPageRoute(builder: (_) => SettingsPage()));
                      },
                    ),
                  ],
                ),
              ),

              WeeklyDateStrip(
                selectedDate: widget.selectedDate,
                onDateChanged: widget.onDateChanged,
              ),
              Expanded(
                child: tasks.isEmpty
                    ? Center(
                        child: FittedBox(
                          fit: BoxFit.scaleDown,
                          child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(
                                  viewingToday
                                      ? Icons.wb_sunny_outlined
                                      : Icons.event_available_outlined,
                                  size: 56,
                                  color: context.inkFaint,
                                ),
                                SizedBox(height: 14),
                                Text(
                                  viewingToday
                                      ? 'Nothing planned for today'
                                      : 'Nothing on ${DateFormat('MMM d').format(widget.selectedDate)}',
                                  style: TextStyle(
                                      color: context.inkSoft,
                                      fontSize: 15.5),
                                ),
                                SizedBox(height: 16),
                                TextButton.icon(
                                  onPressed: () => showAddTaskDialog(context,
                                      initialDate: widget.selectedDate),
                                  style: TextButton.styleFrom(
                                    foregroundColor: context.ink,
                                    backgroundColor: context.card,
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(12),
                                      side:
                                          BorderSide(color: context.hairline),
                                    ),
                                  ),
                                  icon: const Icon(Icons.add, size: 18),
                                  label: const Text('Add a task',
                                      style: TextStyle(
                                          fontWeight: FontWeight.w600,
                                          fontSize: 13)),
                                ),
                              ])))
                    : ReorderableListView.builder(
                        // DISABLE DEFAULT DRAG HANDLES SO WE CAN USE CUSTOM ONE
                        buildDefaultDragHandles: false,
                        // Rounded shadow while dragging — no sharp edges
                        proxyDecorator: (child, index, animation) => Material(
                              color: Colors.transparent,
                              elevation: 8,
                              borderRadius: BorderRadius.circular(20),
                              child: child,
                            ),

                        padding: EdgeInsets.fromLTRB(16, 0, 16,
                            110 + MediaQuery.of(context).viewPadding.bottom),

                        itemCount: items.length,

                        onReorderItem: (oldIndex, newIndex) =>
                            _handleReorder(items, untimed, oldIndex, newIndex),

                        itemBuilder: (context, index) {
                          final item = items[index];

                          if (item is String) {
                            final isCompleted = item == 'COMPLETED';
                            return _SectionHeader(
                              key: ValueKey('header-$item'),
                              label: item,
                              count: isCompleted
                                  ? doneTasks.length
                                  : (item == 'SCHEDULED' ? timed : untimed)
                                      .length,
                              collapsible: isCompleted,
                              expanded: _completedExpanded,
                              onToggle: isCompleted
                                  ? () => setState(() => _completedExpanded =
                                      !_completedExpanded)
                                  : null,
                            );
                          }

                          final t = item as Task;

                          // Reorder handle needs the ROW index in this list
                          // (headers included) — not the section position —
                          // or the wrong card gets dragged.
                          final isReorderable = untimed.contains(t);

                          return TaskCard(
                            key: ValueKey(t.id),
                            task: t,
                            index: isReorderable ? index : null,
                          );
                        },
                      ),
              ),
            ],
          ),

          // LEFTOVER BADGE — opposite the New Task button, on the same
          // level and kept clear of the glass bar
          Positioned(
            left: 16,
            bottom: 98,
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 180),
              switchInCurve: Curves.easeOutBack,
              switchOutCurve: Curves.easeInCubic,
              transitionBuilder: (child, anim) =>
                  ScaleTransition(scale: anim, child: child),
              child: (viewingToday && overdue.isNotEmpty)
                  ? _LeftoverBadge(
                      key: ValueKey('badge-${overdue.length}'),
                      count: overdue.length,
                      onTap: () => showOverdueSheet(context),
                    )
                  : const SizedBox.shrink(),
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String label;
  final int count;
  final bool collapsible;
  final bool expanded;
  final VoidCallback? onToggle;

  const _SectionHeader({
    super.key,
    required this.label,
    required this.count,
    this.collapsible = false,
    this.expanded = false,
    this.onToggle,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onToggle,
      behavior: onToggle != null ? HitTestBehavior.opaque : null,
      child: Padding(
        padding: EdgeInsets.fromLTRB(4, 14, 4, 10),
        child: Row(
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
                color: context.inkFaint,
              ),
            ),
            SizedBox(width: 6),
            Text(
              '$count',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: context.inkFaint,
              ),
            ),
            Spacer(),
            if (collapsible)
              AnimatedRotation(
                turns: expanded ? 0.5 : 0,
                duration: const Duration(milliseconds: 150),
                child: Icon(Icons.expand_more,
                    size: 18, color: context.inkFaint),
              ),
          ],
        ),
      ),
    );
  }
}

class _LeftoverBadge extends StatelessWidget {
  final int count;
  final VoidCallback onTap;

  const _LeftoverBadge(
      {super.key, required this.count, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GlassCircleButton(
      onTap: onTap,
      tooltip: 'Show overdue tasks',
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            '$count',
            style: TextStyle(
              color: context.ink,
              fontSize: 17,
              fontWeight: FontWeight.bold,
              height: 1.1,
            ),
          ),
          Text(
            'LEFT',
            style: TextStyle(
              color: context.inkSoft,
              fontSize: 8,
              fontWeight: FontWeight.w700,
              letterSpacing: 1,
            ),
          ),
        ],
      ),
    );
  }
}
