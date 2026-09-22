import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/subtask.dart';
import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/pill_dropdown.dart';

const _uuid = Uuid();

/// Add or edit an assignment subtask with real characteristics — title,
/// optional milestone date, difficulty and priority — styled like the
/// Add Task sheet.
Future<void> showSubtaskSheet(
  BuildContext context, {
  required Task parentTask,
  SubTask? existing,
}) {
  final isEdit = existing != null;

  final titleController = TextEditingController(text: existing?.title ?? '');
  DateTime? milestoneDate = existing?.date;
  int difficulty = existing?.difficulty ?? parentTask.difficulty;
  TaskPriority? priority = existing?.priority;

  return showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.card,
    shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (sheetContext) {
      return StatefulBuilder(
        builder: (sheetContext, setState) {
          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                  24, 24, 24, MediaQuery.of(sheetContext).viewInsets.bottom + 10),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(isEdit ? 'Edit subtask' : 'New subtask',
                            style: TextStyle(
                                fontSize: 22, fontWeight: FontWeight.bold)),
                        IconButton(
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () => Navigator.pop(sheetContext),
                            icon: const Icon(Icons.close)),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: titleController,
                      autofocus: true,
                      style: const TextStyle(fontSize: 17),
                      textCapitalization: TextCapitalization.sentences,
                      decoration: InputDecoration(
                        hintText: 'What step comes next?',
                        hintStyle: TextStyle(color: context.inkFaint),
                        filled: true,
                        fillColor: context.fillSoft,
                        contentPadding: const EdgeInsets.all(12),
                        enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide.none),
                        focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(14),
                            borderSide: BorderSide(
                                color:
                                    context.ink.withValues(alpha: 0.12))),
                      ),
                      ),
                    const SizedBox(height: 12),
                    _PickerTile(
                      icon: Icons.flag_outlined,
                      label: milestoneDate != null
                          ? 'Milestone · ${_dateLabel(milestoneDate!)}'
                          : 'No milestone date',
                      onTap: () async {
                        FocusScope.of(sheetContext).unfocus();
                        final now = DateTime.now();
                        final picked = await showDatePicker(
                          context: sheetContext,
                          initialDate:
                              milestoneDate ?? parentTask.date,
                          firstDate: DateTime(now.year - 5, 1, 1),
                          lastDate: DateTime(now.year + 10, 12, 31),
                          builder: (context, child) => Theme(
                            data: Theme.of(context).brightness ==
                                    Brightness.dark
                                ? ThemeData.dark().copyWith(
                                    colorScheme: ColorScheme.dark(
                                        primary: Colors.white))
                                : ThemeData.light().copyWith(
                                    colorScheme: ColorScheme.light(
                                        primary: Colors.black)),
                            child: child!,
                          ),
                        );
                        if (picked != null) {
                          setState(() => milestoneDate = picked);
                        }
                      },
                      onClear: milestoneDate == null
                          ? null
                          : () => setState(() => milestoneDate = null),
                    ),
                    const SizedBox(height: 14),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Difficulty',
                            style: TextStyle(
                                color: context.inkSoft,
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                        Text('Lvl $difficulty',
                            style: const TextStyle(
                                fontWeight: FontWeight.w600, fontSize: 12)),
                      ],
                    ),
                    SizedBox(
                      height: 30,
                      child: Slider(
                        value: difficulty.toDouble(),
                        min: 1,
                        max: 5,
                        divisions: 4,
                        activeColor: context.ink,
                        inactiveColor: context.hairline,
                        onChanged: (v) =>
                            setState(() => difficulty = v.round()),
                      ),
                    ),
                    const SizedBox(height: 6),
                    PillDropdown<TaskPriority?>(
                      hint: 'Priority',
                      icon: Icons.flag_outlined,
                      value: priority,
                      items: [
                        const DropdownMenuItem<TaskPriority?>(
                          value: null,
                          child: Text('Same as assignment'),
                        ),
                        // 'none' is the task-level "unset" marker and is
                        // expressed here by the null selection instead.
                        ...TaskPriority.values
                            .where((p) => p != TaskPriority.none)
                            .map(
                              (p) => DropdownMenuItem<TaskPriority?>(
                                value: p,
                                child: Text(_priorityLabel(p)),
                              ),
                            ),
                      ],
                      onChanged: (value) => setState(() => priority = value),
                    ),
                    const SizedBox(height: 20),
                    SizedBox(
                      width: double.infinity,
                      height: 50,
                      child: ElevatedButton(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: context.ink,
                          foregroundColor: context.inkInverse,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(16)),
                        ),
                        onPressed: () {
                          final title = titleController.text.trim();
                          if (title.isEmpty) return;
                          final provider =
                              sheetContext.read<TaskProvider>();
                          final sub = SubTask(
                            id: existing?.id ?? _uuid.v4(),
                            title: title,
                            isDone: existing?.isDone ?? false,
                            date: milestoneDate,
                            priority: priority,
                            difficulty: difficulty,
                          );
                          if (isEdit) {
                            provider.updateSubtask(parentTask.id, sub);
                          } else {
                            provider.addSubtaskFull(parentTask.id, sub);
                          }
                          Navigator.pop(sheetContext);
                        },
                        child: Text(isEdit ? 'Save subtask' : 'Add subtask',
                            style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.bold)),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    },
  );
}

String _dateLabel(DateTime date) {
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${months[date.month - 1]} ${date.day}';
}

String _priorityLabel(TaskPriority priority) {
  switch (priority) {
    case TaskPriority.none:
      return 'None';
    case TaskPriority.low:
      return 'Low';
    case TaskPriority.medium:
      return 'Medium';
    case TaskPriority.high:
      return 'High';
    case TaskPriority.critical:
      return 'Critical';
  }
}

class _PickerTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final VoidCallback? onClear;

  const _PickerTile({
    required this.icon,
    required this.label,
    required this.onTap,
    this.onClear,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: Container(
          padding: EdgeInsets.fromLTRB(12, 11, onClear == null ? 12 : 3, 11),
          decoration: BoxDecoration(
            border: Border.all(color: context.hairline),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Icon(icon, size: 16, color: context.inkSoft),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                        fontWeight: FontWeight.w600, fontSize: 13)),
              ),
              if (onClear != null)
                IconButton(
                  tooltip: 'Clear date',
                  visualDensity: VisualDensity.compact,
                  constraints: const BoxConstraints.tightFor(
                      width: 28, height: 24),
                  padding: EdgeInsets.zero,
                  onPressed: onClear,
                  icon: Icon(Icons.close,
                      size: 15, color: context.inkSoft),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
