import 'package:flutter/material.dart';

import '../models/task.dart';
import '../theme/app_theme.dart';

/// Display label for a task priority.
String priorityLabel(TaskPriority priority) => switch (priority) {
      TaskPriority.none => 'None',
      TaskPriority.low => 'Low',
      TaskPriority.medium => 'Medium',
      TaskPriority.high => 'High',
      TaskPriority.critical => 'Critical',
    };

/// Colour of a priority. The coding ladder is green (low) → yellow (medium)
/// → orange (high) → red (critical); `none` falls back to the quiet
/// hairline used by the complete button when no priority is set.
Color priorityColor(BuildContext context, TaskPriority priority) =>
    switch (priority) {
      TaskPriority.none => context.hairline,
      TaskPriority.low => Colors.green.shade600,
      TaskPriority.medium => Colors.yellow.shade700,
      TaskPriority.high => Colors.orange.shade700,
      TaskPriority.critical => Colors.red.shade600,
    };

String formatDuration(int minutes) {
  if (minutes == 0) return "No time set";
  if (minutes < 60) return "${minutes}m";

  int h = minutes ~/ 60;
  int m = minutes % 60;
  if (m == 0) return "${h}h";

  return "${h}h ${m}m";
}

String _two(int n) => n.toString().padLeft(2, '0');

// 15.30-style clock
String formatClock(DateTime t) => '${_two(t.hour)}.${_two(t.minute)}';

String formatTimeOfDay(TimeOfDay t) => '${_two(t.hour)}.${_two(t.minute)}';

// 15.00–15.30 when there's a duration, otherwise just the start
String formatTimeRange(DateTime start, int minutes) {
  if (minutes <= 0) return formatClock(start);
  return '${formatClock(start)}–${formatClock(start.add(Duration(minutes: minutes)))}';
}

DateTime _dateOnly(DateTime date) => DateTime(date.year, date.month, date.day);

/// Returns whether [date] is in the past for an unfinished task.
///
/// Completion always wins over the calendar date, so completed work cannot be
/// reported as overdue by any screen that uses this helper.
bool isTaskOverdue(DateTime date, {bool isDone = false}) {
  if (isDone) return false;
  return _dateOnly(date).isBefore(_dateOnly(DateTime.now()));
}

/// Formats the short due status used by assignment lists and detail views.
String formatDueLabel(DateTime date, {bool isDone = false}) {
  if (isDone) return 'Completed';
  final days = _dateOnly(date).difference(_dateOnly(DateTime.now())).inDays;
  if (days < 0) return '${-days}d overdue';
  if (days == 0) return 'Today';
  if (days == 1) return 'Tomorrow';
  return 'In $days days';
}

Color difficultyColor(int level) {
  if (level <= 2) return Colors.green;
  if (level <= 3) return Colors.orange;
  return Colors.red;
}
