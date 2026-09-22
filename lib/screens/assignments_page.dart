import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../models/task.dart';
import '../models/workspace_settings.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../widgets/chips.dart';
import 'assignment_detail_page.dart';

class AssignmentsPage extends StatelessWidget {
  const AssignmentsPage({super.key});

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);

    final all = provider.assignments;
    final upcoming = all.where((t) => !t.isDone).toList()
      ..sort((a, b) => a.date.compareTo(b.date));
    final completed = all.where((t) => t.isDone).toList()
      ..sort((a, b) => b.date.compareTo(a.date));

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final weekEnd = today.add(const Duration(days: 7));

    var dueThisWeek = 0;
    var minutesLeft = 0;
    var subTotal = 0;
    var subDone = 0;
    for (final t in upcoming) {
      if (!t.date.isBefore(weekEnd) || t.date.isBefore(today)) continue;
      dueThisWeek++;
      minutesLeft +=
          t.remainingMinutes > 0 ? t.remainingMinutes : t.durationMinutes;
      subTotal += t.subtasks.length;
      subDone += t.subtasks.where((s) => s.isDone).length;
    }

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // HEADER — same font as the daily view's weekday title
            Padding(
              padding: EdgeInsets.fromLTRB(20, 20, 20, 6),
              child: Row(
                children: [
                  Text(
                    'Assignments',
                    style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            // STATUS BAR
            Padding(
              padding: EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: Container(
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
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
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _IconStat(
                        icon: Icons.event,
                        value: '$dueThisWeek',
                        label: 'due this week'),
                    _statDivider(context),
                    _IconStat(
                        icon: Icons.schedule,
                        value: minutesLeft == 0
                            ? '0m'
                            : formatDuration(minutesLeft),
                        label: 'est. work'),
                    _statDivider(context),
                    _IconStat(
                        icon: Icons.checklist_rounded,
                        value: subTotal == 0 ? '—' : '$subDone/$subTotal',
                        label: 'subtasks'),
                  ],
                ),
              ),
            ),
            Expanded(
              child: upcoming.isEmpty && completed.isEmpty
                  ? Center(
                      child: FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.school_outlined,
                                size: 64, color: context.inkFaint),
                            SizedBox(height: 16),
                            Text(
                              all.isEmpty
                                  ? 'No assignments'
                                  : 'All done — every assignment is complete',
                              style: TextStyle(
                                  color: context.inkSoft, fontSize: 16),
                            ),
                            if (all.isEmpty) ...[
                              SizedBox(height: 6),
                              Text(
                                'Add one with the New Task button and pick “Assignment”.',
                                style: TextStyle(
                                    color: context.inkFaint, fontSize: 13),
                              ),
                            ],
                          ],
                        ),
                      ),
                    )
                  : _AssignmentList(
                      upcoming: upcoming, completed: completed),
            ),
          ],
        ),
      ),
    );
  }

  Widget _statDivider([BuildContext? context]) => Container(
        width: 1,
        height: 30,
        color: context?.hairline ?? Colors.grey.shade200,
        margin: EdgeInsets.symmetric(horizontal: 4),
      );
}

class _AssignmentList extends StatelessWidget {
  final List<Task> upcoming;
  final List<Task> completed;

  const _AssignmentList({required this.upcoming, required this.completed});

  @override
  Widget build(BuildContext context) {
    // Flatten month headers + tasks
    final items = <(String?, Task?)>[];
    String? lastLabel;
    for (final t in upcoming) {
      final label = DateFormat('MMMM yyyy').format(t.date).toUpperCase();
      if (label != lastLabel) {
        items.add((label, null));
        lastLabel = label;
      }
      items.add((null, t));
    }
    if (completed.isNotEmpty) {
      items.add(('COMPLETED', null));
      items.addAll(completed.map((t) => (null, t)));
    }

    return ListView.builder(
      padding: EdgeInsets.fromLTRB(16, 4, 16, 175),
      itemCount: items.length,
      itemBuilder: (context, index) {
        final (label, task) = items[index];
        if (label != null) {
          return Padding(
            padding: EdgeInsets.fromLTRB(4, 16, 4, 8),
            child: Text(
              label,
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 1.2,
                color: context.inkFaint,
              ),
            ),
          );
        }
        return _AssignmentCard(task: task!);
      },
    );
  }
}

class _AssignmentCard extends StatelessWidget {
  final Task task;

  const _AssignmentCard({required this.task});

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context, listen: false);
    final settings = provider.workspaceSettings;
    final doneSubs = task.subtasks.where((s) => s.isDone).length;
    final totalSubs = task.subtasks.length;

    final now = DateTime.now();
    final daysLeft = DateTime(task.date.year, task.date.month, task.date.day)
        .difference(DateTime(now.year, now.month, now.day))
        .inDays;
    final isOverdue = isTaskOverdue(task.date, isDone: task.isDone);
    final isSoon = daysLeft <= 1;

    var subject = _subjectOf(provider, task.projectId);
    TaskLabel? label;
    if (task.category != 'General') {
      for (final candidate in settings.labels) {
        if (candidate.name == task.category) {
          label = candidate;
          break;
        }
      }
    }

    return GestureDetector(
      onTap: () => Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => AssignmentDetailPage(taskId: task.id)),
      ),
      child: Container(
        margin: EdgeInsets.only(bottom: 12),
        padding: EdgeInsets.all(16),
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
        child: Opacity(
          opacity: task.isDone ? 0.55 : 1.0,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    padding: EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: context.ink,
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      DateFormat('MMM d').format(task.date),
                      style: TextStyle(
                          fontSize: 11,
                          color: context.inkInverse,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                  SizedBox(width: 10),
                  Text(
                    formatDueLabel(task.date, isDone: task.isDone),
                    style: TextStyle(
                      fontSize: 11.5,
                      fontWeight: isSoon ? FontWeight.w600 : FontWeight.w500,
                      color: isOverdue
                          ? Colors.red[700]
                          : isSoon
                              ? context.ink
                              : context.inkSoft,
                    ),
                  ),
                  Spacer(),
                  if (settings.showDifficulty)
                    Container(
                      padding:
                          EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: context.fillSoft,
                        borderRadius: BorderRadius.circular(6),
                      ),
                      child: Row(
                        children: [
                          Icon(Icons.signal_cellular_alt,
                              size: 12, color: difficultyColor(task.difficulty)),
                          SizedBox(width: 3),
                          Text(
                            'Lvl ${task.difficulty}',
                            style: TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: difficultyColor(task.difficulty)),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
              SizedBox(height: 12),
              Text(
                task.title,
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w500,
                  decoration: task.isDone ? TextDecoration.lineThrough : null,
                ),
              ),
              SizedBox(height: 8),
              Wrap(
                spacing: 12,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.access_time, size: 13, color: context.inkSoft),
                      SizedBox(width: 4),
                      Text(
                        task.durationMinutes > 0
                            ? formatDuration(task.durationMinutes)
                            : 'No time set',
                        style: TextStyle(
                            fontSize: 11.5, color: context.inkSoft),
                      ),
                    ],
                  ),
                  if (subject != null && settings.showSubject)
                    SubjectTag(
                        name: subject.title,
                        color: Color(subject.colorValue)),
                  if (label != null && settings.showLabels)
                    LabelChip(
                        name: label.name, color: Color(label.colorValue)),
                  if (totalSubs > 0) ...[
                    ClipRRect(
                      borderRadius: BorderRadius.circular(4),
                      child: SizedBox(
                        width: 54,
                        height: 4,
                        child: LinearProgressIndicator(
                          value: doneSubs / totalSubs,
                          backgroundColor: context.fillSoft,
                          color: context.ink,
                          minHeight: 4,
                        ),
                      ),
                    ),
                    Text('$doneSubs/$totalSubs',
                        style: TextStyle(
                            fontSize: 11.5,
                            color: context.inkSoft,
                            fontWeight: FontWeight.w600)),
                  ],
                  if (task.notes.isNotEmpty) ...[
                    Icon(Icons.sticky_note_2_outlined,
                        size: 13, color: context.inkFaint),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  static Project? _subjectOf(TaskProvider provider, String? id) {
    if (id == null) return null;
    for (final project in provider.projects) {
      if (project.id == id) return project;
    }
    return null;
  }
}

class _IconStat extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;

  const _IconStat({
    required this.icon,
    required this.value,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: context.inkFaint),
        SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(value,
                style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: context.ink)),
            Text(label, style: TextStyle(fontSize: 10, color: context.inkSoft)),
          ],
        ),
      ],
    );
  }
}
