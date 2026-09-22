import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../utils/workload.dart' show dayKey, sameDay;
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/month_grid.dart';
import '../widgets/task_card.dart';
import 'add_task_sheet.dart';
import 'schedule_page.dart';
import 'subject_tasks_page.dart';
import 'search_sheet.dart';

class CalendarPage extends StatefulWidget {
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateChanged;

  const CalendarPage(
      {super.key, required this.selectedDate, required this.onDateChanged});

  @override
  CalendarPageState createState() => CalendarPageState();
}

class CalendarPageState extends State<CalendarPage> {
  static const int _firstYear = 2020;
  static const int _lastYear = 2030;

  late final PageController _controller;
  late int _page;
  bool _agendaExpanded = false;

  @override
  void initState() {
    super.initState();
    _page = _monthIndexOf(widget.selectedDate);
    _controller = PageController(initialPage: _page);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  static int _monthIndexOf(DateTime d) =>
      (d.year - _firstYear) * 12 + d.month - 1;

  static DateTime _monthAt(int index) =>
      DateTime(_firstYear + index ~/ 12, index % 12 + 1, 1);

  int get _pageCount => _monthIndexOf(DateTime(_lastYear, 12)) + 1;

  void _goTo(int page) {
    if (page < 0 || page >= _pageCount) return;
    _controller.animateToPage(page,
        duration: const Duration(milliseconds: 300), curve: Curves.easeOut);
  }

  void _selectDay(DateTime day) {
    FocusScope.of(context).unfocus();
    final alreadySelected = sameDay(day, widget.selectedDate);
    // First tap on a day previews it (shows its agenda); tapping the selected
    // day again expands it into the full single-day view and hides the grid.
    setState(() => _agendaExpanded = alreadySelected && !_agendaExpanded);
    widget.onDateChanged(day);
    final idx = _monthIndexOf(day);
    if (idx != _page) {
      _controller.animateToPage(idx,
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    }
  }

  void _stepDay(int delta) {
    final next = widget.selectedDate.add(Duration(days: delta));
    widget.onDateChanged(next);
    final idx = _monthIndexOf(next);
    if (idx != _page) {
      _controller.animateToPage(idx,
          duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
    }
  }

  void _dropTask(Task task, DateTime day) {
    Provider.of<TaskProvider>(context, listen: false)
        .rescheduleTask(task.id, day);
    _selectDay(day);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content:
            Text('Moved "${task.title}" to ${DateFormat('MMM d').format(day)}'),
        behavior: SnackBarBehavior.floating,
        backgroundColor: Colors.black87,
        duration: const Duration(milliseconds: 1600),
      ),
    );
  }

  void _openMenuSheet() {
    showModalBottomSheet(
      context: context,
      backgroundColor: context.card,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Center(
                child: Container(
                  margin: EdgeInsets.only(top: 10),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: context.fillSoft,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              Padding(
                padding: EdgeInsets.fromLTRB(16, 12, 16, 20),
                child: Column(
                  children: [
                    _MenuTile(
                      icon: Icons.event_note_outlined,
                      label: 'Schedule',
                      onTap: () {
                        Navigator.pop(context);
                        Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) => const SchedulePage()));
                      },
                    ),
                    const SizedBox(height: 10),
                    _MenuTile(
                      icon: Icons.filter_list_rounded,
                      label: 'By subject',
                      onTap: () {
                        Navigator.pop(context);
                        _openSubjectPickerSheet();
                      },
                    ),
                  ],
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _openSubjectPickerSheet() {
    final provider = Provider.of<TaskProvider>(context, listen: false);
    final projects = provider.projects;
    showModalBottomSheet(
      context: context,
      backgroundColor: context.card,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Center(
                child: Container(
                  margin: const EdgeInsets.only(top: 10),
                  width: 40,
                  height: 4,
                  decoration: BoxDecoration(
                    color: context.fillSoft,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
              ),
              const Padding(
                padding: EdgeInsets.fromLTRB(24, 16, 24, 4),
                child: Text('What do you have left in…',
                    style:
                        TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
              ),
              if (projects.isEmpty)
                Padding(
                  padding: const EdgeInsets.fromLTRB(24, 12, 24, 28),
                  child: Text(
                    'No subjects yet — create one on the Subjects tab.',
                    style: TextStyle(color: context.inkSoft, fontSize: 13.5),
                  ),
                )
              else
                ListView.builder(
                  shrinkWrap: true,
                  padding: const EdgeInsets.fromLTRB(16, 8, 16, 20),
                  itemCount: projects.length,
                  itemBuilder: (context, index) {
                    final project = projects[index];
                    final left = provider.tasks
                        .where((t) => t.projectId == project.id && !t.isDone)
                        .length;
                    return ListTile(
                      shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(14)),
                      leading: Container(
                        width: 12,
                        height: 12,
                        decoration: BoxDecoration(
                            color: Color(project.colorValue),
                            shape: BoxShape.circle),
                      ),
                      title: Text(project.title,
                          style: const TextStyle(
                              fontWeight: FontWeight.w600, fontSize: 15)),
                      trailing: Text(
                        left == 0 ? 'all done' : '$left left',
                        style: TextStyle(
                            fontSize: 12.5,
                            color:
                                left == 0 ? context.inkFaint : context.inkSoft,
                            fontWeight: FontWeight.w600),
                      ),
                      onTap: () {
                        Navigator.pop(sheetContext);
                        Navigator.push(
                            context,
                            MaterialPageRoute(
                                builder: (_) =>
                                    SubjectTasksPage(subjectId: project.id)));
                      },
                    );
                  },
                ),
            ],
          ),
        );
      },
    );
  }

  void _openMonthPicker() {
    int year = _monthAt(_page).year;
    final now = DateTime.now();

    showModalBottomSheet(
      context: context,
      backgroundColor: context.card,
      shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return StatefulBuilder(builder: (context, setState) {
          return SafeArea(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Center(
                  child: Container(
                    margin: EdgeInsets.only(top: 10),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: context.fillSoft,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(16, 12, 16, 4),
                  child: Row(
                    children: [
                      IconButton(
                        icon: Icon(Icons.chevron_left, size: 28),
                        onPressed: () => setState(() => year--),
                      ),
                      Expanded(
                        child: Center(
                          child: Text(
                            '$year',
                            style: TextStyle(
                                fontSize: 20, fontWeight: FontWeight.w600),
                          ),
                        ),
                      ),
                      TextButton(
                        onPressed: () {
                          Navigator.pop(context);
                          _goTo(_monthIndexOf(DateTime(now.year, now.month)));
                        },
                        style: TextButton.styleFrom(
                          backgroundColor: context.ink,
                          foregroundColor: context.inkInverse,
                          padding:
                              EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                          shape: RoundedRectangleBorder(
                              borderRadius: BorderRadius.circular(20)),
                        ),
                        child: Text('Today',
                            style: TextStyle(
                                fontSize: 12, fontWeight: FontWeight.w600)),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(16, 8, 16, 24),
                  child: GridView.count(
                    crossAxisCount: 3,
                    shrinkWrap: true,
                    physics: NeverScrollableScrollPhysics(),
                    mainAxisSpacing: 8,
                    crossAxisSpacing: 8,
                    childAspectRatio: 2.4,
                    children: List.generate(12, (m) {
                      final selected = year == now.year && m + 1 == now.month;
                      final name =
                          DateFormat('MMM').format(DateTime(year, m + 1));

                      return GestureDetector(
                        onTap: () {
                          Navigator.pop(context);
                          _goTo(_monthIndexOf(DateTime(year, m + 1)));
                        },
                        child: AnimatedContainer(
                          duration: const Duration(milliseconds: 150),
                          decoration: BoxDecoration(
                            color: selected ? context.ink : context.fillSoft,
                            borderRadius: BorderRadius.circular(12),
                            border: selected
                                ? null
                                : Border.all(color: context.hairline),
                          ),
                          child: Center(
                            child: Text(
                              name,
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                                color:
                                    selected ? context.inkInverse : context.ink,
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  ),
                ),
              ],
            ),
          );
        });
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context);
    final month = _monthAt(_page);
    final gridHeight =
        MonthGrid.rowCountFor(month) * (MonthGrid.cellHeight + 4);

    return SafeArea(
      child: Column(
        children: [
          // HEADER — menu on the left, month box centered, symmetric
          Padding(
            padding: EdgeInsets.fromLTRB(8, 16, 8, 0),
            child: Row(
              children: [
                IconButton(
                  icon: Icon(Icons.menu, size: 26),
                  tooltip: 'Views',
                  onPressed: _openMenuSheet,
                ),
                Expanded(
                  child: Row(
                    children: [
                      IconButton(
                        tooltip: _agendaExpanded ? 'Previous day' : 'Previous month',
                        icon: Icon(Icons.chevron_left, size: 26),
                        onPressed: () =>
                            _agendaExpanded ? _stepDay(-1) : _goTo(_page - 1),
                      ),
                      Expanded(
                        child: Center(
                          child: GestureDetector(
                            onTap: _openMonthPicker,
                            child: Container(
                              padding: EdgeInsets.symmetric(
                                  horizontal: 18, vertical: 10),
                              decoration: BoxDecoration(
                                color: context.card,
                                borderRadius: BorderRadius.circular(20),
                                border: Border.all(color: context.hairline),
                                boxShadow: [
                                  BoxShadow(
                                    color: Colors.black.withValues(alpha: 0.03),
                                    blurRadius: 8,
                                    offset: Offset(0, 2),
                                  )
                                ],
                              ),
                              child: AnimatedSwitcher(
                                duration: const Duration(milliseconds: 150),
                                switchInCurve: Curves.easeOutCubic,
                                switchOutCurve: Curves.easeInCubic,
                                child: Text(
                                  key: ValueKey(month),
                                  DateFormat('MMMM yyyy').format(month),
                                  style: TextStyle(
                                      fontSize: 14.5,
                                      fontWeight: FontWeight.w600,
                                      color: context.ink),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                      IconButton(
                        tooltip: _agendaExpanded ? 'Next day' : 'Next month',
                        icon: Icon(Icons.chevron_right, size: 26),
                        onPressed: () =>
                            _agendaExpanded ? _stepDay(1) : _goTo(_page + 1),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.search, size: 24),
                  tooltip: 'Search tasks',
                  onPressed: () => showTaskSearchSheet(context,
                      onSelect: (date) => _selectDay(date)),
                ),
              ],
            ),
          ),
          AnimatedSize(
            duration: const Duration(milliseconds: 280),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            clipBehavior: Clip.hardEdge,
            child: _agendaExpanded
                ? const SizedBox.shrink()
                : Column(
                    children: [
                      const SizedBox(height: 8),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 8),
                        child: Row(
                          children:
                              ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                                  .map((d) => Expanded(
                                        child: Center(
                                          child: Text(d,
                                              style: TextStyle(
                                                  fontSize: 11,
                                                  fontWeight: FontWeight.w600,
                                                  color: context.inkSoft)),
                                        ),
                                      ))
                                  .toList(),
                        ),
                      ),
                      const SizedBox(height: 6),
                      SizedBox(
                        height: gridHeight,
                        child: PageView.builder(
                          controller: _controller,
                          itemCount: _pageCount,
                          onPageChanged: (index) =>
                              setState(() => _page = index),
                          itemBuilder: (context, index) => MonthGrid(
                            month: _monthAt(index),
                            selectedDate: widget.selectedDate,
                            onDaySelected: _selectDay,
                            onTaskDropped: _dropTask,
                          ),
                        ),
                      ),
                    ],
                  ),
          ),

          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 6),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    DateFormat('EEEE, MMMM d').format(widget.selectedDate),
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700),
                  ),
                ),
                if (_agendaExpanded)
                  TextButton.icon(
                    onPressed: () => setState(() => _agendaExpanded = false),
                    icon: const Icon(Icons.calendar_month_outlined, size: 18),
                    label: const Text('Month'),
                  ),
              ],
            ),
          ),
          Divider(height: 1, color: context.hairline),
          const SizedBox(height: 8),

          // SELECTED DAY — fades between days
          Expanded(
            child: AnimatedSwitcher(
              duration: const Duration(milliseconds: 160),
              switchInCurve: Curves.easeOutCubic,
              switchOutCurve: Curves.easeInCubic,
              child: provider.getTasksForDate(widget.selectedDate).isEmpty
                  ? _DayEmptyState(
                      key: ValueKey('empty-${dayKey(widget.selectedDate)}'),
                      date: widget.selectedDate,
                      onAddTask: () => showAddTaskDialog(context,
                          initialDate: widget.selectedDate),
                    )
                  : ListView(
                      key: ValueKey('list-${dayKey(widget.selectedDate)}'),
                      // The padding comes from the bottom inset + a fixed
                      // amount, so it tracks the actual nav bar / gesture area
                      // instead of a hard 175px that misaligns on other aspect
                      // ratios.
                      padding: EdgeInsets.fromLTRB(16, 0, 16,
                          110 + MediaQuery.of(context).viewPadding.bottom),
                      children: provider
                          .getTasksForDate(widget.selectedDate)
                          .map((task) =>
                              TaskCard(key: ValueKey(task.id), task: task))
                          .toList(),
                    ),
            ),
          ),
        ],
      ),
    );
  }
}

class _MenuTile extends StatelessWidget {
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  const _MenuTile(
      {required this.icon, required this.label, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: EdgeInsets.symmetric(horizontal: 16, vertical: 16),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            Icon(icon, size: 22, color: context.ink),
            SizedBox(width: 14),
            Expanded(
              child: Text(label,
                  style:
                      TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600)),
            ),
            Icon(Icons.arrow_forward_ios, size: 12, color: context.inkFaint),
          ],
        ),
      ),
    );
  }
}

class _DayEmptyState extends StatelessWidget {
  final DateTime date;
  final VoidCallback onAddTask;

  const _DayEmptyState(
      {super.key, required this.date, required this.onAddTask});

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final isToday =
        date.year == now.year && date.month == now.month && date.day == now.day;
    return Center(
      // scaleDown keeps the column intact on tiny viewports instead of
      // overflowing when the content outgrows the day-list area.
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.event_available_outlined,
                size: 44, color: context.inkFaint),
            const SizedBox(height: 12),
            Text(
              isToday
                  ? 'Nothing planned for today'
                  : 'Nothing on ${DateFormat('MMM d').format(date)}',
              style: TextStyle(color: context.inkSoft, fontSize: 14.5),
            ),
            const SizedBox(height: 14),
            TextButton.icon(
              onPressed: onAddTask,
              style: TextButton.styleFrom(
                foregroundColor: context.ink,
                backgroundColor: context.card,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: context.hairline),
                ),
              ),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add a task',
                  style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            ),
          ],
        ),
      ),
    );
  }
}
