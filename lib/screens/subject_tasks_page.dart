import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../utils/workload.dart';
import 'assignment_detail_page.dart';
import 'task_detail_sheet.dart';

/// A focused agenda for one subject: everything still open, ordered by day —
/// the "what's left in this subject" view from the calendar menu.
class SubjectTasksPage extends StatelessWidget {
  final String subjectId;

  const SubjectTasksPage({super.key, required this.subjectId});

  void _openTask(BuildContext context, Task task) {
    if (task.parentTaskId != null || task.type == TaskType.assignment) {
      Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) =>
                AssignmentDetailPage(taskId: task.parentTaskId ?? task.id)),
      );
    } else {
      showTaskDetails(context, task);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final subject = provider.projects
        .where((p) => p.id == subjectId)
        .cast<Project?>()
        .firstOrNull;

    if (subject == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (Navigator.of(context).canPop()) Navigator.of(context).pop();
      });
      return const Scaffold(body: SizedBox());
    }

    final accent = Color(subject.colorValue);
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final open = provider.tasks
        .where((t) => t.projectId == subject.id && !t.isDone)
        .toList()
      ..sort((a, b) {
        final byDate = a.date.compareTo(b.date);
        if (byDate != 0) return byDate;
        final as = a.startTime;
        final bs = b.startTime;
        if (as == null && bs == null) return 0;
        if (as == null) return 1;
        if (bs == null) return -1;
        return as.compareTo(bs);
      });

    // Group by day
    final days = <DateTime, List<Task>>{};
    for (final t in open) {
      days.putIfAbsent(dayKey(t.date), () => []).add(t);
    }
    final sortedDays = days.keys.toList()..sort();

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
        title: Row(
          children: [
            Container(
              width: 11,
              height: 11,
              decoration:
                  BoxDecoration(color: accent, shape: BoxShape.circle),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: Text(subject.title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 18)),
            ),
          ],
        ),
      ),
      body: open.isEmpty
          ? Center(
              child: FittedBox(
                fit: BoxFit.scaleDown,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.verified_outlined,
                        size: 52, color: context.inkFaint),
                    const SizedBox(height: 12),
                    Text('Nothing left in ${subject.title}',
                        style: const TextStyle(
                            fontSize: 15.5, fontWeight: FontWeight.w600)),
                    const SizedBox(height: 6),
                    Text(
                      'Add tasks with this subject and they show up here.',
                      style:
                          TextStyle(color: context.inkSoft, fontSize: 13),
                    ),
                  ],
                ),
              ),
            )
          : SafeArea(
              child: ListView.builder(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 40),
                itemCount: sortedDays.length,
                itemBuilder: (context, index) {
                  final day = sortedDays[index];
                  final dayTasks = days[day]!;
                  final isOverdueDay = day.isBefore(today);
                  return Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.fromLTRB(4, 14, 4, 8),
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
                                    fontSize: 12,
                                    color: context.inkFaint)),
                            const Spacer(),
                            if (sameDay(day, today))
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
                              )
                            else if (isOverdueDay)
                              Text('overdue',
                                  style: TextStyle(
                                      fontSize: 11,
                                      color: Colors.red[700],
                                      fontWeight: FontWeight.w600)),
                          ],
                        ),
                      ),
                      ...dayTasks.map((task) => _SubjectTaskRow(
                            task: task,
                            isOverdue: isOverdueDay,
                            onTap: () => _openTask(context, task),
                          )),
                    ],
                  );
                },
              ),
            ),
    );
  }
}

class _SubjectTaskRow extends StatelessWidget {
  final Task task;
  final bool isOverdue;
  final VoidCallback onTap;

  const _SubjectTaskRow({
    required this.task,
    required this.isOverdue,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context, listen: false);
    final isMilestone = task.parentTaskId != null;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => provider.toggleTask(task.id),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(
                      color: context.hairline, width: 1.8),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: context.ink,
                ),
              ),
            ),
            if (isMilestone) ...[
              const SizedBox(width: 6),
              Icon(Icons.flag_outlined, size: 14, color: context.inkFaint),
            ],
            if (task.type == TaskType.assignment) ...[
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.blue[50],
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('DUE',
                    style: TextStyle(
                        fontSize: 8.5,
                        color: Colors.blue[800],
                        fontWeight: FontWeight.bold)),
              ),
            ],
            const SizedBox(width: 10),
            Text(
              formatDueLabel(task.date),
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: isOverdue ? Colors.red[700] : context.inkSoft,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
