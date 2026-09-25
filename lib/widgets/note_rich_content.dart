import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:url_launcher/url_launcher.dart';

import '../utils/note_content.dart';
import 'quill_theme.dart';

/// Renders note content read-only, in either storage format: Quill deltas
/// (current) render as formatted rich text; legacy Markdown renders as
/// Markdown. Used inside task/assignment detail views.
class NoteRichContent extends StatelessWidget {
  final String content;
  final String emptyText;

  const NoteRichContent({
    super.key,
    required this.content,
    this.emptyText = 'No notes yet — tap to write.',
  });

  @override
  Widget build(BuildContext context) {
    if (isQuillDelta(content)) {
      final controller = QuillController(
        document: documentFromContent(content),
        selection: const TextSelection.collapsed(offset: 0),
      )..readOnly = true;
      return QuillEditor.basic(
        controller: controller,
        config: QuillEditorConfig(
          scrollable: false,
          customStyles: quillEditorCustomStyles,
          padding: EdgeInsets.zero,
        ),
      );
    }
    if (content.trim().isEmpty) {
      return Text(
        emptyText,
        style: TextStyle(fontSize: 15, height: 1.5, color: Colors.grey[400]),
      );
    }
    return MarkdownBody(
      data: content,
      onTapLink: (_, href, __) async {
        final uri = safeNoteLink(href);
        if (uri != null) await launchUrl(uri);
      },
      styleSheet: MarkdownStyleSheet(
        p: const TextStyle(fontSize: 15, height: 1.5),
        code: TextStyle(
          fontFamily: 'monospace',
          backgroundColor: Colors.grey.shade100,
        ),
        blockquoteDecoration: BoxDecoration(
          color: Colors.grey.shade100,
          borderRadius: BorderRadius.circular(8),
          border: const Border(left: BorderSide(width: 3)),
        ),
      ),
    );
  }
}
