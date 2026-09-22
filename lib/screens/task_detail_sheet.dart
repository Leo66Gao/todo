import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/subtask.dart';
import '../models/task.dart';
import '../theme/app_theme.dart';
import '../widgets/note_rich_content.dart';
import '../state/task_provider.dart';
import '../utils/task_formatters.dart';
import 'add_task_sheet.dart';
import 'notes_editor_sheet.dart';
import 'subtask_editor_sheet.dart';

void showTaskDetails(BuildContext context, Task task) {
  final subtaskController = TextEditingController();

  showModalBottomSheet(
    context: context,
    shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    backgroundColor: context.card,
    isScrollControlled: true,
    builder: (context) {
      return Consumer<TaskProvider>(builder: (context, provider, child) {
        // Refresh task object from provider to get latest data
        final currentTask = provider.tasks
            .firstWhere((t) => t.id == task.id, orElse: () => task);

        final doneSubs = currentTask.subtasks.where((s) => s.isDone).length;
        final totalSubs = currentTask.subtasks.length;
        final subProgress = totalSubs == 0 ? 0.0 : doneSubs / totalSubs;

        final isTimed = currentTask.startTime != null;
        final duration = currentTask.remainingMinutes > 0
            ? currentTask.remainingMinutes
            : currentTask.durationMinutes;

        return SafeArea(
          child: Container(
            padding: EdgeInsets.fromLTRB(
                24, 24, 24, MediaQuery.of(context).viewInsets.bottom + 24),
            width: double.infinity,
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: context.hairline,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  SizedBox(height: 22),

                  Text(currentTask.title,
                      style:
                          TextStyle(fontSize: 24, fontWeight: FontWeight.w600)),

                  SizedBox(height: 16),

                  // INFO CHIPS — date, time range, time needed, level,
                  // always on one level (scales down if narrow)
                  FittedBox(
                    fit: BoxFit.scaleDown,
                    alignment: Alignment.centerLeft,
                    child: Row(
                      children: [
                        _InfoChip(
                          icon: Icons.calendar_today,
                          label:
                              DateFormat('MMM d').format(currentTask.date),
                          dark: true,
                        ),
                        SizedBox(width: 8),
                        if (isTimed) ...[
                          _InfoChip(
                            icon: Icons.schedule,
                            label: formatTimeRange(
                                currentTask.startTime!, duration),
                          ),
                          SizedBox(width: 8),
                        ],
                        _InfoChip(
                          icon: Icons.hourglass_bottom,
                          label: duration > 0
                              ? formatDuration(duration)
                              : 'No time set',
                        ),
                        // Priority appears only when it was actually set
                        // (anything other than none); the level chip only
                        // when the task is levelled above the default Lvl 1.
                        if (currentTask.priority != TaskPriority.none) ...[
                          SizedBox(width: 8),
                          _InfoChip(
                            icon: Icons.flag_rounded,
                            label: priorityLabel(currentTask.priority),
                            iconColor: priorityColor(
                                context, currentTask.priority),
                            textColor: priorityColor(
                                context, currentTask.priority),
                          ),
                        ],
                        if (currentTask.difficulty > 1) ...[
                          SizedBox(width: 8),
                          _InfoChip(
                            icon: Icons.signal_cellular_alt,
                            label: 'Lvl ${currentTask.difficulty}',
                            iconColor:
                                difficultyColor(currentTask.difficulty),
                            textColor:
                                difficultyColor(currentTask.difficulty),
                          ),
                        ],
                      ],
                    ),
                  ),

                  SizedBox(height: 26),

                  // SUBTASKS
                  Row(
                    children: [
                      _caption(context, 'SUBTASKS'),
                      Spacer(),
                      if (totalSubs > 0) ...[
                        SizedBox(
                          width: 70,
                          height: 4,
                          child: ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: LinearProgressIndicator(
                              value: subProgress,
                              backgroundColor: context.fillSoft,
                              color: context.ink,
                              minHeight: 4,
                            ),
                          ),
                        ),
                        SizedBox(width: 8),
                        Text("$doneSubs/$totalSubs",
                            style: TextStyle(
                                fontSize: 11,
                                color: context.inkSoft,
                                fontWeight: FontWeight.w600)),
                      ],
                    ],
                  ),
                  SizedBox(height: 10),
                  ...currentTask.subtasks.map((s) => _subtaskTile(
                      context, provider, currentTask, s)),
                  _addSubtaskField(
                      context, provider, currentTask, subtaskController),

                  SizedBox(height: 22),

                  // NOTES
                  Row(
                    children: [
                      _caption(context, 'NOTES'),
                      Spacer(),
                      GestureDetector(
                        onTap: () => showNotesEditor(context, currentTask),
                        child: Row(
                          children: [
                            Icon(Icons.edit_outlined,
                                size: 14, color: context.inkSoft),
                            SizedBox(width: 4),
                            Text("Edit",
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
                    onTap: () => showNotesEditor(context, currentTask),
                    child: Container(
                      width: double.infinity,
                      padding: EdgeInsets.all(16),
                      decoration: BoxDecoration(
                          color: context.fillSoft,
                          borderRadius: BorderRadius.circular(14)),
                      child: NoteRichContent(
                        content: currentTask.notes,
                        emptyText: 'No notes yet — tap to write.',
                      ),
                    ),
                  ),

                  SizedBox(height: 26),

                  // ACTIONS
                  Row(
                    children: [
                      Expanded(
                        child: AnimatedSwitcher(
                          duration: const Duration(milliseconds: 150),
                          child: ElevatedButton.icon(
                            key: ValueKey(currentTask.isDone),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: currentTask.isDone
                                  ? context.fillSoft
                                  : context.ink,
                              foregroundColor: currentTask.isDone
                                  ? context.inkSoft
                                  : context.inkInverse,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14)),
                            ),
                            onPressed: () =>
                                provider.toggleTask(currentTask.id),
                            icon: Icon(
                              currentTask.isDone
                                  ? Icons.check
                                  : Icons.check_circle_outline,
                              size: 18,
                            ),
                            label: Text(
                              currentTask.isDone ? 'Completed' : 'Mark as done',
                              style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600),
                            ),
                          ),
                        ),
                      ),
                      SizedBox(width: 10),
                      Expanded(
                        child: OutlinedButton.icon(
                          style: OutlinedButton.styleFrom(
                            foregroundColor: context.ink,
                            side: BorderSide(color: context.hairline),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14)),
                          ),
                          onPressed: () {
                            Navigator.pop(context);
                            showAddTaskDialog(context,
                                existingTask: currentTask);
                          },
                          icon: Icon(Icons.edit_outlined, size: 18),
                          label: Text('Edit',
                              style: TextStyle(
                                  fontSize: 13.5,
                                  fontWeight: FontWeight.w600)),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        );
      });
    },
  );
}

Widget _caption(BuildContext context, String text) => Text(
      text,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        letterSpacing: 1.2,
        color: context.inkFaint,
      ),
    );

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool dark;
  final Color? iconColor;
  final Color? textColor;

  const _InfoChip({
    required this.icon,
    required this.label,
    this.dark = false,
    this.iconColor,
    this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    final fg = dark ? context.inkInverse : (textColor ?? context.ink);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: dark ? context.ink : context.fillSoft,
        borderRadius: BorderRadius.circular(10),
        border: dark ? null : Border.all(color: context.hairline),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon,
              size: 14,
              color: iconColor ?? (dark ? context.inkInverse : context.inkSoft)),
          SizedBox(width: 6),
          Text(label,
              style: TextStyle(
                  fontSize: 12, fontWeight: FontWeight.w600, color: fg)),
        ],
      ),
    );
  }
}

Widget _subtaskTile(BuildContext context, TaskProvider provider, Task task,
    SubTask s) {
  return InkWell(
    onTap: () => provider.toggleSubtask(task.id, s.id),
    // Long-press opens the subtask for editing (title, milestone, priority,
    // difficulty) — the same sheet the assignment screens use.
    onLongPress: () => showSubtaskSheet(context, parentTask: task, existing: s),
    borderRadius: BorderRadius.circular(12),
    child: Container(
      margin: EdgeInsets.only(bottom: 6),
      padding: EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: context.card,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: context.hairline),
      ),
      child: Row(
        children: [
          AnimatedContainer(
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
          SizedBox(width: 12),
          Expanded(
            child: Text(
              s.title,
              style: TextStyle(
                fontSize: 14.5,
                decoration: s.isDone ? TextDecoration.lineThrough : null,
                color: s.isDone ? context.inkFaint : context.ink,
              ),
            ),
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

Widget _addSubtaskField(BuildContext context, TaskProvider provider,
    Task task, TextEditingController controller) {
  return Container(
    padding: EdgeInsets.symmetric(horizontal: 12),
    decoration: BoxDecoration(
      color: context.fillSoft,
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: context.hairline),
    ),
    child: Row(
      children: [
        Expanded(
          child: TextField(
            controller: controller,
            decoration: InputDecoration(
              hintText: 'Add subtask…',
              hintStyle: TextStyle(color: context.inkFaint, fontSize: 14),
              isDense: true,
              border: InputBorder.none,
            ),
            onSubmitted: (val) {
              if (val.isNotEmpty) {
                provider.addSubtask(task.id, val);
                controller.clear();
              }
            },
          ),
        ),
        IconButton(
          icon: Icon(Icons.add, color: context.inkSoft),
          onPressed: () {
            if (controller.text.isNotEmpty) {
              provider.addSubtask(task.id, controller.text);
              controller.clear();
            }
          },
        ),
      ],
    ),
  );
}
