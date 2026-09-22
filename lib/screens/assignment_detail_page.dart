import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/subtask.dart';
import '../widgets/note_rich_content.dart';
import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import 'add_task_sheet.dart';
import 'notes_editor_sheet.dart';
import 'subtask_editor_sheet.dart';

// The assignment workspace — one focused world per assignment: live status
// bar, countdown to the due date, full subtask breakdown, notes and focus.
class AssignmentDetailPage extends StatefulWidget {
  final String taskId;

  const AssignmentDetailPage({super.key, required this.taskId});

  @override
  AssignmentDetailPageState createState() => AssignmentDetailPageState();
}

class AssignmentDetailPageState extends State<AssignmentDetailPage> {

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);

    Task? found;
    for (final t in provider.tasks) {
      if (t.id == widget.taskId) {
        found = t;
        break;
      }
    }

    if (found == null) {
      // The task was deleted while we were viewing it — just close
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && Navigator.canPop(context)) Navigator.pop(context);
      });
      return Scaffold(body: SizedBox());
    }

    // effectively-final, non-nullable handle for the closures below
    final task = found;

    final doneSubs = task.subtasks.where((s) => s.isDone).length;
    final totalSubs = task.subtasks.length;

    final minutesLeft = task.remainingMinutes > 0
        ? task.remainingMinutes
        : task.durationMinutes;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            // TOP BAR
            Padding(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 6),
              child: Row(
                children: [
                  IconButton(
                    icon: Icon(Icons.arrow_back),
                    onPressed: () => Navigator.pop(context),
                  ),
                  Spacer(),
                  IconButton(
                    icon: Icon(Icons.edit_outlined),
                    onPressed: () =>
                        showAddTaskDialog(context, existingTask: task),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: EdgeInsets.fromLTRB(20, 4, 20, 40),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // DUE ROW
                    Row(
                      children: [
                        Container(
                          padding:
                              EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: context.ink,
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: Text(
                            DateFormat('EEE, MMM d').format(task.date),
                            style: TextStyle(
                                fontSize: 11,
                                color: context.inkInverse,
                                fontWeight: FontWeight.w600),
                          ),
                        ),
                        SizedBox(width: 10),
                        Text(
                          _dueCountdown(task.date, isDone: task.isDone),
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: _isOverdue(task.date, isDone: task.isDone)
                                ? Colors.red
                                : context.inkSoft,
                          ),
                        ),
                        Spacer(),
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
                                  size: 12,
                                  color: difficultyColor(task.difficulty)),
                              SizedBox(width: 3),
                              Text('Lvl ${task.difficulty}',
                                  style: TextStyle(
                                      fontSize: 10,
                                      fontWeight: FontWeight.w600,
                                      color: difficultyColor(task.difficulty))),
                            ],
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 14),

                    Text(
                      task.title,
                      style:
                          TextStyle(fontSize: 26, fontWeight: FontWeight.w500),
                    ),

                    SizedBox(height: 18),

                    // STATUS BAR
                    Container(
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
                      child: Column(
                        children: [
                          Row(
                            children: [
                              _ring(context, doneSubs, totalSubs),
                              _vDiv(),
                              _stat(
                                  Icons.schedule,
                                  minutesLeft == 0
                                      ? '0m'
                                      : formatDuration(minutesLeft),
                                  'work left'),
                              _vDiv(),
                              _stat(
                                  Icons.hourglass_bottom,
                                  _dueShort(task.date, isDone: task.isDone),
                                  task.isDone
                                      ? 'complete'
                                      : _isOverdue(task.date,
                                              isDone: task.isDone)
                                          ? 'overdue'
                                          : 'to due'),
                              _vDiv(),
                              _stat(
                                  Icons.checklist_rounded,
                                  totalSubs == 0
                                      ? '—'
                                      : '${totalSubs - doneSubs}/$totalSubs',
                                  'subtasks'),
                            ],
                          ),
                          SizedBox(height: 14),
                          ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: totalSubs == 0
                                  ? (task.isDone ? 1 : 0)
                                  : doneSubs / totalSubs,
                              backgroundColor: context.fillSoft,
                              color: context.ink,
                              minHeight: 4,
                            ),
                          ),
                          SizedBox(height: 14),
                          SizedBox(
                            width: double.infinity,
                            height: 42,
                            child: AnimatedSwitcher(
                              duration: const Duration(milliseconds: 150),
                              child: ElevatedButton.icon(
                                key: ValueKey(task.isDone),
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: task.isDone
                                      ? context.fillSoft
                                      : context.ink,
                                  foregroundColor: task.isDone
                                      ? context.inkSoft
                                      : context.inkInverse,
                                  elevation: 0,
                                  shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(14)),
                                ),
                                onPressed: () => provider.toggleTask(task.id),
                                icon: Icon(
                                  task.isDone
                                      ? Icons.check
                                      : Icons.check_circle_outline,
                                  size: 18,
                                ),
                                label: Text(
                                  task.isDone
                                      ? 'Completed — tap to reopen'
                                      : 'Mark as done',
                                  style: TextStyle(
                                      fontSize: 13.5,
                                      fontWeight: FontWeight.w600),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),

                    SizedBox(height: 26),

                    // SUBTASKS
                    _caption(
                        'SUBTASKS${totalSubs > 0 ? '  ·  $doneSubs/$totalSubs' : ''}'),
                    SizedBox(height: 10),
                    ...task.subtasks
                        .map((s) => _subtaskTile(context, provider, task, s)),
                    _addSubtaskButton(context, task),

                    SizedBox(height: 22),

                    // NOTES
                    Row(
                      children: [
                        _caption('NOTES'),
                        Spacer(),
                        GestureDetector(
                          onTap: () => showNotesEditor(context, task),
                          child: Row(
                            children: [
                              Icon(Icons.edit_outlined,
                                  size: 14, color: context.inkSoft),
                              SizedBox(width: 4),
                              Text('Edit',
                                  style: TextStyle(
                                      fontSize: 12,
                                      color: context.inkSoft,
                                      fontWeight: FontWeight.w600)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    SizedBox(height: 10),
                    GestureDetector(
                      onTap: () => showNotesEditor(context, task),
                      child: Container(
                        width: double.infinity,
                        padding: EdgeInsets.all(16),
                        decoration: BoxDecoration(
                          color: context.fillSoft,
                          borderRadius: BorderRadius.circular(14),
                        ),
                        child: NoteRichContent(
                          content: task.notes,
                          emptyText: 'No notes yet — tap to write.',
                        ),
                      ),
                    ),

                    SizedBox(height: 26),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _caption(String text) => Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
          color: context.inkFaint,
        ),
      );

  Widget _vDiv() => Container(
        width: 1,
        height: 30,
        color: context.hairline,
        margin: EdgeInsets.symmetric(horizontal: 4),
      );

  Widget _ring(BuildContext context, int done, int total) {
    final progress = total == 0 ? 0.0 : done / total;
    return Row(
      children: [
        SizedBox(
          width: 32,
          height: 32,
          child: Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 32,
                height: 32,
                child: CircularProgressIndicator(
                  value: progress.clamp(0.0, 1.0),
                  strokeWidth: 3,
                  strokeCap: StrokeCap.round,
                  color: context.ink,
                  backgroundColor: context.fillSoft,
                ),
              ),
              Icon(Icons.checklist_rounded, size: 13, color: context.inkSoft),
            ],
          ),
        ),
        SizedBox(width: 8),
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$done/$total',
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700)),
            Text('done', style: TextStyle(fontSize: 10, color: context.inkSoft)),
          ],
        ),
      ],
    );
  }

  Widget _stat(IconData icon, String value, String label) {
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

  Widget _subtaskTile(BuildContext context, TaskProvider provider, Task task,
      SubTask s) {
    final isMilestone = s.date != null;
    return InkWell(
      onTap: () => showSubtaskSheet(context, parentTask: task, existing: s),
      borderRadius: BorderRadius.circular(12),
      child: Container(
        margin: EdgeInsets.only(bottom: 6),
        padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: isMilestone ? context.fillSoft : context.card,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => provider.toggleSubtask(task.id, s.id),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 20,
                height: 20,
                decoration: BoxDecoration(
                  color: s.isDone ? context.ink : Colors.transparent,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(
                    color: s.isDone ? context.ink : context.hairline,
                    width: 1.8,
                  ),
                ),
                child: s.isDone
                    ? Icon(Icons.check, size: 13, color: context.inkInverse)
                    : null,
              ),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Text(
                s.title,
                style: TextStyle(
                  fontSize: 14.5,
                  decoration: s.isDone ? TextDecoration.lineThrough : null,
                  color: s.isDone ? context.inkSoft : context.ink,
                ),
              ),
            ),
            if (isMilestone) ...[
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                decoration: BoxDecoration(
                  color: context.fillSoft,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text('MILESTONE',
                    style: TextStyle(
                        fontSize: 8,
                        letterSpacing: 0.3,
                        color: context.inkSoft,
                        fontWeight: FontWeight.bold)),
              ),
            ],
            if (s.date != null) ...[
              const SizedBox(width: 6),
              Text(
                DateFormat('MMM d').format(s.date!),
                style: TextStyle(fontSize: 11, color: context.inkSoft),
              ),
            ],
            IconButton(
              tooltip: s.date == null ? 'Schedule milestone' : 'Change date',
              icon:
                  Icon(Icons.event_outlined, size: 18, color: context.inkSoft),
              onPressed: () => _pickSubtaskDate(provider, task, s),
              visualDensity: VisualDensity.compact,
              padding: EdgeInsets.zero,
              constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
            ),
            if (s.date != null)
              IconButton(
                tooltip: 'Clear milestone date',
                icon: Icon(Icons.event_busy_outlined,
                    size: 18, color: context.inkSoft),
                onPressed: () => provider.scheduleSubtask(task.id, s.id, null),
                visualDensity: VisualDensity.compact,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(minWidth: 30, minHeight: 30),
              ),
            GestureDetector(
              onTap: () => provider.deleteSubtask(task.id, s.id),
              child: Icon(Icons.close, size: 16, color: context.inkFaint),
            ),
          ],
        ),
      ),
    );
  }

  Widget _addSubtaskButton(BuildContext context, Task task) {
    return SizedBox(
      width: double.infinity,
      height: 46,
      child: OutlinedButton.icon(
        onPressed: () => showSubtaskSheet(context, parentTask: task),
        style: OutlinedButton.styleFrom(
          foregroundColor: context.ink,
          side: BorderSide(color: context.hairline),
          shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(14)),
        ),
        icon: const Icon(Icons.add, size: 19),
        label: const Text('Add subtask',
            style: TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
      ),
    );
  }

  Future<void> _pickSubtaskDate(
      TaskProvider provider, Task task, SubTask subtask) async {
    final today = DateTime.now();
    final firstDate = DateTime(today.year - 5, 1, 1);
    final lastDate = DateTime(today.year + 10, 12, 31);
    final requestedDate = subtask.date ?? task.date;
    final initialDate = requestedDate.isBefore(firstDate)
        ? firstDate
        : requestedDate.isAfter(lastDate)
            ? lastDate
            : requestedDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: initialDate,
      firstDate: firstDate,
      lastDate: lastDate,
    );
    if (picked != null && mounted) {
      provider.scheduleSubtask(task.id, subtask.id, picked);
    }
  }

  bool _isOverdue(DateTime date, {bool isDone = false}) {
    return isTaskOverdue(date, isDone: isDone);
  }

  String _dueCountdown(DateTime date, {bool isDone = false}) {
    if (isDone) return 'Completed';
    final now = DateTime.now();
    final days = DateTime(date.year, date.month, date.day)
        .difference(DateTime(now.year, now.month, now.day))
        .inDays;
    if (days < 0) return '${-days}d overdue';
    if (days == 0) return 'Due today';
    if (days == 1) return 'Due tomorrow';
    return 'Due in $days days';
  }

  String _dueShort(DateTime date, {bool isDone = false}) {
    if (isDone) return 'done';
    final now = DateTime.now();
    final days = DateTime(date.year, date.month, date.day)
        .difference(DateTime(now.year, now.month, now.day))
        .inDays;
    if (days < 0) return '${-days}d';
    if (days == 0) return 'today';
    return '${days}d';
  }
}
