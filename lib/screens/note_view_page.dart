import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../models/project.dart';
import '../models/study_note.dart';
import '../models/subject_folder.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';
import 'study_note_editor_page.dart';

/// Read-first note view: opening a note shows the formatted document; editing
/// is one tap away instead of the default.
class NoteViewPage extends StatelessWidget {
  final String noteId;

  const NoteViewPage({super.key, required this.noteId});

  Future<void> _edit(BuildContext context, StudyNote note) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StudyNoteEditorPage(note: note),
      ),
    );
  }

  Future<void> _delete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete note?'),
        content: const Text('This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(
              foregroundColor: context.ink,
              textStyle: const TextStyle(fontWeight: FontWeight.w600),
            ),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    context.read<TaskProvider>().deleteNote(noteId);
    if (Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final note = provider.notes
        .where((n) => n.id == noteId)
        .cast<StudyNote?>()
        .firstOrNull;

    if (note == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (Navigator.of(context).canPop()) Navigator.of(context).pop();
      });
      return const Scaffold(body: SizedBox());
    }

    final subject = provider.projects
        .where((p) => p.id == note.subjectId)
        .cast<Project?>()
        .firstOrNull;
    final folder = provider.folders
        .where((f) => f.id == note.folderId)
        .cast<SubjectFolder?>()
        .firstOrNull;

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => Navigator.pop(context),
        ),
        title: const Text('Note'),
        actions: [
          IconButton(
            tooltip: 'Edit note',
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => _edit(context, note),
          ),
          IconButton(
            tooltip: 'Delete note',
            icon: const Icon(Icons.delete_outline),
            onPressed: () => _delete(context),
          ),
          const SizedBox(width: 4),
        ],
      ),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(24, 8, 24, 48),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                note.title,
                style: const TextStyle(
                    fontSize: 27, fontWeight: FontWeight.w700, height: 1.25),
              ),
              const SizedBox(height: 12),
              Wrap(
                spacing: 14,
                runSpacing: 6,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (subject != null)
                    _metaItem(
                      Container(
                        width: 9,
                        height: 9,
                        decoration: BoxDecoration(
                            color: Color(subject.colorValue),
                            shape: BoxShape.circle),
                      ),
                      Text(subject.title,
                          style: TextStyle(
                              fontSize: 12.5,
                              fontWeight: FontWeight.w600,
                              color: context.inkSoft)),
                    ),
                  if (folder != null)
                    _metaItem(
                        Icon(Icons.folder_outlined,
                            size: 14, color: context.inkFaint),
                        Text(folder.name,
                            style: TextStyle(
                                fontSize: 12.5, color: context.inkSoft))),
                  Text(
                    'Updated ${DateFormat('MMM d').format(note.updatedAt)}',
                    style: TextStyle(fontSize: 12.5, color: context.inkSoft),
                  ),
                ],
              ),
              const SizedBox(height: 18),
              const Divider(height: 1),
              const SizedBox(height: 18),
              if (isQuillDelta(note.content))
                QuillEditor.basic(
                  controller: QuillController(
                    document: documentFromContent(note.content),
                    selection: const TextSelection.collapsed(offset: 0),
                  )..readOnly = true,
                )
              else if (note.content.trim().isNotEmpty)
                MarkdownBody(
                  data: note.content,
                  onTapLink: (_, href, __) async {
                    final uri = safeNoteLink(href);
                    if (uri != null) await launchUrl(uri);
                  },
                  styleSheet: MarkdownStyleSheet(
                    p: const TextStyle(fontSize: 16, height: 1.6),
                    h1: const TextStyle(
                        fontSize: 28, fontWeight: FontWeight.w700),
                    h2: const TextStyle(
                        fontSize: 22, fontWeight: FontWeight.w700),
                    h3: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.w700),
                    code: TextStyle(
                      fontFamily: 'monospace',
                      backgroundColor: context.fillSoft,
                    ),
                    blockquoteDecoration: BoxDecoration(
                      color: context.fillSoft,
                      borderRadius: BorderRadius.circular(8),
                      border: const Border(left: BorderSide(width: 4)),
                    ),
                  ),
                )
              else
                Text(
                  'This note is empty — tap the pencil to write.',
                  style: TextStyle(color: context.inkFaint, fontSize: 15),
                ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _metaItem(Widget leading, Widget label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        leading,
        const SizedBox(width: 6),
        label,
      ],
    );
  }
}
