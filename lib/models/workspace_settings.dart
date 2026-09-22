/// A user-defined label that can be attached to a task.
class TaskLabel {
  final String id;
  final String name;
  final int colorValue;

  const TaskLabel({
    required this.id,
    required this.name,
    required this.colorValue,
  });

  TaskLabel copyWith({String? id, String? name, int? colorValue}) {
    return TaskLabel(
      id: id ?? this.id,
      name: name ?? this.name,
      colorValue: colorValue ?? this.colorValue,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'colorValue': colorValue,
      };

  factory TaskLabel.fromJson(Map<String, dynamic> json) {
    return TaskLabel(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? 'Label',
      colorValue: json['colorValue'] as int? ?? 0xFF2196F3,
    );
  }
}

/// Controls which optional fields appear while creating or editing a task.
class WorkspaceSettings {
  /// Field ids in the order the task form renders them. Fields the user hid
  /// stay in the order so re-enabling them puts them back where they were.
  static const List<String> defaultFieldOrder = [
    'type',
    'date',
    'time',
    'notes',
    'duration',
    'difficulty',
    'priority',
    'subject',
    'labels',
  ];

  /// Appearance: 'system' | 'light' | 'dark'.
  final String themeMode;

  final bool showTaskType;
  final bool showDate;
  final bool showTime;
  final bool showNotes;
  final bool showDuration;
  final bool showDifficulty;
  final bool showPriority;
  final bool showSubject;
  final bool showLabels;
  final List<TaskLabel> labels;
  final List<String> fieldOrder;

  const WorkspaceSettings({
    this.themeMode = 'system',
    this.showTaskType = true,
    this.showDate = true,
    this.showTime = true,
    this.showNotes = true,
    this.showDuration = true,
    this.showDifficulty = true,
    this.showPriority = true,
    this.showSubject = true,
    this.showLabels = true,
    this.labels = const [],
    this.fieldOrder = defaultFieldOrder,
  });

  bool isFieldVisible(String fieldId) {
    switch (fieldId) {
      case 'type':
        return showTaskType;
      case 'date':
        return showDate;
      case 'time':
        return showTime;
      case 'notes':
        return showNotes;
      case 'duration':
        return showDuration;
      case 'difficulty':
        return showDifficulty;
      case 'priority':
        return showPriority;
      case 'subject':
        return showSubject;
      case 'labels':
        return showLabels;
    }
    return false;
  }

  WorkspaceSettings copyWith({
    String? themeMode,
    bool? showTaskType,
    bool? showDate,
    bool? showTime,
    bool? showNotes,
    bool? showDuration,
    bool? showDifficulty,
    bool? showPriority,
    bool? showSubject,
    bool? showLabels,
    List<TaskLabel>? labels,
    List<String>? fieldOrder,
  }) {
    return WorkspaceSettings(
      themeMode: themeMode ?? this.themeMode,
      showTaskType: showTaskType ?? this.showTaskType,
      showDate: showDate ?? this.showDate,
      showTime: showTime ?? this.showTime,
      showNotes: showNotes ?? this.showNotes,
      showDuration: showDuration ?? this.showDuration,
      showDifficulty: showDifficulty ?? this.showDifficulty,
      showPriority: showPriority ?? this.showPriority,
      showSubject: showSubject ?? this.showSubject,
      showLabels: showLabels ?? this.showLabels,
      labels: labels ?? this.labels,
      fieldOrder: fieldOrder ?? this.fieldOrder,
    );
  }

  Map<String, dynamic> toJson() => {
        'themeMode': themeMode,
        'showTaskType': showTaskType,
        'showDate': showDate,
        'showTime': showTime,
        'showNotes': showNotes,
        'showDuration': showDuration,
        'showDifficulty': showDifficulty,
        'showPriority': showPriority,
        'showSubject': showSubject,
        'showLabels': showLabels,
        'labels': labels.map((label) => label.toJson()).toList(),
        'fieldOrder': fieldOrder,
      };

  factory WorkspaceSettings.fromJson(Map<String, dynamic> json) {
    final rawLabels = json['labels'];
    // Keep only known ids; anything missing is appended in default position
    // so a hand-edited or older settings payload can never drop a field.
    final rawOrder = json['fieldOrder'];
    final seen = <String>{};
    final order = <String>[];
    if (rawOrder is List) {
      for (final id in rawOrder) {
        if (id is String &&
            defaultFieldOrder.contains(id) &&
            seen.add(id)) {
          order.add(id);
        }
      }
    }
    for (final id in defaultFieldOrder) {
      if (seen.add(id)) order.add(id);
    }
    return WorkspaceSettings(
      themeMode: _validThemeMode(json['themeMode']),
      showTaskType: json['showTaskType'] as bool? ?? true,
      showDate: json['showDate'] as bool? ?? true,
      showTime: json['showTime'] as bool? ?? true,
      showNotes: json['showNotes'] as bool? ?? true,
      showDuration: json['showDuration'] as bool? ?? true,
      showDifficulty: json['showDifficulty'] as bool? ?? true,
      showPriority: json['showPriority'] as bool? ?? true,
      showSubject: json['showSubject'] as bool? ?? true,
      showLabels: json['showLabels'] as bool? ?? true,
      labels: rawLabels is List
          ? rawLabels
              .whereType<Map>()
              .map((label) =>
                  TaskLabel.fromJson(Map<String, dynamic>.from(label)))
              .toList(growable: false)
          : const [],
      fieldOrder: List.unmodifiable(order),
    );
  }

  static String _validThemeMode(dynamic raw) =>
      raw == 'light' || raw == 'dark' ? raw : 'system';
}
