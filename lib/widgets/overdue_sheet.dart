import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';

// Bottom sheet listing everything left over from previous days.
// Swipe left to delete, tap the checkbox to complete, tap + to pull into today.
void showOverdueSheet(BuildContext context) {
  showModalBottomSheet(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.card,
    shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
    builder: (context) {
      return Consumer<TaskProvider>(builder: (context, provider, _) {
        final overdue = provider.getOverdueTasks(DateTime.now());

        return SafeArea(
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.65,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
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
                  padding: EdgeInsets.fromLTRB(24, 20, 24, 4),
                  child: Row(
                    children: [
                      Text(
                        'Left from before',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      Spacer(),
                      Container(
                        padding:
                            EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                        decoration: BoxDecoration(
                          color: context.fillSoft,
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          '${overdue.length}',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            color: overdue.isEmpty
                                ? context.inkFaint
                                : Colors.red[700],
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                SizedBox(height: 8),
                Expanded(
                  child: overdue.isEmpty
                      ? Center(
                          child: Column(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.celebration_outlined,
                                  size: 48, color: context.inkFaint),
                              SizedBox(height: 12),
                              Text('All caught up!',
                                  style: TextStyle(
                                      color: context.inkSoft,
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600)),
                            ],
                          ),
                        )
                      : ListView.builder(
                          padding: EdgeInsets.fromLTRB(16, 8, 16, 24),
                          itemCount: overdue.length,
                          itemBuilder: (context, index) =>
                              _OverdueItem(task: overdue[index]),
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

class _OverdueItem extends StatelessWidget {
  final Task task;

  const _OverdueItem({required this.task});

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context, listen: false);

    return Dismissible(
      key: Key(task.id),
      direction: DismissDirection.endToStart,
      background: Container(
        margin: EdgeInsets.only(bottom: 10),
        decoration: BoxDecoration(
            color: Colors.red.shade600, borderRadius: BorderRadius.circular(18)),
        alignment: Alignment.centerRight,
        padding: EdgeInsets.only(right: 20),
        // white on the red swipe fill reads in both themes
        child: Icon(Icons.delete_outline, color: Colors.white, size: 26),
      ),
      onDismissed: (_) => provider.deleteTask(task.id),
      child: Container(
        margin: EdgeInsets.only(bottom: 10),
        padding: EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(18),
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
          children: [
            // MARK AS DONE
            Semantics(
              label: 'Mark as done',
              button: true,
              child: GestureDetector(
                onTap: () => provider.toggleTask(task.id),
                child: AnimatedContainer(
                  duration: Duration(milliseconds: 200),
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: context.hairline, width: 2),
                  ),
                  child: Icon(Icons.check, size: 16, color: Colors.transparent),
                ),
              ),
            ),
            SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Flexible(
                        child: Text(
                          task.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                              fontSize: 15, fontWeight: FontWeight.w600),
                        ),
                      ),
                      if (task.type == TaskType.assignment) ...[
                        SizedBox(width: 6),
                        Container(
                          padding: EdgeInsets.symmetric(
                              horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                              color: Colors.blue[50],
                              borderRadius: BorderRadius.circular(4)),
                          child: Text('ASSIGNMENT',
                              style: TextStyle(
                                  fontSize: 8,
                                  color: Colors.blue[800],
                                  fontWeight: FontWeight.bold)),
                        ),
                      ],
                    ],
                  ),
                  SizedBox(height: 5),
                  Row(
                    children: [
                      Container(
                        padding: EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: context.fillSoft,
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          DateFormat('MMM d').format(task.date),
                          style: TextStyle(
                              fontSize: 11,
                              color: Colors.red[700],
                              fontWeight: FontWeight.w600),
                        ),
                      ),
                      SizedBox(width: 8),
                      Text(
                        task.durationMinutes > 0
                            ? formatDuration(task.durationMinutes)
                            : '',
                        style:
                            TextStyle(fontSize: 11, color: context.inkSoft),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            SizedBox(width: 8),
            // ADD TO TODAY
            Semantics(
              label: 'Pull into today',
              button: true,
              child: GestureDetector(
                onTap: () => provider.rescheduleTask(task.id, DateTime.now()),
                child: Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: context.ink,
                    shape: BoxShape.circle,
                  ),
                  child: Icon(Icons.add, color: context.inkInverse, size: 20),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
