import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:provider/provider.dart';

import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';
import '../widgets/quill_theme.dart';

/// Notes editor for tasks and assignments — the same WYSIWYG experience as
/// study notes (toolbar buttons, Cmd/Ctrl+B/I/U, auto-linked URLs), in a
/// compact bottom sheet.
void showNotesEditor(BuildContext context, Task task) {
  showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    isDismissible: false,
    enableDrag: false,
    backgroundColor: Colors.transparent,
    builder: (_) => _TaskNotesEditor(task: task),
  );
}

class _TaskNotesEditor extends StatefulWidget {
  final Task task;

  const _TaskNotesEditor({required this.task});

  @override
  State<_TaskNotesEditor> createState() => _TaskNotesEditorState();
}

class _TaskNotesEditorState extends State<_TaskNotesEditor> {
  late final QuillController _quill;
  final FocusNode _editorFocus = FocusNode();
  bool _dirty = false;
  bool _allowPop = false;

  @override
  void initState() {
    super.initState();
    _quill = QuillController(
      document: documentFromContent(widget.task.notes),
      selection: const TextSelection.collapsed(offset: 0),
    );
    _quill.addListener(_markDirty);
  }

  @override
  void dispose() {
    _quill.removeListener(_markDirty);
    _quill.dispose();
    _editorFocus.dispose();
    super.dispose();
  }

  void _markDirty() {
    if (mounted) setState(() => _dirty = true);
  }

  void _save() {
    if (utf8.encode(documentToContent(_quill.document)).length > 650 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('These notes are too large to sync. Keep it under 650 KB.'),
        ),
      );
      return;
    }
    context
        .read<TaskProvider>()
        .updateTaskNotes(
            widget.task.id,
            documentToContent(
                documentWithAutoLinks(_quill.document)));
    setState(() {
      _dirty = false;
      _allowPop = true;
    });
    Navigator.pop(context);
  }

  Future<void> _close() async {
    if (!_dirty) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
      return;
    }
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text('Your note has unsaved changes.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Keep editing'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(
              foregroundColor: context.ink,
              textStyle: const TextStyle(fontWeight: FontWeight.w600),
            ),
            child: const Text('Discard'),
          ),
        ],
      ),
    );
    if (discard == true && mounted) {
      setState(() => _allowPop = true);
      Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final media = MediaQuery.of(context);
    final availableHeight =
        media.size.height - media.viewInsets.bottom - media.padding.top - 12;
    final height = math.min(
      media.size.height * .88,
      math.max(0.0, availableHeight),
    );

    return PopScope(
      canPop: _allowPop || !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _close();
      },
      child: AnimatedPadding(
        duration: const Duration(milliseconds: 180),
        curve: Curves.easeOutCubic,
        padding: EdgeInsets.only(bottom: media.viewInsets.bottom),
        child: Align(
          alignment: Alignment.bottomCenter,
          child: Container(
            height: height,
            width: double.infinity,
            decoration: BoxDecoration(
              color: context.card,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: SafeArea(
              top: false,
              child: Column(
                children: [
                  const SizedBox(height: 10),
                  Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: context.fillSoft,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 6),
                    child: Row(
                      children: [
                        IconButton(
                          tooltip: 'Close',
                          onPressed: _close,
                          icon: const Icon(Icons.close),
                        ),
                        const SizedBox(width: 4),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Notes',
                                style: TextStyle(
                                  fontSize: 21,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                              Text(
                                widget.task.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: context.inkSoft,
                                ),
                              ),
                            ],
                          ),
                        ),
                        FilledButton(
                            onPressed: _save, child: const Text('Save')),
                      ],
                    ),
                  ),
                  Expanded(
                    child: ColoredBox(
                      color: context.card,
                      child: QuillEditor.basic(
                        controller: _quill,
                        focusNode: _editorFocus,
                        config: const QuillEditorConfig(
                          placeholder: 'Start writing…',
                          padding: EdgeInsets.fromLTRB(20, 16, 20, 24),
                        ),
                      ),
                    ),
                  ),
                  const Divider(height: 1),
                  _toolbar(),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _toolbar() {
    return Container(
      color: context.card,
      child: QuillSimpleToolbar(
        controller: _quill,
        config: QuillSimpleToolbarConfig(
          multiRowsDisplay: false,
          decoration: BoxDecoration(color: context.card),
          showBoldButton: true,
          showItalicButton: true,
          showUnderLineButton: true,
          showStrikeThrough: true,
          showClearFormat: true,
          showUndo: true,
          showRedo: true,
          showHeaderStyle: true,
          headerStyleType: HeaderStyleType.buttons,
          showListBullets: true,
          showListNumbers: true,
          showListCheck: true,
          showQuote: true,
          showCodeBlock: true,
          showInlineCode: true,
          showLink: true,
          showColorButton: false,
          showBackgroundColorButton: false,
          showAlignmentButtons: false,
          showSuperscript: false,
          showSubscript: false,
          showFontFamily: false,
          showFontSize: false,
          showSearchButton: false,
          showDividers: false,
          toolbarSectionSpacing: 2,
          iconTheme: quillToolbarIconTheme(context),
          buttonOptions: QuillSimpleToolbarButtonOptions(
            base: QuillToolbarBaseButtonOptions(
                iconTheme: quillToolbarIconTheme(context)),
          ),
        ),
      ),
    );
  }
}
