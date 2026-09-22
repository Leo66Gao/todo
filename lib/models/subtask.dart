import 'task.dart';

class SubTask {
  String id;
  String title;
  bool isDone;
  DateTime? date;

  /// Optional per-subtask overrides; when null the parent assignment's value
  /// is used for the milestone everywhere it appears as a task.
  TaskPriority? priority;
  int? difficulty;

  SubTask({
    required this.id,
    required this.title,
    this.isDone = false,
    this.date,
    this.priority,
    this.difficulty,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'isDone': isDone,
        'date': date?.toIso8601String(),
        'priority': priority?.toString(),
        'difficulty': difficulty,
      };

  factory SubTask.fromJson(Map<String, dynamic> json) {
    return SubTask(
      id: json['id'],
      title: json['title'],
      isDone: json['isDone'] ?? false,
      date: json['date'] != null ? DateTime.parse(json['date']) : null,
      priority: json['priority'] == null
          ? null
          : TaskPriority.values
              .where((e) => e.toString() == json['priority'])
              .firstOrNull,
      difficulty: (json['difficulty'] as num?)?.toInt(),
    );
  }
}
