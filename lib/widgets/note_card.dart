import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/study_note.dart';
import '../models/subject_folder.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';

/// Card for a study note — used on the Subjects page and inside subject
/// workspaces. Shows subject color, title, a plain-text preview and meta.
class NoteCard extends StatelessWidget {
  final StudyNote note;
  final Color? subjectColor;
  final String? subjectName;
  final SubjectFolder? folder;
  final VoidCallback onTap;

  const NoteCard({
    super.key,
    required this.note,
    required this.onTap,
    this.subjectColor,
    this.subjectName,
    this.folder,
  });

  @override
  Widget build(BuildContext context) {
    final preview = plainNotePreview(note.content);
    final accent = subjectColor ?? Colors.black54;
    return Material(
      color: context.card,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: context.hairline),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: 0.025),
                blurRadius: 12,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration:
                        BoxDecoration(color: accent, shape: BoxShape.circle),
                  ),
                  const SizedBox(width: 7),
                  Expanded(
                    child: Text(
                      subjectName ?? 'No subject',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 11,
                        color: context.inkSoft,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  if (note.attachments.isNotEmpty) ...[
                    Icon(Icons.attach_file,
                        size: 14, color: context.inkSoft),
                    Text(
                      '${note.attachments.length}',
                      style:
                          TextStyle(fontSize: 10, color: context.inkSoft),
                    ),
                  ],
                ],
              ),
              const SizedBox(height: 10),
              Text(
                note.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style:
                    const TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 5),
              Expanded(
                child: Text(
                  preview.isEmpty ? 'Empty note' : preview,
                  maxLines: 3,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    height: 1.45,
                    color: preview.isEmpty
                        ? context.inkFaint
                        : context.inkSoft,
                  ),
                ),
              ),
              Row(
                children: [
                  if (folder != null) ...[
                    Icon(Icons.folder_outlined,
                        size: 13, color: context.inkSoft),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        folder!.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                            fontSize: 10.5, color: context.inkSoft),
                      ),
                    ),
                    const SizedBox(width: 8),
                  ],
                  const Spacer(),
                  Text(
                    DateFormat('MMM d').format(note.updatedAt),
                    style:
                        TextStyle(fontSize: 10.5, color: context.inkSoft),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Previews handle both Quill delta notes and legacy Markdown.
String plainNotePreview(String markdown) => notePlainText(markdown);

/// Horizontal folder card used across the Subjects surfaces.
class FolderCard extends StatelessWidget {
  final String name;
  final int count;
  final bool selected;
  final VoidCallback onTap;
  final VoidCallback? onDelete;

  const FolderCard({
    super.key,
    required this.name,
    required this.count,
    required this.selected,
    required this.onTap,
    this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 10),
      child: Material(
        color: selected ? context.ink : context.card,
        borderRadius: BorderRadius.circular(16),
        child: InkWell(
          onTap: onTap,
          onLongPress: onDelete,
          borderRadius: BorderRadius.circular(16),
          child: Container(
            width: 154,
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(16),
              border: Border.all(
                color: selected ? context.ink : context.hairline,
              ),
            ),
            child: Row(
              children: [
                Icon(
                  selected ? Icons.folder : Icons.folder_outlined,
                  color: selected ? context.inkInverse : context.ink,
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color:
                              selected ? context.inkInverse : context.ink,
                        ),
                      ),
                      Text(
                        '$count ${count == 1 ? 'note' : 'notes'}',
                        style: TextStyle(
                          fontSize: 10.5,
                          color: selected
                              ? context.inkInverse.withValues(alpha: 0.70)
                              : context.inkSoft,
                        ),
                      ),
                    ],
                  ),
                ),
                if (onDelete != null)
                  PopupMenuButton<String>(
                    padding: EdgeInsets.zero,
                    iconSize: 18,
                    color: context.card,
                    iconColor: selected
                        ? context.inkInverse.withValues(alpha: 0.70)
                        : context.inkSoft,
                    onSelected: (_) => onDelete!(),
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                          value: 'delete', child: Text('Delete folder')),
                    ],
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
