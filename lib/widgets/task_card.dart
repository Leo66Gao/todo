import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/project.dart';
import '../models/subtask.dart';
import '../models/task.dart';
import '../models/workspace_settings.dart';
import '../screens/add_task_sheet.dart';
import '../screens/assignment_detail_page.dart';
import '../screens/notes_editor_sheet.dart';
import '../screens/task_detail_sheet.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import 'chips.dart';

// Task card used everywhere. Gestures, kept in separate zones so they never
// fight each other:
//   - grip strip (far left) : long-press to pick up and drop on another day
//   - tick box              : tap to complete; drag to reorder within the day
//   - right side            : tap to open; long-press to edit
//   - swipe left            : delete
class TaskCard extends StatefulWidget {
  final Task task;
  final int? index; // row index in the owning list (enables reorder)
  final bool dismissible; // swipe-to-delete (off in the week view)

  const TaskCard({
    super.key,
    required this.task,
    this.index,
    this.dismissible = true,
  });

  @override
  TaskCardState createState() => TaskCardState();
}

class TaskCardState extends State<TaskCard> {
  bool _expanded = false;

  void _openTask() {
    FocusScope.of(context).unfocus();
    if (widget.task.parentTaskId != null ||
        widget.task.type == TaskType.assignment) {
      Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => AssignmentDetailPage(
                taskId: widget.task.parentTaskId ?? widget.task.id)),
      );
    } else {
      showTaskDetails(context, widget.task);
    }
  }

  void _editTask() {
    FocusScope.of(context).unfocus();
    if (widget.task.parentTaskId != null) {
      _openTask();
      return;
    }
    showAddTaskDialog(context, existingTask: widget.task);
  }

  String _dueLabel(DateTime date, {bool isDone = false}) {
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

  Color _dueColor(DateTime date, {bool isDone = false}) {
    if (isDone) return context.inkSoft;
    final now = DateTime.now();
    final days = DateTime(date.year, date.month, date.day)
        .difference(DateTime(now.year, now.month, now.day))
        .inDays;
    if (days < 0) return Colors.red;
    if (days <= 1) return context.ink;
    return context.inkSoft;
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final provider = Provider.of<TaskProvider>(context);
    final settings = provider.workspaceSettings;
    final isAssignment = task.type == TaskType.assignment;
    final isMilestone = task.parentTaskId != null;
    Task? parentTask;
    if (task.parentTaskId != null) {
      for (final candidate in provider.tasks) {
        if (candidate.id == task.parentTaskId) {
          parentTask = candidate;
          break;
        }
      }
    }
    Project? subject;
    if (task.projectId != null) {
      for (final project in provider.projects) {
        if (project.id == task.projectId) {
          subject = project;
          break;
        }
      }
    }
    TaskLabel? label;
    if (task.category != 'General') {
      for (final candidate in settings.labels) {
        if (candidate.name == task.category) {
          label = candidate;
          break;
        }
      }
    }

    final doneSubs = task.subtasks.where((s) => s.isDone).length;
    final totalSubs = task.subtasks.length;

    // Quick pop whenever completion flips
    Widget card = TweenAnimationBuilder<double>(
      key: ValueKey('pop-${task.isDone}'),
      tween: Tween(begin: 0.94, end: 1.0),
      duration: const Duration(milliseconds: 220),
      curve: Curves.easeOutBack,
      builder: (context, scale, child) =>
          Transform.scale(scale: scale, child: child),
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        curve: Curves.easeOutCubic,
        opacity: task.isDone ? 0.5 : 1.0,
        child: Container(
          margin: const EdgeInsets.only(bottom: 12),
          padding: const EdgeInsets.fromLTRB(6, 14, 14, 14),
          decoration: BoxDecoration(
            color: context.card,
            borderRadius: BorderRadius.circular(20),
            // blue edge for assignments, a super-light blue wash for
            // milestones so they read as "part of an assignment" softly
            border: isAssignment
                ? Border.all(
                    color: Colors.blue.withValues(alpha: 0.3), width: 1.2)
                : isMilestone
                    ? Border.all(
                        color: Colors.blue.withValues(alpha: 0.16),
                        width: 1)
                    : Border.all(color: context.hairline),
            boxShadow: [
              BoxShadow(
                  color: Colors.black.withValues(alpha: 0.02),
                  blurRadius: 10,
                  offset: const Offset(0, 4))
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ASSIGNMENT TOP ROW — badge + due, close to the card border
              if (isAssignment || isMilestone)
                Padding(
                  padding: const EdgeInsets.only(left: 4, bottom: 10),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: isMilestone
                              ? Colors.blue[50]
                              : Colors.blue[50],
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(isMilestone ? 'MILESTONE' : 'ASSIGNMENT',
                            style: TextStyle(
                                fontSize: 8.5,
                                letterSpacing: 0.3,
                                color: isMilestone
                                    ? Colors.blue[300]
                                    : Colors.blue[800],
                                fontWeight: FontWeight.bold)),
                      ),
                      const SizedBox(width: 8),
                      if (isMilestone) ...[
                        Flexible(
                          child: Text(
                            parentTask?.title ?? 'Assignment',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 11.5,
                              fontWeight: FontWeight.w600,
                              color: context.ink,
                            ),
                          ),
                        ),
                        const SizedBox(width: 8),
                      ],
                      Flexible(
                        child: Text(
                          _dueLabel(task.date, isDone: task.isDone),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 11.5,
                            fontWeight: FontWeight.w600,
                            color: _dueColor(task.date, isDone: task.isDone),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // GRIP — long-press to move the task to another day
                  SizedBox(
                    width: 26,
                    child: LongPressDraggable<Task>(
                      data: task,
                      delay: const Duration(milliseconds: 220),
                      feedback: _DragFeedback(task: task),
                      childWhenDragging: Opacity(
                        opacity: 0.3,
                        child: Icon(Icons.drag_indicator,
                            size: 20, color: context.inkFaint),
                      ),
                      child: Icon(Icons.drag_indicator,
                          size: 20, color: context.inkFaint),
                    ),
                  ),
                  const SizedBox(width: 6),
                  // TICK BOX — tap to complete, drag to reorder within the
                  // day; its border carries the task's priority colour
                  _buildCheckbox(
                    provider,
                    settings.showPriority && task.priority != TaskPriority.none
                        ? priorityColor(context, task.priority)
                        : null,
                  ),
                  const SizedBox(width: 12),
                  // CONTENT — tap to open, long-press to edit
                  Expanded(
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: _openTask,
                      onLongPress: _editTask,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            task.title,
                            style: TextStyle(
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              decoration: task.isDone
                                  ? TextDecoration.lineThrough
                                  : null,
                              color: task.isDone
                                  ? context.inkSoft
                                  : context.ink,
                            ),
                          ),
                          const SizedBox(height: 6),
                          _metaRow(task, doneSubs, totalSubs,
                              settings: settings,
                              subject: subject,
                              label: label),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  // RIGHT — start-time chip, vertically centered. Priority is
                  // no longer a chip: it colour-codes the complete button's
                  // border, and only when it was actually set.
                  if (task.startTime != null)
                    _TimeChip(startTime: task.startTime!),
                ],
              ),
            ],
          ),
        ),
      ),
    );

    // EXPANDABLE SUBTASKS — check off straight from the list
    if (totalSubs > 0) {
      card = Column(
        key: ValueKey('col-${task.id}'),
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          card,
          AnimatedSize(
            duration: const Duration(milliseconds: 150),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: _expanded
                ? Padding(
                    padding: const EdgeInsets.only(left: 68, bottom: 6),
                    child: Column(
                      children: task.subtasks
                          .map((s) => _buildSubtile(provider, s))
                          .toList(),
                    ),
                  )
                : const SizedBox(width: double.infinity),
          ),
        ],
      );
    }

    if (widget.dismissible) {
      card = Dismissible(
        key: Key('dismiss-${task.id}'),
        direction: DismissDirection.endToStart,
        background: Container(
          margin: const EdgeInsets.only(bottom: 12),
          decoration: BoxDecoration(
              color: Colors.red.shade600,
              borderRadius: BorderRadius.circular(20)),
          alignment: Alignment.centerRight,
          padding: const EdgeInsets.only(right: 20),
          child:
              const Icon(Icons.delete_outline, color: Colors.white, size: 28),
        ),
        onDismissed: (_) => provider.deleteTask(task.id),
        child: card,
      );
    }

    return card;
  }

  Widget _metaRow(
    Task task,
    int doneSubs,
    int totalSubs, {
    required WorkspaceSettings settings,
    Project? subject,
    TaskLabel? label,
  }) {
    return Wrap(
      spacing: 12,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.access_time, size: 13, color: context.inkSoft),
            const SizedBox(width: 4),
            Text(
              formatDuration(task.remainingMinutes),
              style: TextStyle(fontSize: 12, color: context.inkSoft),
            ),
          ],
        ),
        if (subject != null && settings.showSubject)
          SubjectTag(name: subject.title, color: Color(subject.colorValue)),
        if (label != null && settings.showLabels)
          LabelChip(name: label.name, color: Color(label.colorValue)),
        if (totalSubs > 0)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => setState(() => _expanded = !_expanded),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.checklist_rounded, size: 14, color: context.inkSoft),
                const SizedBox(width: 4),
                Text('$doneSubs/$totalSubs',
                    style: TextStyle(
                        fontSize: 12,
                        color: context.inkSoft,
                        fontWeight: FontWeight.w600)),
                const SizedBox(width: 2),
                AnimatedRotation(
                  turns: _expanded ? 0.5 : 0,
                  duration: const Duration(milliseconds: 150),
                  curve: Curves.easeOutCubic,
                  child: Icon(Icons.expand_more, size: 15, color: context.inkSoft),
                ),
              ],
            ),
          ),
        if (task.notes.isNotEmpty)
          GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTap: () => showNotesEditor(context, task),
            child: Icon(Icons.sticky_note_2_outlined,
                size: 13, color: context.inkFaint),
          ),
      ],
    );
  }

  Widget _buildSubtile(TaskProvider provider, SubTask s) {
    return InkWell(
      onTap: () => provider.toggleSubtask(widget.task.id, s.id),
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            AnimatedContainer(
              duration: const Duration(milliseconds: 150),
              curve: Curves.easeOutCubic,
              width: 18,
              height: 18,
              decoration: BoxDecoration(
                color: s.isDone ? context.ink : Colors.transparent,
                borderRadius: BorderRadius.circular(6),
                border: Border.all(
                  color: s.isDone ? context.ink : context.hairline,
                  width: 1.8,
                ),
              ),
              child: s.isDone
                  ? Icon(Icons.check, size: 12, color: context.inkInverse)
                  : null,
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                s.title,
                style: TextStyle(
                  fontSize: 13.5,
                  decoration: s.isDone ? TextDecoration.lineThrough : null,
                  color: s.isDone ? context.inkSoft : context.ink,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCheckbox(TaskProvider provider, Color? priorityTint) {
    Widget checkbox = Semantics(
      label: widget.task.isDone ? 'Mark as not done' : 'Mark as done',
      button: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: () => provider.toggleTask(widget.task.id),
        child: AnimatedContainer(
          key: const ValueKey('task-checkbox'),
          duration: const Duration(milliseconds: 150),
          curve: Curves.easeOutCubic,
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: Colors.transparent,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(
              color: widget.task.isDone
                  ? context.ink
                  : priorityTint ?? context.hairline,
              // A priority tint gets a slightly thicker stroke so the
              // colour actually reads at this size.
              width: priorityTint == null ? 2 : 2.4,
            ),
          ),
          child: AnimatedSwitcher(
            duration: const Duration(milliseconds: 150),
            transitionBuilder: (child, anim) =>
                ScaleTransition(scale: anim, child: child),
            child: widget.task.isDone
                ? Icon(Icons.check,
                    key: ValueKey(true), size: 16, color: context.ink)
                : const SizedBox(key: ValueKey(false), width: 16, height: 16),
          ),
        ),
      ),
    );

    // Dragging by the tick box reorders within the day
    if (widget.index != null) {
      checkbox = ReorderableDragStartListener(
        index: widget.index!,
        child: checkbox,
      );
    }

    return checkbox;
  }
}

/// Start-time chip — a solid ink box with inverse text. In light mode that
/// is the black box with white time; dark mode flips it like every other
/// primary element.
class _TimeChip extends StatelessWidget {
  final DateTime startTime;

  const _TimeChip({required this.startTime});

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 30,
      padding: const EdgeInsets.symmetric(horizontal: 11),
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: context.ink,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Text(
        formatClock(startTime),
        style: TextStyle(
            fontSize: 12,
            color: context.inkInverse,
            fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _DragFeedback extends StatelessWidget {
  final Task task;

  const _DragFeedback({required this.task});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      elevation: 6,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        width: 280,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            Icon(Icons.drag_indicator, size: 18, color: context.inkSoft),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
            const SizedBox(width: 8),
            if (task.priority != TaskPriority.none)
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: context.ink,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  priorityLabel(task.priority),
                  style: TextStyle(
                      fontSize: 10,
                      color: context.inkInverse,
                      fontWeight: FontWeight.bold),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
