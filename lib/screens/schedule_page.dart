import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import 'assignment_detail_page.dart';
import 'task_detail_sheet.dart';

// Agenda: only days that have tasks are listed; runs of empty days collapse
// into a single "Aug 17 – 23" gap line. Times use the 15.00–15.30 style.
class SchedulePage extends StatelessWidget {
  const SchedulePage({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    final tasks = provider.tasks
        .where((t) => !t.date.isBefore(today))
        .toList()
      ..sort((a, b) {
        final c = a.date.compareTo(b.date);
        if (c != 0) return c;
        final as_ = a.startTime;
        final bs = b.startTime;
        if (as_ == null && bs == null) return 0;
        if (as_ == null) return 1;
        if (bs == null) return -1;
        return as_.compareTo(bs);
      });

    // Group by day
    final days = <DateTime, List<Task>>{};
    for (final t in tasks) {
      days.putIfAbsent(
          DateTime(t.date.year, t.date.month, t.date.day), () => []).add(t);
    }
    final sortedDays = days.keys.toList()..sort();

    return Scaffold(
      appBar: AppBar(
        title: Text('Schedule',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.w600)),
      ),
      body: sortedDays.isEmpty
          ? Center(
              child: Text('Nothing scheduled',
                  style: TextStyle(color: context.inkFaint, fontSize: 15)),
            )
          : ListView.builder(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 40),
              itemCount: sortedDays.length,
              itemBuilder: (context, index) {
                final day = sortedDays[index];
                final dayTasks = days[day]!;

                // Empty days between the previous task day and this one
                Widget? gap;
                if (index > 0) {
                  final prev = sortedDays[index - 1];
                  final emptyDays = day.difference(prev).inDays - 1;
                  if (emptyDays > 0) {
                    gap = _GapLine(from: prev.add(const Duration(days: 1)),
                        to: day.subtract(const Duration(days: 1)));
                  }
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (gap != null) gap,
                    Padding(
                      padding: const EdgeInsets.fromLTRB(4, 14, 4, 10),
                      child: Row(
                        children: [
                          Text(
                            DateFormat('EEEE, MMM d').format(day),
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              color: context.ink,
                            ),
                          ),
                          const SizedBox(width: 8),
                          Text('${dayTasks.length}',
                              style: TextStyle(
                                  fontSize: 12, color: context.inkFaint)),
                          const Spacer(),
                          if (day == today)
                            Container(
                              padding: const EdgeInsets.symmetric(
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
                    ...dayTasks.map((t) => _ScheduleRow(task: t)),
                  ],
                );
              },
            ),
    );
  }
}

class _GapLine extends StatelessWidget {
  final DateTime from;
  final DateTime to;

  const _GapLine({required this.from, required this.to});

  @override
  Widget build(BuildContext context) {
    final sameMonth = from.month == to.month;
    final text = sameMonth
        ? '${DateFormat('MMM d').format(from)} – ${DateFormat('d').format(to)}'
        : '${DateFormat('MMM d').format(from)} – ${DateFormat('MMM d').format(to)}';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        children: [
          Expanded(
            child: Divider(thickness: 1, color: context.hairline),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              text,
              style: TextStyle(
                  fontSize: 11.5,
                  color: context.inkFaint,
                  fontWeight: FontWeight.w500),
            ),
          ),
          Expanded(
            child: Divider(thickness: 1, color: context.hairline),
          ),
        ],
      ),
    );
  }
}

class _ScheduleRow extends StatelessWidget {
  final Task task;

  const _ScheduleRow({required this.task});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        if (task.type == TaskType.assignment) {
          Navigator.push(
              context,
              MaterialPageRoute(
                  builder: (_) => AssignmentDetailPage(taskId: task.id)));
        } else {
          showTaskDetails(context, task);
        }
      },
      child: Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            if (task.startTime != null)
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: context.ink,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  formatTimeRange(task.startTime!, task.durationMinutes),
                  style: TextStyle(
                      fontSize: 10,
                      color: context.inkInverse,
                      fontWeight: FontWeight.w600),
                ),
              )
            else
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: context.fillSoft,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  task.durationMinutes > 0
                      ? formatDuration(task.durationMinutes)
                      : '—',
                  style: TextStyle(
                      fontSize: 10,
                      color: context.inkSoft,
                      fontWeight: FontWeight.w600),
                ),
              ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  decoration: task.isDone ? TextDecoration.lineThrough : null,
                  color: task.isDone ? context.inkSoft : context.ink,
                ),
              ),
            ),
            if (task.subtasks.isNotEmpty) ...[
              const SizedBox(width: 8),
              Text(
                '${task.subtasks.where((s) => s.isDone).length}/${task.subtasks.length}',
                style: TextStyle(fontSize: 11, color: context.inkFaint),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
