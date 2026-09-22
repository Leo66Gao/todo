import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../models/task.dart';
import '../utils/workload.dart' show dayKey, sameDay;
import '../state/task_provider.dart';
import '../theme/app_theme.dart';

// Custom month grid: task dots are laid out cleanly *inside* the cell (never
// half over the edge), and every cell is a drop target for drag-to-reschedule.
// Dots take the subject's color when there is one; milestones render as
// rings so they read as "part of a bigger assignment" at a glance.
class MonthGrid extends StatelessWidget {
  final DateTime month; // any date inside the month to show
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDaySelected;
  final void Function(Task task, DateTime day) onTaskDropped;

  const MonthGrid({
    super.key,
    required this.month,
    required this.selectedDate,
    required this.onDaySelected,
    required this.onTaskDropped,
  });

  static const double cellHeight = 54;
  static int rowCountFor(DateTime month) {
    final first = DateTime(month.year, month.month, 1);
    final days = DateTime(month.year, month.month + 1, 0).day;
    return (first.weekday - 1 + days + 6) ~/ 7;
  }

  static Color _dotColor(Task task, List<Project> projects, bool selected) {
    Color? subjectColor;
    if (task.projectId != null) {
      for (final project in projects) {
        if (project.id == task.projectId) {
          subjectColor = Color(project.colorValue);
          break;
        }
      }
    }
    Color fallback;
    if (task.type == TaskType.assignment) {
      fallback = selected ? Colors.blue[200]! : Colors.blueAccent;
    } else {
      fallback = selected ? Colors.white60 : Colors.black38;
    }
    if (subjectColor == null) return fallback;
    if (selected) {
      // Keep the dot visible on the black selected cell.
      return HSLColor.fromColor(subjectColor)
          .withLightness((HSLColor.fromColor(subjectColor).lightness + 0.35)
              .clamp(0.0, 1.0))
          .toColor();
    }
    return subjectColor;
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);

    // Active tasks per day (for the dots)
    final tasksByDay = <DateTime, List<Task>>{};
    for (final t in provider.tasks) {
      if (t.isDone) continue;
      final key = dayKey(t.date);
      tasksByDay.putIfAbsent(key, () => []).add(t);
    }

    final first = DateTime(month.year, month.month, 1);
    final leading = first.subtract(Duration(days: first.weekday - 1));
    final rowCount = rowCountFor(month);

    // Same horizontal padding as the weekday labels row so they line up
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        children: List.generate(rowCount, (row) {
          return Row(
            children: List.generate(7, (col) {
              final day = leading.add(Duration(days: row * 7 + col));
              final isOutside = day.month != month.month;

              if (isOutside) {
                return const Expanded(child: SizedBox(height: cellHeight + 4));
              }

              return _DayCell(
                day: day,
                isSelected: sameDay(day, selectedDate),
                isToday: sameDay(day, DateTime.now()),
                tasks: tasksByDay[dayKey(day)] ?? const [],
                projects: provider.projects,
                onDaySelected: onDaySelected,
                onTaskDropped: onTaskDropped,
              );
            }),
          );
        }),
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  final DateTime day;
  final bool isSelected;
  final bool isToday;
  final List<Task> tasks;
  final List<Project> projects;
  final ValueChanged<DateTime> onDaySelected;
  final void Function(Task task, DateTime day) onTaskDropped;

  const _DayCell({
    required this.day,
    required this.isSelected,
    required this.isToday,
    required this.tasks,
    required this.projects,
    required this.onDaySelected,
    required this.onTaskDropped,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Padding(
        padding: EdgeInsets.all(2),
        child: DragTarget<Task>(
          onWillAcceptWithDetails: (details) =>
              !sameDay(details.data.date, day),
          onAcceptWithDetails: (details) => onTaskDropped(details.data, day),
          builder: (context, candidate, _) {
            final hover = candidate.isNotEmpty;

            return GestureDetector(
              onTap: () => onDaySelected(day),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                curve: Curves.easeOutCubic,
                height: MonthGrid.cellHeight,
                decoration: BoxDecoration(
                  color: isSelected
                      ? context.ink
                      : hover
                          ? context.fillSoft
                          : context.card,
                  borderRadius: BorderRadius.circular(10),
                  // boxier edge light on every in-month day
                  border: isSelected
                      ? null
                      : hover
                          ? Border.all(color: context.ink, width: 2)
                          : isToday
                              ? Border.all(color: context.ink, width: 1.5)
                              : Border.all(color: context.hairline),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      day.day.toString(),
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: (isSelected || isToday)
                            ? FontWeight.bold
                            : FontWeight.normal,
                        color: isSelected ? context.inkInverse : context.ink,
                      ),
                    ),
                    SizedBox(height: 3),
                    _buildDots(),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  // Dots live inside the cell, under the number — always fully visible.
  Widget _buildDots() {
    if (tasks.isEmpty) return SizedBox(height: 5);

    final shown = tasks.take(3).toList();

    return SizedBox(
      height: 5,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: shown.map((t) {
          final isMilestone = t.parentTaskId != null;
          final color = MonthGrid._dotColor(t, projects, isSelected);
          // milestones ring in a super-light blue of their own
          final ringColor = isMilestone
              ? (isSelected ? Colors.blue[100]! : Colors.blue[200]!)
              : color;

          return Container(
            margin: EdgeInsets.symmetric(horizontal: 1.5),
            width: 5,
            height: 5,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: isMilestone ? Colors.transparent : color,
              border:
                  isMilestone ? Border.all(color: ringColor, width: 1.4) : null,
            ),
          );
        }).toList(),
      ),
    );
  }
}
