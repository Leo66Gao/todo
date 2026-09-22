class SubjectFolder {
  String id;
  String name;
  String? subjectId;
  DateTime createdAt;

  SubjectFolder({
    required this.id,
    required this.name,
    this.subjectId,
    DateTime? createdAt,
  }) : createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'subjectId': subjectId,
        'createdAt': createdAt.toIso8601String(),
      };

  factory SubjectFolder.fromJson(Map<String, dynamic> json) {
    return SubjectFolder(
      id: json['id'] as String,
      name: json['name'] as String? ?? 'Folder',
      subjectId: json['subjectId'] as String?,
      createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ??
          DateTime.now(),
    );
  }
}
