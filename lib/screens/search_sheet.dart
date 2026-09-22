import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';

// Calendar search: finds tasks by title, notes and subtasks; tapping a
// result jumps the calendar to that task's date.
void showTaskSearchSheet(BuildContext context,
    {required void Function(DateTime date) onSelect}) {
  final queryController = TextEditingController();

  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.card,
    shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (context) {
      return StatefulBuilder(builder: (context, setState) {
        final provider = Provider.of<TaskProvider>(context);
        final query = queryController.text.trim().toLowerCase();

        final results = query.isEmpty
            ? <Task>[]
            : provider.tasks.where((t) {
                if (t.title.toLowerCase().contains(query)) return true;
                if (notePlainText(t.notes)
                    .toLowerCase()
                    .contains(query)) {
                  return true;
                }
                return t.subtasks
                    .any((s) => s.title.toLowerCase().contains(query));
              }).toList()
              ..sort((a, b) => a.date.compareTo(b.date));

        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.75,
            child: Column(
              children: [
                Center(
                  child: Container(
                    margin: EdgeInsets.only(top: 10),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: context.hairline,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                Padding(
                  padding: EdgeInsets.fromLTRB(20, 16, 20, 12),
                  child: TextField(
                    controller: queryController,
                    autofocus: true,
                    onChanged: (_) => setState(() {}),
                    style: TextStyle(fontSize: 16),
                    decoration: InputDecoration(
                      hintText: 'Search tasks…',
                      hintStyle: TextStyle(color: context.inkFaint),
                      prefixIcon: Icon(Icons.search, color: context.inkSoft),
                      filled: true,
                      fillColor: context.fillSoft,
                      contentPadding: EdgeInsets.symmetric(vertical: 14),
                      enabledBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(color: context.hairline),
                      ),
                      focusedBorder: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(14),
                        borderSide: BorderSide(
                            color: context.ink.withValues(alpha: 0.12)),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: query.isEmpty
                      ? SizedBox()
                      : results.isEmpty
                          ? Center(
                              child: Text('No results',
                                  style: TextStyle(
                                      color: context.inkFaint,
                                      fontSize: 14)),
                            )
                          : ListView.builder(
                              padding: EdgeInsets.fromLTRB(16, 0, 16, 24),
                              itemCount: results.length,
                              itemBuilder: (context, index) {
                                final t = results[index];
                                return _SearchResult(
                                  task: t,
                                  onTap: () {
                                    Navigator.pop(context);
                                    onSelect(t.date);
                                  },
                                );
                              },
                            ),
                ),
              ],
            ),
          ),
        );
      });
    },
  );
}

class _SearchResult extends StatelessWidget {
  final Task task;
  final VoidCallback onTap;

  const _SearchResult({required this.task, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: EdgeInsets.only(bottom: 10),
        padding: EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  decoration: task.isDone ? TextDecoration.lineThrough : null,
                  color: task.isDone ? context.inkFaint : context.ink,
                ),
              ),
            ),
            SizedBox(width: 10),
            if (task.type == TaskType.assignment)
              Container(
                margin: EdgeInsets.only(right: 8),
                padding: EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                    color: Colors.blue.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(4)),
                child: Text('ASSIGNMENT',
                    style: TextStyle(
                        fontSize: 8,
                        color: Theme.of(context).brightness == Brightness.dark
                            ? Colors.blue[200]
                            : Colors.blue[800],
                        fontWeight: FontWeight.bold)),
              ),
            Container(
              padding: EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: context.ink,
                borderRadius: BorderRadius.circular(6),
              ),
              child: Text(
                DateFormat('MMM d').format(task.date),
                style: TextStyle(
                    fontSize: 11,
                    color: context.inkInverse,
                    fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
