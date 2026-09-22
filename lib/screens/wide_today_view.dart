import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../utils/workload.dart';
import '../widgets/frosted_panel.dart';
import '../widgets/glass_button.dart';
import '../widgets/overdue_sheet.dart';
import '../widgets/task_card.dart';
import '../widgets/weekly_strip.dart';
import 'add_task_sheet.dart';
import 'settings_page.dart';

/// The wide-screen "Today" dashboard.
///
/// A genuine landscape composition, not a stretched phone column: an editorial
/// header with the day's title and the primary actions, the task list in a
/// generous column, and a frosted day-briefing rail (progress, stats and the
/// next scheduled task) on the right. Same provider, same cards, same
/// behaviours as mobile — recomposed for the big stage.
class WideTodayView extends StatefulWidget {
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateChanged;

  const WideTodayView({
    super.key,
    required this.selectedDate,
    required this.onDateChanged,
  });

  @override
  State<WideTodayView> createState() => _WideTodayViewState();
}

class _WideTodayViewState extends State<WideTodayView> {
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

    // First untimed task sitting at/after the insertion slot — snap to it so
    // cards stay inside the TASKS section; none found means "move to end".
    Task? anchor;
    int seen = 0;
    for (int i = 0; i < items.length; i++) {
      if (i == oldIndex) continue;
      if (seen >= newIndex) {
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
    final overdue = viewingToday ? provider.getOverdueTasks(now) : const <Task>[];

    final timed = tasks.where((t) => !t.isDone && t.startTime != null).toList();
    final untimed = tasks.where((t) => !t.isDone && t.startTime == null).toList();
    final done = tasks.where((t) => t.isDone).toList();

    return SafeArea(
      child: LayoutBuilder(
        builder: (context, stage) {
          // Only split into list + briefing rail when there is real room for
          // both. Below that the rail stacks as a panel above the list, so a
          // narrower or squarer window never squeezes the two columns into
          // each other.
          final splitColumns = stage.maxWidth >= 1000;

          final list = tasks.isEmpty
              ? _EmptyDay(selectedDate: widget.selectedDate)
              : _TaskSections(
                  timed: timed,
                  untimed: untimed,
                  done: done,
                  completedExpanded: _completedExpanded,
                  onToggleCompleted: () =>
                      setState(() => _completedExpanded = !_completedExpanded),
                  onReorder: (items, l, oldI, newI) =>
                      _handleReorder(items, l, oldI, newI),
                );

          final rail = _DayRail(
            timed: timed,
            untimed: untimed,
            done: done,
            overdueCount: overdue.length,
            viewingToday: viewingToday,
            onShowOverdue: () => showOverdueSheet(context),
          );

          if (!splitColumns) {
            // Stacked: one page that scrolls as a whole, so a short or squarer
            // window reveals the briefing and the tasks instead of overflowing.
            return SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(28, 22, 28, 40),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _Header(
                    selectedDate: widget.selectedDate,
                    viewingToday: viewingToday,
                    greeting: _greeting(),
                  ),
                  const SizedBox(height: 18),
                  WeeklyDateStrip(
                    selectedDate: widget.selectedDate,
                    onDateChanged: widget.onDateChanged,
                  ),
                  const SizedBox(height: 12),
                  rail,
                  const SizedBox(height: 8),
                  if (tasks.isEmpty)
                    SizedBox(
                      height: 280,
                      child: _EmptyDay(selectedDate: widget.selectedDate),
                    )
                  else
                    _TaskSections(
                      embedded: true,
                      timed: timed,
                      untimed: untimed,
                      done: done,
                      completedExpanded: _completedExpanded,
                      onToggleCompleted: () => setState(
                          () => _completedExpanded = !_completedExpanded),
                      onReorder: (items, l, oldI, newI) =>
                          _handleReorder(items, l, oldI, newI),
                    ),
                ],
              ),
            );
          }

          return Padding(
            padding: const EdgeInsets.fromLTRB(36, 26, 36, 28),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ---------- main column ----------
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _Header(
                        selectedDate: widget.selectedDate,
                        viewingToday: viewingToday,
                        greeting: _greeting(),
                      ),
                      const SizedBox(height: 18),
                      WeeklyDateStrip(
                        selectedDate: widget.selectedDate,
                        onDateChanged: widget.onDateChanged,
                      ),
                      const SizedBox(height: 6),
                      Expanded(child: list),
                    ],
                  ),
                ),
                const SizedBox(width: 26),
                // ---------- day briefing rail ----------
                SizedBox(
                  width: 320,
                  child: SingleChildScrollView(child: rail),
                ),
              ],
            ),
          );
        },
      ),
    ); // SafeArea
  }
}

/// Editorial header: eyebrow greeting, large day title, sync state and the
/// primary actions live here instead of a floating FAB.
class _Header extends StatelessWidget {
  final DateTime selectedDate;
  final bool viewingToday;
  final String greeting;

  const _Header({
    required this.selectedDate,
    required this.viewingToday,
    required this.greeting,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      // 16px matches the week strip's own inner gutter, so the date lines up
      // with the day pills beneath it.
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  viewingToday
                      ? '$greeting · ${DateFormat('MMMM').format(selectedDate).toUpperCase()}'
                      : DateFormat('MMMM yyyy')
                          .format(selectedDate)
                          .toUpperCase(),
                  style: TextStyle(
                    fontSize: 12,
                    letterSpacing: 1.6,
                    fontWeight: FontWeight.w600,
                    color: context.inkFaint,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  DateFormat('EEEE d MMMM').format(selectedDate),
                  style: TextStyle(
                    fontSize: 32,
                    fontWeight: FontWeight.w700,
                    color: context.ink,
                    height: 1.1,
                  ),
                ),
              ],
            ),
          ),
          const _SyncPill(),
          const SizedBox(width: 12),
          GlassCircleButton(
            size: 46,
            tooltip: 'Settings',
            onTap: () => Navigator.push(
              context,
              MaterialPageRoute(builder: (_) => const SettingsPage()),
            ),
            child: Icon(Icons.settings_outlined,
                size: 20, color: context.ink),
          ),
          const SizedBox(width: 12),
          GlassPillButton(
            icon: Icons.add,
            label: 'New Task',
            onTap: () {
              FocusScope.of(context).unfocus();
              showAddTaskDialog(context, initialDate: selectedDate);
            },
          ),
        ],
      ),
    );
  }
}

/// Compact cloud-status pill: a muted dot + the provider's own status text.
class _SyncPill extends StatelessWidget {
  const _SyncPill();

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final status = provider.cloudStatus;
    final error = provider.cloudError;

    final (Color dot, String label) = error != null
        ? (const Color(0xFFE5484D), 'Needs attention')
        : status == 'Synced'
            ? (const Color(0xFF30A46C), 'Synced')
            : status.startsWith('Offline')
                ? (const Color(0xFFF5A623), 'Offline · saved here')
                : (context.inkFaint, status);

    return Container(
      height: 34,
      padding: const EdgeInsets.symmetric(horizontal: 13),
      decoration: BoxDecoration(
        color: context.card.withValues(alpha: 0.7),
        borderRadius: BorderRadius.circular(17),
        border: Border.all(color: context.hairline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: BoxDecoration(color: dot, shape: BoxShape.circle),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: context.inkSoft,
            ),
          ),
        ],
      ),
    );
  }
}


/// The reorderable task sections (SCHEDULED / TASKS / COMPLETED) — the same
/// data flow and drag-reorder behaviour as the mobile dashboard, tuned for a
/// wide surface with calmer headers and roomier padding.
class _TaskSections extends StatelessWidget {
  final List<Task> timed;
  final List<Task> untimed;
  final List<Task> done;
  final bool completedExpanded;
  final VoidCallback onToggleCompleted;
  final void Function(List<Object>, List<Task>, int, int) onReorder;

  /// True when the list is rendered inside the page's own scroll view (the
  /// stacked, narrow-window layout) and must not scroll independently.
  final bool embedded;

  const _TaskSections({
    required this.timed,
    required this.untimed,
    required this.done,
    required this.completedExpanded,
    required this.onToggleCompleted,
    required this.onReorder,
    this.embedded = false,
  });

  @override
  Widget build(BuildContext context) {
    final items = <Object>[];
    if (timed.isNotEmpty) {
      items.add('SCHEDULED');
      items.addAll(timed);
    }
    if (untimed.isNotEmpty) {
      items.add('TASKS');
      items.addAll(untimed);
    }
    if (done.isNotEmpty) {
      items.add('COMPLETED');
      if (completedExpanded) items.addAll(done);
    }

    return ReorderableListView.builder(
      buildDefaultDragHandles: false,
      shrinkWrap: embedded,
      physics: embedded ? const NeverScrollableScrollPhysics() : null,
      proxyDecorator: (child, index, animation) => Material(
        color: Colors.transparent,
        elevation: 8,
        borderRadius: BorderRadius.circular(20),
        child: child,
      ),
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
      itemCount: items.length,
      onReorderItem: (oldIndex, newIndex) =>
          onReorder(items, untimed, oldIndex, newIndex),
      itemBuilder: (context, index) {
        final item = items[index];
        if (item is String) {
          return _SectionHeader(
            key: ValueKey('header-$item-$index'),
            label: item,
            count: item == 'SCHEDULED'
                ? timed.length
                : item == 'TASKS'
                    ? untimed.length
                    : done.length,
            collapsible: item == 'COMPLETED',
            expanded: completedExpanded,
            onToggle: item == 'COMPLETED' ? onToggleCompleted : null,
          );
        }
        final task = item as Task;
        return Container(
          key: ValueKey(task.id),
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: TaskCard(task: task, index: index),
        );
      },
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
        padding: const EdgeInsets.fromLTRB(16, 18, 16, 10),
        child: Row(
          children: [
            Text(
              label,
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.6,
                color: context.inkFaint,
              ),
            ),
            const SizedBox(width: 8),
            Text(
              '$count',
              style: TextStyle(
                fontSize: 11.5,
                fontWeight: FontWeight.w700,
                color: context.ink.withValues(alpha: 0.45),
              ),
            ),
            const Spacer(),
            if (collapsible)
              AnimatedRotation(
                turns: expanded ? 0.5 : 0,
                duration: const Duration(milliseconds: 150),
                child: Icon(Icons.expand_more,
                    size: 20, color: context.inkFaint),
              ),
          ],
        ),
      ),
    );
  }
}


/// The day-briefing rail: progress ring, workload stats and what's next,
/// rendered on a single frosted sheet.
class _DayRail extends StatelessWidget {
  final List<Task> timed;
  final List<Task> untimed;
  final List<Task> done;
  final int overdueCount;
  final bool viewingToday;
  final VoidCallback onShowOverdue;

  const _DayRail({
    required this.timed,
    required this.untimed,
    required this.done,
    required this.overdueCount,
    required this.viewingToday,
    required this.onShowOverdue,
  });

  @override
  Widget build(BuildContext context) {
    final total = timed.length + untimed.length + done.length;
    final open = timed.length + untimed.length;
    final progress = total == 0 ? 0.0 : done.length / total;
    final openTasks = [...timed, ...untimed];
    final minutesLeft = openTasks.fold<int>(0, (sum, t) {
      final per =
          t.remainingMinutes > 0 ? t.remainingMinutes : t.durationMinutes;
      return sum + (per > 0 ? per : 30);
    });

    // Next scheduled task: the first timed task at/after now when viewing
    // today, otherwise the day's first scheduled task.
    final now = DateTime.now();
    Task? upNext;
    for (final t in timed) {
      if (!viewingToday || !t.startTime!.isBefore(now)) {
        upNext = t;
        break;
      }
    }

    return FrostedPanel(
      radius: 28,
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'DAY BRIEFING',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.6,
              color: context.inkFaint,
            ),
          ),
          const SizedBox(height: 22),
          _ProgressRing(
            progress: total == 0 ? 0 : progress,
            done: done.length,
            total: total,
          ),
          const SizedBox(height: 22),
          _RailRow(
            icon: Icons.check_circle_outline,
            label: 'Tasks left',
            value: '$open',
          ),
          _RailRow(
            icon: Icons.schedule_outlined,
            label: 'Est. time',
            value: minutesLeft == 0 ? '0m' : formatDuration(minutesLeft),
          ),
          if (overdueCount > 0)
            _RailAction(
              icon: Icons.error_outline,
              label: 'Overdue — tap to review',
              value: '$overdueCount',
              onTap: onShowOverdue,
            )
          else
            _RailRow(
              icon: Icons.error_outline,
              label: 'Overdue',
              value: '0',
            ),
          const SizedBox(height: 20),
          Container(height: 1, color: context.hairline),
          const SizedBox(height: 18),
          Text(
            'UP NEXT',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.6,
              color: context.inkFaint,
            ),
          ),
          const SizedBox(height: 14),
          if (upNext != null) ...[
            Row(
              children: [
                Container(
                  height: 34,
                  padding: const EdgeInsets.symmetric(horizontal: 11),
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: context.ink,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Text(
                    formatClock(upNext.startTime!),
                    style: TextStyle(
                      fontSize: 12,
                      color: context.inkInverse,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    upNext.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w600,
                      color: context.ink,
                    ),
                  ),
                ),
              ],
            ),
          ] else
            Text(
              open == 0
                  ? 'Everything is done. Enjoy the calm.'
                  : 'Nothing scheduled — a free day.',
              style: TextStyle(fontSize: 13.5, color: context.inkSoft),
            ),
        ],
      ),
    );
  }
}


class _ProgressRing extends StatelessWidget {
  final double progress;
  final int done;
  final int total;

  const _ProgressRing({
    required this.progress,
    required this.done,
    required this.total,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SizedBox(
        width: 132,
        height: 132,
        child: Stack(
          fit: StackFit.expand,
          children: [
            CircularProgressIndicator(
              value: progress,
              strokeWidth: 9,
              strokeCap: StrokeCap.round,
              color: context.ink,
              backgroundColor: context.ink.withValues(alpha: 0.08),
            ),
            Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '${(progress * 100).round()}%',
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w700,
                      color: context.ink,
                      height: 1.0,
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '$done of $total done',
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w500,
                      color: context.inkSoft,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _RailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        children: [
          Icon(icon, size: 18, color: context.inkSoft),
          const SizedBox(width: 11),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontSize: 13.5,
                fontWeight: FontWeight.w500,
                color: context.inkSoft,
              ),
            ),
          ),
          Text(
            value,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: context.ink,
            ),
          ),
        ],
      ),
    );
  }
}

class _RailAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  const _RailAction({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    const tint = Color(0xFFE5484D);
    return MouseRegion(
      cursor: SystemMouseCursors.click,
      child: GestureDetector(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 8),
          child: Row(
            children: [
              Icon(icon, size: 18, color: tint),
              const SizedBox(width: 11),
              Expanded(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13.5,
                    fontWeight: FontWeight.w500,
                    color: tint,
                  ),
                ),
              ),
              Text(
                value,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: tint,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}


/// The calm empty message that replaces the task list when a day has nothing
/// on it. The surrounding frame — header, week strip and briefing rail — stays
/// exactly the same as a day with tasks, so switching between them is a
/// content change rather than a different-looking screen.
class _EmptyDay extends StatelessWidget {
  final DateTime selectedDate;

  const _EmptyDay({required this.selectedDate});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: context.ink.withValues(alpha: 0.05),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.event_available_outlined,
              size: 32,
              color: context.ink.withValues(alpha: 0.55),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            'Nothing on ${DateFormat('MMMM d').format(selectedDate)}',
            style: TextStyle(
              fontSize: 19,
              fontWeight: FontWeight.w700,
              color: context.ink,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Enjoy the calm — or add your first task.',
            style: TextStyle(fontSize: 14, color: context.inkSoft),
          ),
          const SizedBox(height: 20),
          GestureDetector(
            onTap: () {
              FocusScope.of(context).unfocus();
              showAddTaskDialog(context, initialDate: selectedDate);
            },
            child: Container(
              height: 44,
              padding: const EdgeInsets.symmetric(horizontal: 20),
              decoration: BoxDecoration(
                color: context.ink,
                borderRadius: BorderRadius.circular(22),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add, size: 19, color: context.inkInverse),
                  const SizedBox(width: 8),
                  Text(
                    'Add a task',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: context.inkInverse,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}


