class NoteAttachment {
  String id;
  String noteId;
  String fileName;
  String contentType;
  int sizeBytes;
  String? storagePath;
  String? downloadUrl;

  NoteAttachment({
    required this.id,
    required this.noteId,
    required this.fileName,
    required this.contentType,
    required this.sizeBytes,
    this.storagePath,
    this.downloadUrl,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'noteId': noteId,
        'fileName': fileName,
        'contentType': contentType,
        'sizeBytes': sizeBytes,
        'storagePath': storagePath,
        'downloadUrl': downloadUrl,
      };

  factory NoteAttachment.fromJson(Map<String, dynamic> json) {
    return NoteAttachment(
      id: json['id'] as String,
      noteId: json['noteId'] as String,
      fileName: json['fileName'] as String? ?? 'Attachment',
      contentType: json['contentType'] as String? ?? 'application/octet-stream',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      storagePath: json['storagePath'] as String?,
      downloadUrl: json['downloadUrl'] as String?,
    );
  }
}

class StudyNote {
  String id;
  String title;
  String content;
  String? subjectId;
  String? folderId;
  List<NoteAttachment> attachments;
  DateTime createdAt;
  DateTime updatedAt;

  StudyNote({
    required this.id,
    required this.title,
    this.content = '',
    this.subjectId,
    this.folderId,
    List<NoteAttachment> attachments = const [],
    DateTime? createdAt,
    DateTime? updatedAt,
  })  : attachments = List<NoteAttachment>.from(attachments),
        createdAt = createdAt ?? DateTime.now(),
        updatedAt = updatedAt ?? createdAt ?? DateTime.now();

  StudyNote copyWith({
    String? title,
    String? content,
    String? subjectId,
    bool clearSubject = false,
    String? folderId,
    bool clearFolder = false,
    List<NoteAttachment>? attachments,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return StudyNote(
      id: id,
      title: title ?? this.title,
      content: content ?? this.content,
      subjectId: clearSubject ? null : subjectId ?? this.subjectId,
      folderId: clearFolder ? null : folderId ?? this.folderId,
      attachments: attachments ?? this.attachments,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'title': title,
        'content': content,
        'subjectId': subjectId,
        'folderId': folderId,
        'attachments':
            attachments.map((attachment) => attachment.toJson()).toList(),
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
      };

  factory StudyNote.fromJson(Map<String, dynamic> json) {
    final createdAt =
        DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.now();
    final rawAttachments = json['attachments'] as List<dynamic>? ?? const [];
    return StudyNote(
      id: json['id'] as String,
      title: json['title'] as String? ?? 'Untitled note',
      content: json['content'] as String? ?? '',
      subjectId: json['subjectId'] as String?,
      folderId: json['folderId'] as String?,
      attachments: rawAttachments
          .whereType<Map>()
          .map((item) =>
              NoteAttachment.fromJson(Map<String, dynamic>.from(item)))
          .toList(),
      createdAt: createdAt,
      updatedAt:
          DateTime.tryParse(json['updatedAt'] as String? ?? '') ?? createdAt,
    );
  }
}
