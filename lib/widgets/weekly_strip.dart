import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/workload.dart';

class WeeklyDateStrip extends StatefulWidget {
  final DateTime selectedDate;
  final ValueChanged<DateTime> onDateChanged;

  const WeeklyDateStrip({
    super.key,
    required this.selectedDate,
    required this.onDateChanged,
  });

  @override
  WeeklyDateStripState createState() => WeeklyDateStripState();
}

class WeeklyDateStripState extends State<WeeklyDateStrip> {
  late ScrollController _scrollController;

  final int _pastDays = 365;
  final double _itemWidth = 60.0;
  final double _separatorWidth = 10.0;

  @override
  void initState() {
    super.initState();
    _scrollController = ScrollController();

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        double position = _pastDays * (_itemWidth + _separatorWidth);
        _scrollController.jumpTo(position);
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    DateTime startDate = DateTime.now().subtract(Duration(days: _pastDays));

    return Container(
      height: 90,
      margin: EdgeInsets.only(bottom: 10),
      child: ListView.builder(
        controller: _scrollController,
        padding: EdgeInsets.symmetric(horizontal: 16),
        scrollDirection: Axis.horizontal,
        // A fixed extent lets the list jump straight to any index instead of
        // measuring all 730 day pills, which is what made scrolling feel
        // sluggish on the web.
        itemExtent: _itemWidth + _separatorWidth,
        itemCount: 365 * 2,
        itemBuilder: (context, index) {
          DateTime day = startDate.add(Duration(days: index));

          bool isSelected = sameDay(day, widget.selectedDate);
          bool isToday = sameDay(day, DateTime.now());

          return DragTarget<Task>(
            onWillAcceptWithDetails: (details) =>
                !sameDay(details.data.date, day),
            onAcceptWithDetails: (details) {
              Provider.of<TaskProvider>(context, listen: false)
                  .rescheduleTask(details.data.id, day);
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text(
                      'Moved "${details.data.title}" to ${DateFormat('MMM d').format(day)}'),
                  behavior: SnackBarBehavior.floating,
                  backgroundColor: Colors.black87,
                  duration: const Duration(milliseconds: 1600),
                ),
              );
            },
            builder: (context, candidate, _) {
              final hover = candidate.isNotEmpty;

              return Padding(
                padding: EdgeInsets.only(right: _separatorWidth),
                child: GestureDetector(
                  onTap: () => widget.onDateChanged(day),
                  child: AnimatedContainer(
                  duration: Duration(milliseconds: 200),
                  curve: Curves.easeOutCubic,
                  width: _itemWidth,
                  decoration: BoxDecoration(
                    color: isSelected
                        ? context.ink
                        : hover
                            ? context.card
                            : context.card,
                    borderRadius: BorderRadius.circular(18),
                    border: isSelected
                        ? (hover ? Border.all(color: Colors.grey, width: 2) : null)
                        : Border.all(
                            color: hover
                                ? context.ink
                                : isToday
                                    ? context.ink
                                    : Colors.transparent,
                            width: hover ? 2 : 2),
                    boxShadow: isSelected || hover
                        ? [
                            BoxShadow(
                                color: Colors.black26,
                                blurRadius: 10,
                                offset: Offset(0, 4))
                          ]
                        : [],
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(DateFormat('E').format(day).substring(0, 1),
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                              color: isSelected
                                  ? context.inkInverse.withValues(alpha: 0.70)
                                  : hover
                                      ? context.ink
                                      : context.inkSoft)),
                      SizedBox(height: 6),
                      Text(day.day.toString(),
                          style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.bold,
                              color: isSelected
                                  ? context.inkInverse
                                  : context.ink)),
                    ],
                  ),
                  ),
                ),
              );
            },
          );
        },
      ),
    );
  }
}
