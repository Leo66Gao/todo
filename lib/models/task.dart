import 'subtask.dart';

enum TaskType { todo, assignment }

/// `none` is the "no priority set" state — the form starts there and only
/// records a real level once the user activates the slider.
enum TaskPriority { none, low, medium, high, critical }

class Task {
  String id;
  String title;
  String notes;
  bool isDone;
  DateTime date;
  TaskType type;
  TaskPriority priority;
  int difficulty;

  /// Difficulty 1 also means "not set" in older records; this marks a Level 1
  /// the user actually chose. Only written when true so older payloads stay
  /// byte-identical.
  bool difficultySelected;
  int durationMinutes;
  String? projectId;
  String? parentTaskId;
  String category;
  DateTime? startTime;
  int remainingMinutes;
  String? googleEventId;
  int calendarEventRevision;
  bool isConflictCopy;
  List<SubTask> subtasks;

  Task({
    required this.id,
    required this.title,
    this.notes = '',
    this.isDone = false,
    required this.date,
    this.type = TaskType.todo,
    this.priority = TaskPriority.none,
    this.difficulty = 1,
    this.difficultySelected = false,
    this.durationMinutes = 0,
    this.projectId,
    this.parentTaskId,
    this.category = 'General',
    this.startTime,
    this.remainingMinutes = 0,
    this.subtasks = const [],
    this.googleEventId,
    this.calendarEventRevision = 0,
    this.isConflictCopy = false,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'notes': notes,
        'isDone': isDone,
        'date': date.toIso8601String(),
        'type': type.toString(),
        'priority': priority.toString(),
        'difficulty': difficulty,
        'durationMinutes': durationMinutes,
        'projectId': projectId,
        'parentTaskId': parentTaskId,
        'category': category,
        'startTime': startTime?.toIso8601String(),
        'remainingMinutes': remainingMinutes,
        'subtasks': subtasks.map((s) => s.toJson()).toList(),
        'googleEventId': googleEventId,
        'calendarEventRevision': calendarEventRevision,
        'isConflictCopy': isConflictCopy,
        if (difficultySelected && difficulty == 1) 'difficultySelected': true,
      };

  /// Whether a difficulty level was chosen (the form shows "None" otherwise).
  bool get hasDifficulty => difficulty > 1 || difficultySelected;

  factory Task.fromJson(Map<String, dynamic> json) {
    final subList = json['subtasks'] as List?;
    final List<SubTask> loadedSubtasks =
        subList != null ? subList.map((i) => SubTask.fromJson(i)).toList() : [];

    return Task(
      id: json['id'],
      title: json['title'],
      notes: json['notes'] ?? '',
      isDone: json['isDone'] ?? false,
      date: DateTime.parse(json['date']),
      type: TaskType.values.firstWhere((e) => e.toString() == json['type'],
          orElse: () => TaskType.todo),
      priority: TaskPriority.values.firstWhere(
          (e) => e.toString() == json['priority'],
          orElse: () => TaskPriority.none),
      difficulty: json['difficulty'] ?? 1,
      difficultySelected: json['difficultySelected'] == true,
      durationMinutes: json['durationMinutes'] ?? 0,
      projectId: json['projectId'],
      parentTaskId: json['parentTaskId'],
      category: json['category'] ?? 'General',
      startTime:
          json['startTime'] != null ? DateTime.parse(json['startTime']) : null,
      remainingMinutes: json['remainingMinutes'] ?? 0,
      subtasks: loadedSubtasks,
      googleEventId: json['googleEventId'],
      calendarEventRevision: json['calendarEventRevision'] ?? 0,
      isConflictCopy: json['isConflictCopy'] ?? false,
    );
  }
}
