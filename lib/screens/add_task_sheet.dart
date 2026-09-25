import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../widgets/pill_dropdown.dart';
import '../utils/time_parser.dart';
import '../utils/workload.dart';

const _uuid = Uuid();

void showAddTaskDialog(BuildContext context,
    {Task? existingTask, DateTime? initialDate, String? initialProjectId}) {
  FocusScope.of(context).unfocus();

  final provider = Provider.of<TaskProvider>(context, listen: false);
  final settings = provider.workspaceSettings;

  final titleController =
      TextEditingController(text: existingTask?.title ?? '');
  final notesController =
      TextEditingController(text: existingTask?.notes ?? '');

  DateTime selectedDate = existingTask?.date ?? initialDate ?? DateTime.now();
  TimeOfDay? selectedTime = existingTask?.startTime != null
      ? TimeOfDay.fromDateTime(existingTask!.startTime!)
      : null;

  TaskType type = existingTask?.type ?? TaskType.todo;
  TaskPriority priority = existingTask?.priority ?? TaskPriority.none;
  String? selectedProjectId = existingTask?.projectId ?? initialProjectId;
  String selectedCategory = existingTask?.category ?? 'General';

  double difficulty = (existingTask?.difficulty ?? 1).toDouble();
  // Difficulty is "dormant" (Lvl 1 = nothing set) until the user taps the
  // slider, mirroring how priority starts at none.
  bool difficultyActive = existingTask != null && existingTask.difficulty > 1;

  double durationSliderVal;
  if (existingTask != null) {
    if (existingTask.type == TaskType.assignment) {
      durationSliderVal = (existingTask.durationMinutes / 60).clamp(1.0, 10.0);
    } else {
      durationSliderVal =
          existingTask.durationMinutes.toDouble().clamp(0.0, 180.0);
    }
  } else {
    durationSliderVal = 30;
  }

  bool isNotesFocused = false;

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.card,
    shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setState) {
          void handleTypeChange(TaskType newType) {
            setState(() {
              type = newType;

              if (newType == TaskType.assignment) {
                durationSliderVal = 2.0;
              } else {
                durationSliderVal = 30.0;
              }
            });
          }

          // Every form field the user can show/hide/reorder, keyed by id.
          Widget? fieldBlock(String id) {
            switch (id) {
              case 'type':
                return _TypePill(
                  type: type,
                  onChanged: (newType) => handleTypeChange(newType),
                );
              case 'notes':
                return Focus(
                  onFocusChange: (hasFocus) {
                    setState(() {
                      isNotesFocused = hasFocus;
                    });
                  },
                  child: AnimatedContainer(
                    duration: Duration(milliseconds: 200),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(12),
                      color: isNotesFocused ? context.card : context.fillSoft,
                      border: Border.all(
                        color: isNotesFocused
                            ? context.ink.withValues(alpha: 0.25)
                            : Colors.transparent,
                        width: 1.5,
                      ),
                      boxShadow: isNotesFocused
                          ? [
                              BoxShadow(
                                color: Colors.black.withValues(alpha: 0.05),
                                blurRadius: 10,
                                offset: Offset(0, 4),
                              )
                            ]
                          : [],
                    ),
                    child: TextField(
                      controller: notesController,
                      maxLines: isNotesFocused ? 4 : 2,
                      style: TextStyle(fontSize: 14),
                      decoration: InputDecoration(
                        hintText: "Add notes...",
                        hintStyle:
                            TextStyle(color: context.inkFaint, fontSize: 14),
                        filled: false,
                        contentPadding: EdgeInsets.all(12),
                        border: InputBorder.none,
                      ),
                    ),
                  ),
                );
              case 'duration':
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Time Needed",
                            style: TextStyle(
                                color: context.inkSoft,
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                        Text(
                          type == TaskType.assignment
                              ? "${durationSliderVal.toInt()} hours"
                              : "${durationSliderVal.toInt()} mins",
                          style: TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 12),
                        ),
                      ],
                    ),
                    SizedBox(
                      height: 30,
                      child: Slider(
                        value: durationSliderVal,
                        min: type == TaskType.assignment ? 1.0 : 0.0,
                        max: type == TaskType.assignment ? 10.0 : 180.0,
                        divisions: type == TaskType.assignment ? 9 : 12,
                        activeColor: type == TaskType.assignment
                            ? Colors.blue
                            : context.ink,
                        inactiveColor: context.hairline,
                        onChanged: (v) => setState(() => durationSliderVal = v),
                      ),
                    ),
                    SizedBox(height: 4),
                  ],
                );
              case 'difficulty':
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text("Difficulty",
                            style: TextStyle(
                                color: context.inkSoft,
                                fontWeight: FontWeight.bold,
                                fontSize: 12)),
                        if (difficultyActive)
                          Row(
                            children: [
                              Text("Lvl ${difficulty.toInt()}",
                                  style: TextStyle(
                                      fontWeight: FontWeight.w600,
                                      fontSize: 12)),
                              IconButton(
                                tooltip: 'Clear difficulty',
                                visualDensity: VisualDensity.compact,
                                constraints: BoxConstraints.tightFor(
                                    width: 26, height: 22),
                                padding: EdgeInsets.zero,
                                onPressed: () => setState(() {
                                  difficultyActive = false;
                                  difficulty = 1;
                                }),
                                icon: Icon(Icons.close,
                                    size: 13, color: context.inkSoft),
                              ),
                            ],
                          )
                        else
                          Text('None',
                              style: TextStyle(
                                  color: context.inkFaint,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 12)),
                      ],
                    ),
                    _TapToActivateSlider(
                      active: difficultyActive,
                      value: difficulty,
                      dormantValue: 2,
                      min: 1,
                      max: 5,
                      divisions: 4,
                      activeColor: context.ink,
                      inactiveColor: context.hairline,
                      dormantKey: const ValueKey('difficulty-dormant'),
                      onChanged: (v) => setState(() => difficulty = v),
                      onActivate: () => setState(() {
                        difficultyActive = true;
                        difficulty = 2;
                      }),
                    ),
                  ],
                );
              case 'priority':
                return _PrioritySlider(
                  priority: priority,
                  onChanged: (value) => setState(() => priority = value),
                );
              case 'subject':
                if (provider.projects.isEmpty) return null;
                return PillDropdown<String>(
                  hint: 'No subject',
                  icon: Icons.folder_outlined,
                  value: provider.projects.any((p) => p.id == selectedProjectId)
                      ? selectedProjectId!
                      : '',
                  items: [
                    const DropdownMenuItem<String>(
                        value: '', child: Text('No subject')),
                    ...provider.projects.map(
                      (p) => DropdownMenuItem<String>(
                        value: p.id,
                        child: Text(p.title, overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ],
                  onChanged: (value) => setState(() => selectedProjectId =
                      (value == null || value.isEmpty) ? null : value),
                );
              case 'labels':
                if (settings.labels.isEmpty) return null;
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('LABEL',
                        style: TextStyle(
                            color: context.inkSoft,
                            fontWeight: FontWeight.bold,
                            fontSize: 12)),
                    SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      runSpacing: 8,
                      children: [
                        _LabelChoice(
                          name: 'None',
                          selected: selectedCategory == 'General',
                          onSelected: () =>
                              setState(() => selectedCategory = 'General'),
                        ),
                        ...settings.labels.map((label) => _LabelChoice(
                              name: label.name,
                              color: Color(label.colorValue),
                              selected: selectedCategory == label.name,
                              onSelected: () =>
                                  setState(() => selectedCategory = label.name),
                            )),
                      ],
                    ),
                  ],
                );
            }
            return null;
          }

          // Date and time render as one side-by-side row when they sit next
          // to each other in the user's field order; standalone otherwise.
          Widget dateTimeRow(String firstId) {
            final dateFirst = firstId == 'date';
            return Row(
              children: [
                Expanded(
                  child: dateFirst
                      ? _dateTile(context, setState, selectedDate,
                          (d) => selectedDate = d)
                      : _timeTile(context, setState, selectedTime,
                          (t) => selectedTime = t),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: dateFirst
                      ? _timeTile(context, setState, selectedTime,
                          (t) => selectedTime = t)
                      : _dateTile(context, setState, selectedDate,
                          (d) => selectedDate = d),
                ),
              ],
            );
          }

          final order = settings.fieldOrder;
          final formFields = <Widget>[];
          final handled = <String>{};
          for (var i = 0; i < order.length; i++) {
            final id = order[i];
            if (handled.contains(id) || !settings.isFieldVisible(id)) continue;

            if (id == 'date' || id == 'time') {
              final other = id == 'date' ? 'time' : 'date';
              final otherIndex = order.indexOf(other);
              final adjacent = otherIndex != -1 &&
                  settings.isFieldVisible(other) &&
                  (otherIndex == i - 1 || otherIndex == i + 1);
              handled.add(id);
              if (adjacent) {
                handled.add(other);
                formFields
                  ..add(SizedBox(height: 12))
                  ..add(dateTimeRow(id));
              } else {
                formFields
                  ..add(SizedBox(height: 12))
                  ..add(id == 'date'
                      ? _dateTile(context, setState, selectedDate,
                          (d) => selectedDate = d)
                      : _timeTile(context, setState, selectedTime,
                          (t) => selectedTime = t));
              }
              continue;
            }

            final block = fieldBlock(id);
            if (block != null) {
              formFields
                ..add(SizedBox(height: 12))
                ..add(block);
            }
          }

          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                  24, 24, 24, MediaQuery.of(context).viewInsets.bottom + 10),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          existingTask == null ? "New Task" : "Edit Task",
                          style: TextStyle(
                              fontSize: 22, fontWeight: FontWeight.bold),
                        ),
                        IconButton(
                            padding: EdgeInsets.zero,
                            constraints: BoxConstraints(),
                            onPressed: () => Navigator.pop(context),
                            icon: Icon(Icons.close)),
                      ],
                    ),
                    SizedBox(height: 12),
                    TextField(
                      controller: titleController,
                      autofocus: true,
                      style: TextStyle(fontSize: 18),
                      decoration: InputDecoration(
                        hintText: "What needs to be done?",
                        hintStyle: TextStyle(color: context.inkFaint),
                        border: InputBorder.none,
                        filled: true,
                        fillColor: context.fillSoft,
                        contentPadding: EdgeInsets.all(12),
                        enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none),
                        focusedBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide(
                                color: context.ink.withValues(alpha: 0.12))),
                      ),
                    ),
                    ...formFields,
                    SizedBox(height: 20),
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
                        onPressed: () async {
                          if (titleController.text.trim().isNotEmpty) {
                            String titleToUse = titleController.text.trim();
                            TimeOfDay? timeToUse = selectedTime;

                            if (settings.showTime) {
                              final parsed = parseTimeFromTitle(titleToUse);
                              if (parsed.time != null) {
                                titleToUse = parsed.cleanTitle;
                                timeToUse = parsed.time;
                              }
                            }

                            int finalMinutes;
                            if (!settings.showDuration &&
                                existingTask != null) {
                              finalMinutes = existingTask.durationMinutes;
                            } else if (type == TaskType.assignment) {
                              finalMinutes = (durationSliderVal * 60).toInt();
                            } else {
                              finalMinutes = durationSliderVal.toInt();
                            }

                            // Merge Date and Time
                            DateTime? finalStartTime;
                            if (timeToUse != null) {
                              finalStartTime = DateTime(
                                selectedDate.year,
                                selectedDate.month,
                                selectedDate.day,
                                timeToUse.hour,
                                timeToUse.minute,
                              );
                            }

                            if (existingTask == null) {
                              provider.addTask(Task(
                                id: _uuid.v4(),
                                title: titleToUse,
                                notes: notesController.text,
                                date: selectedDate,
                                startTime: finalStartTime,
                                type: type,
                                difficulty: difficulty.toInt(),
                                priority: priority,
                                projectId: selectedProjectId,
                                durationMinutes: finalMinutes,
                                category: selectedCategory,
                                remainingMinutes: finalMinutes,
                              ));
                            } else {
                              int newRemaining =
                                  existingTask.durationMinutes == finalMinutes
                                      ? existingTask.remainingMinutes
                                      : finalMinutes;

                              final updated = Task(
                                id: existingTask.id,
                                title: titleToUse,
                                notes: notesController.text,
                                isDone: existingTask.isDone,
                                date: selectedDate,
                                startTime: finalStartTime,
                                type: type,
                                difficulty: difficulty.toInt(),
                                priority: priority,
                                projectId: selectedProjectId,
                                durationMinutes: finalMinutes,
                                category: selectedCategory,
                                remainingMinutes: newRemaining,
                                subtasks: existingTask.subtasks,
                                googleEventId: existingTask.googleEventId,
                                calendarEventRevision:
                                    existingTask.calendarEventRevision,
                              );

                              var domino = false;
                              if (finalStartTime != null &&
                                  existingTask.startTime != null &&
                                  sameDay(selectedDate, existingTask.date) &&
                                  (existingTask.startTime!.hour !=
                                          finalStartTime.hour ||
                                      existingTask.startTime!.minute !=
                                          finalStartTime.minute)) {
                                domino = await _showDominoPreview(
                                        context,
                                        provider,
                                        existingTask,
                                        finalStartTime) ??
                                    false;
                              }
                              if (!context.mounted) return;

                              provider.updateTask(updated);
                              if (domino) {
                                provider.applyDominoShift(
                                  excludeId: updated.id,
                                  day: existingTask.date,
                                  afterTime: existingTask.startTime!,
                                  delta: finalStartTime!
                                      .difference(existingTask.startTime!),
                                );
                              }
                            }

                            Navigator.pop(context);
                          }
                        },
                        child: Text(
                          existingTask == null ? "Create Task" : "Save Changes",
                          style: TextStyle(
                              fontSize: 16, fontWeight: FontWeight.bold),
                        ),
                      ),
                    )
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

Widget _dateTile(BuildContext context, StateSetter setState,
    DateTime selectedDate, ValueChanged<DateTime> onPicked) {
  return _PickerTile(
    icon: Icons.calendar_today,
    label: DateFormat('MMM d').format(selectedDate),
    onTap: () async {
      FocusScope.of(context).unfocus();
      final d = await showDatePicker(
        context: context,
        initialDate: selectedDate,
        firstDate: DateTime(2020),
        lastDate: DateTime(2100),
        builder: (context, child) => Theme(
          data: Theme.of(context).brightness == Brightness.dark
              ? ThemeData.dark().copyWith(
                  colorScheme: ColorScheme.dark(primary: Colors.white))
              : ThemeData.light().copyWith(
                  colorScheme: ColorScheme.light(primary: Colors.black)),
          child: child!,
        ),
      );
      if (d != null) onPicked(d);
      if (context.mounted) setState(() {});
    },
  );
}

Widget _timeTile(BuildContext context, StateSetter setState,
    TimeOfDay? selectedTime, ValueChanged<TimeOfDay?> onPicked) {
  return _PickerTile(
    icon: Icons.access_time,
    label: selectedTime != null ? formatTimeOfDay(selectedTime) : 'No time',
    onTap: () async {
      final t = await showTimePicker(
        context: context,
        initialTime: selectedTime ?? TimeOfDay.now(),
      );
      if (t != null) onPicked(t);
      if (context.mounted) setState(() {});
    },
    onClear: selectedTime == null
        ? null
        : () {
            onPicked(null);
            setState(() {});
          },
  );
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
        borderRadius: BorderRadius.circular(12),
        child: Container(
          // Fixed height so the date and time tiles are always the same size.
          // The time tile used to grow when it gained its clear (×) button,
          // which made the two fields in a row look mismatched.
          height: 38,
          padding: EdgeInsets.fromLTRB(10, 0, onClear == null ? 10 : 2, 0),
          decoration: BoxDecoration(
            border: Border.all(color: context.hairline),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Row(
            children: [
              Icon(icon, size: 15, color: context.inkSoft),
              SizedBox(width: 6),
              Expanded(
                child: Text(label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style:
                        TextStyle(fontWeight: FontWeight.w600, fontSize: 12)),
              ),
              if (onClear != null)
                IconButton(
                  tooltip: 'Clear time',
                  visualDensity: VisualDensity.compact,
                  constraints: BoxConstraints.tightFor(width: 26, height: 26),
                  padding: EdgeInsets.zero,
                  onPressed: onClear,
                  icon: Icon(Icons.close, size: 14, color: context.inkSoft),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Animated To-Do / Assignment selector: a sliding ink pill that turns
/// black for to-dos and blue for assignments, labels always dead-center.
class _TypePill extends StatelessWidget {
  final TaskType type;
  final ValueChanged<TaskType> onChanged;

  const _TypePill({required this.type, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    final isTodo = type == TaskType.todo;
    final pillColor = isTodo ? context.ink : Colors.blueAccent;
    return Container(
      height: 46,
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: context.card,
        borderRadius: BorderRadius.circular(23),
        border: Border.all(color: context.hairline),
      ),
      child: Stack(
        children: [
          AnimatedAlign(
            duration: const Duration(milliseconds: 280),
            curve: Curves.easeOutCubic,
            alignment: isTodo ? Alignment.centerLeft : Alignment.centerRight,
            child: FractionallySizedBox(
              widthFactor: 0.5,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 280),
                curve: Curves.easeOutCubic,
                height: 38,
                decoration: BoxDecoration(
                  color: pillColor,
                  borderRadius: BorderRadius.circular(19),
                  boxShadow: [
                    BoxShadow(
                      color: pillColor.withValues(alpha: 0.22),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Positioned.fill(
            child: Row(
              children: [
                _segment(
                    'To-Do', isTodo, context, () => onChanged(TaskType.todo)),
                _segment('Assignment', !isTodo, context,
                    () => onChanged(TaskType.assignment)),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _segment(
      String label, bool selected, BuildContext context, VoidCallback onTap) {
    return Expanded(
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Center(
          child: AnimatedDefaultTextStyle(
            duration: const Duration(milliseconds: 250),
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: selected ? context.inkInverse : context.inkSoft,
            ),
            child: Text(label),
          ),
        ),
      ),
    );
  }
}

/// Priority as a slider — Low / Medium / High / Critical with a tinted
/// flag. It starts dormant showing "None": one tap anywhere on it activates
/// the task's priority at Medium, and the × clears it back to none.
class _PrioritySlider extends StatelessWidget {
  final TaskPriority priority;
  final ValueChanged<TaskPriority> onChanged;

  const _PrioritySlider({required this.priority, required this.onChanged});

  bool get _isSet => priority != TaskPriority.none;

  Color _levelColor(BuildContext context) {
    switch (priority) {
      case TaskPriority.none:
        return context.inkFaint;
      case TaskPriority.low:
        return Colors.green.shade600;
      case TaskPriority.medium:
        return Colors.yellow.shade700;
      case TaskPriority.high:
        return Colors.orange.shade700;
      case TaskPriority.critical:
        return Colors.red.shade600;
    }
  }

  @override
  Widget build(BuildContext context) {
    final color = _levelColor(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Priority',
                style: TextStyle(
                    color: context.inkSoft,
                    fontWeight: FontWeight.bold,
                    fontSize: 12)),
            Row(
              children: [
                Icon(Icons.flag_rounded, size: 14, color: color),
                const SizedBox(width: 5),
                Text(priorityLabel(priority),
                    style: TextStyle(
                        color: color,
                        fontWeight: FontWeight.w600,
                        fontSize: 12)),
                if (_isSet)
                  IconButton(
                    tooltip: 'Clear priority',
                    visualDensity: VisualDensity.compact,
                    constraints: BoxConstraints.tightFor(width: 26, height: 22),
                    padding: EdgeInsets.zero,
                    onPressed: () => onChanged(TaskPriority.none),
                    icon: Icon(Icons.close, size: 13, color: context.inkSoft),
                  ),
              ],
            ),
          ],
        ),
        _TapToActivateSlider(
          active: _isSet,
          // low..critical are enum indexes 1..4
          value: (priority.index - 1).clamp(0, 3).toDouble(),
          dormantValue: 1,
          min: 0,
          max: 3,
          divisions: 3,
          activeColor: context.ink,
          inactiveColor: context.hairline,
          dormantKey: const ValueKey('priority-dormant'),
          activeKey: const ValueKey('priority-active'),
          onChanged: (v) =>
              onChanged(TaskPriority.values[v.round().clamp(0, 3) + 1]),
          onActivate: () => onChanged(TaskPriority.medium),
        ),
      ],
    );
  }
}

/// A slider that starts dormant: greyed out and inert until tapped, so the
/// honest "nothing set" default needs no data placeholder. Tapping anywhere
/// on the dormant track activates the control; from then on it is a normal
/// slider.
class _TapToActivateSlider extends StatelessWidget {
  final bool active;
  final double value;
  final double min;
  final double max;
  final int? divisions;

  /// Where the dormant thumb rests — the value activation will land on, so
  /// the thumb doesn't jump when the control wakes up.
  final double dormantValue;
  final Color? activeColor;
  final Color inactiveColor;
  // Typed as plain Key so `const ValueKey('x')` infers ValueKey<String> —
  // a ValueKey<dynamic> field would never equal the test's ValueKey<String>.
  final Key dormantKey;
  final Key? activeKey;
  final ValueChanged<double> onChanged;
  final VoidCallback onActivate;

  const _TapToActivateSlider({
    required this.active,
    required this.value,
    required this.min,
    required this.max,
    required this.dormantValue,
    required this.activeColor,
    required this.inactiveColor,
    required this.dormantKey,
    required this.onChanged,
    required this.onActivate,
    this.divisions,
    this.activeKey,
  });

  @override
  Widget build(BuildContext context) {
    final theme = SliderTheme.of(context).copyWith(
      trackHeight: 3,
      thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 10),
      overlayShape: const RoundSliderOverlayShape(overlayRadius: 18),
    );

    if (active) {
      return SizedBox(
        height: 30,
        child: SliderTheme(
          data: theme,
          child: Slider(
            key: activeKey,
            value: value.clamp(min, max),
            min: min,
            max: max,
            divisions: divisions,
            activeColor: activeColor,
            inactiveColor: inactiveColor,
            onChanged: onChanged,
          ),
        ),
      );
    }

    return GestureDetector(
      key: dormantKey,
      behavior: HitTestBehavior.opaque,
      onTap: onActivate,
      child: SizedBox(
        height: 30,
        child: SliderTheme(
          data: theme,
          child: Slider(
            value: dormantValue.clamp(min, max),
            min: min,
            max: max,
            divisions: divisions,
            onChanged: null,
          ),
        ),
      ),
    );
  }
}

class _LabelChoice extends StatelessWidget {
  final String name;
  final Color? color;
  final bool selected;
  final VoidCallback onSelected;

  const _LabelChoice({
    required this.name,
    this.color,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    final accent = color ?? context.inkFaint;
    return ChoiceChip(
      selected: selected,
      onSelected: (_) => onSelected(),
      avatar: color == null
          ? null
          : Container(
              width: 9,
              height: 9,
              decoration: BoxDecoration(color: accent, shape: BoxShape.circle),
            ),
      label: Text(name),
      labelStyle: TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w600,
        color: selected ? context.inkInverse : context.ink,
      ),
      selectedColor: accent,
      backgroundColor: context.fillSoft,
      side: BorderSide(color: selected ? accent : context.hairline, width: 1),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      showCheckmark: false,
    );
  }
}

// Domino preview: when a timed task's time changes on a day with more than
// three timed tasks, show how the later tasks would shift and let the user
// accept or keep only the edited task's new time.
Future<bool?> _showDominoPreview(BuildContext context, TaskProvider provider,
    Task existingTask, DateTime newStart) {
  final oldStart = existingTask.startTime!;
  final delta = newStart.difference(oldStart);

  final timedSameDay = provider.tasks
      .where((t) => t.startTime != null && sameDay(t.date, existingTask.date))
      .toList();

  if (timedSameDay.length < 3) return Future.value(false);

  final affected = timedSameDay
      .where((t) => t.id != existingTask.id && t.startTime!.isAfter(oldStart))
      .toList()
    ..sort((a, b) => a.startTime!.compareTo(b.startTime!));

  if (affected.isEmpty) return Future.value(false);

  final mins = delta.inMinutes.abs();
  final later = delta.inMinutes > 0;
  final shiftText = mins >= 60
      ? '${mins ~/ 60}h${mins % 60 != 0 ? ' ${mins % 60}m' : ''}'
      : '${mins}m';

  String newTimeFor(DateTime old) {
    final shifted = old.add(delta);
    return sameDay(old, shifted)
        ? formatClock(shifted)
        : DateFormat('MMM d, h:mm a').format(shifted);
  }

  return showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: context.card,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      title: Text('Domino effect',
          style: TextStyle(fontSize: 20, fontWeight: FontWeight.w600)),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Later tasks shift $shiftText ${later ? 'later' : 'earlier'}:',
            style: TextStyle(fontSize: 13, color: context.inkSoft),
          ),
          SizedBox(height: 14),
          ...affected.take(6).map((t) => Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(t.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 13.5, fontWeight: FontWeight.w500)),
                    ),
                    SizedBox(width: 10),
                    Text(formatClock(t.startTime!),
                        style:
                            TextStyle(fontSize: 12.5, color: context.inkFaint)),
                    Icon(Icons.arrow_forward,
                        size: 13, color: context.inkFaint),
                    Text(newTimeFor(t.startTime!),
                        style: TextStyle(
                            fontSize: 12.5, fontWeight: FontWeight.w600)),
                  ],
                ),
              )),
          if (affected.length > 6)
            Padding(
              padding: EdgeInsets.only(bottom: 4),
              child: Text('+ ${affected.length - 6} more',
                  style: TextStyle(fontSize: 12, color: context.inkFaint)),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, false),
          child:
              Text('Keep only this', style: TextStyle(color: context.inkSoft)),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: context.ink,
            foregroundColor: context.inkInverse,
            elevation: 0,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
          ),
          onPressed: () => Navigator.pop(context, true),
          child: Text('Shift all'),
        ),
      ],
    ),
  );
}
