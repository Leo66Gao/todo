import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/study_note.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';
import '../widgets/pill_dropdown.dart';
import '../widgets/quill_theme.dart';

/// WYSIWYG note editor — formatting buttons and Cmd/Ctrl+B/I/U apply real
/// formatting, Word-style. Content is stored as a Quill delta.
class StudyNoteEditorPage extends StatefulWidget {
  final StudyNote? note;
  final String? initialSubjectId;
  final String? initialFolderId;

  const StudyNoteEditorPage({
    super.key,
    this.note,
    this.initialSubjectId,
    this.initialFolderId,
  });

  @override
  State<StudyNoteEditorPage> createState() => _StudyNoteEditorPageState();
}

class _StudyNoteEditorPageState extends State<StudyNoteEditorPage> {
  late final TextEditingController _titleController;
  late final QuillController _quill;
  late final String _noteId;
  late final DateTime _createdAt;
  late String? _subjectId;
  late String? _folderId;
  late List<NoteAttachment> _attachments;

  final FocusNode _editorFocus = FocusNode();
  final ScrollController _scrollController = ScrollController();

  bool _dirty = false;
  bool _allowPop = false;

  bool get _isNew => widget.note == null;

  @override
  void initState() {
    super.initState();
    final note = widget.note;
    _noteId = note?.id ?? const Uuid().v4();
    _createdAt = note?.createdAt ?? DateTime.now();
    _subjectId = note?.subjectId ?? widget.initialSubjectId;
    _folderId = note?.folderId ?? widget.initialFolderId;
    _attachments = List<NoteAttachment>.from(note?.attachments ?? const []);
    _titleController = TextEditingController(text: note?.title ?? '');
    _quill = QuillController(
      document: documentFromContent(note?.content ?? ''),
      selection: const TextSelection.collapsed(offset: 0),
    );
    _titleController.addListener(_markDirty);
    _quill.addListener(_markDirty);
  }

  @override
  void dispose() {
    _titleController
      ..removeListener(_markDirty)
      ..dispose();
    _quill.removeListener(_markDirty);
    _quill.dispose();
    _editorFocus.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _markDirty() {
    if (mounted) setState(() => _dirty = true);
  }

  StudyNote _currentNote() {
    final trimmedTitle = _titleController.text.trim();
    return StudyNote(
      id: _noteId,
      title: trimmedTitle.isEmpty ? 'Untitled note' : trimmedTitle,
      content: documentToContent(documentWithAutoLinks(_quill.document)),
      subjectId: _subjectId,
      folderId: _folderId,
      attachments: _attachments,
      createdAt: _createdAt,
      updatedAt: DateTime.now(),
    );
  }

  void _save() {
    if (utf8.encode(documentToContent(_quill.document)).length >
        650 * 1024) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content:
              Text('This note is too large to sync. Keep it under 650 KB.'),
        ),
      );
      return;
    }
    final provider = context.read<TaskProvider>();
    final note = _currentNote();
    if (_isNew) {
      provider.addNote(note);
    } else {
      provider.updateNote(note);
    }
    setState(() {
      _dirty = false;
      _allowPop = true;
    });
    Navigator.of(context).pop(note);
  }

  Future<void> _requestPop() async {
    if (!_dirty) {
      setState(() => _allowPop = true);
      Navigator.of(context).pop();
      return;
    }
    final discard = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Discard changes?'),
        content: const Text('Your edits have not been saved.'),
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
      Navigator.of(context).pop();
    }
  }

  Future<void> _delete() async {
    if (_isNew) return;
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
    if (confirmed != true || !mounted) return;
    context.read<TaskProvider>().deleteNote(_noteId);
    setState(() => _allowPop = true);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final folders = provider.folders
        .where((folder) => folder.subjectId == _subjectId)
        .toList();
    // A note can point at a folder that no longer matches its subject (e.g.
    // after editing the subject). Keep it instead of silently resetting it —
    // the dropdown just appends the orphaned folder as an extra option.
    final hasCurrentFolder =
        _folderId != null && folders.any((folder) => folder.id == _folderId);

    return PopScope(
      canPop: _allowPop || !_dirty,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _requestPop();
      },
      child: Scaffold(
        appBar: AppBar(
          leading: IconButton(
            tooltip: 'Close',
            onPressed: _requestPop,
            icon: const Icon(Icons.close),
          ),
          title: Text(_isNew ? 'New note' : 'Edit note'),
          actions: [
            if (!_isNew)
              IconButton(
                tooltip: 'Delete note',
                onPressed: _delete,
                icon: const Icon(Icons.delete_outline),
              ),
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: FilledButton(
                onPressed: _save,
                child: const Text('Save'),
              ),
            ),
          ],
        ),
        body: SafeArea(
          child: Column(
            children: [
              _metadataRow(provider, includeOrphanFolder: !hasCurrentFolder),
              _toolbar(),
              Divider(height: 1, thickness: 0.6, color: context.hairline),
              Expanded(
                child: ColoredBox(
                  color: context.card,
                  child: QuillEditor.basic(
                    controller: _quill,
                    focusNode: _editorFocus,
                    scrollController: _scrollController,
                    config: const QuillEditorConfig(
                      placeholder: 'Start writing…',
                      padding: EdgeInsets.fromLTRB(20, 14, 20, 32),
                    ),
                  ),
                ),
              ),
            ],
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
          // Direct buttons read config.iconTheme; grouped buttons (headers,
          // lists, …) fall back to buttonOptions.base — style both.
          iconTheme: quillToolbarIconTheme(context),
          buttonOptions: QuillSimpleToolbarButtonOptions(
            base: QuillToolbarBaseButtonOptions(iconTheme: quillToolbarIconTheme(context)),
          ),
        ),
      ),
    );
  }

  Widget _metadataRow(TaskProvider provider,
      {bool includeOrphanFolder = false}) {
    final projects = provider.projects;
    final folders = provider.folders
        .where((folder) => folder.subjectId == _subjectId)
        .toList();
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          TextField(
            controller: _titleController,
            maxLines: 1,
            style: const TextStyle(fontSize: 25, fontWeight: FontWeight.w700),
            decoration: const InputDecoration(
              hintText: 'Note title',
              border: InputBorder.none,
              contentPadding: EdgeInsets.symmetric(horizontal: 4),
            ),
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: PillDropdown<String?>(
                  hint: 'No subject',
                  icon: Icons.school_outlined,
                  value: _subjectId,
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('No subject'),
                    ),
                    ...projects.map(
                      (project) => DropdownMenuItem<String?>(
                        value: project.id,
                        child: Text(project.title,
                            overflow: TextOverflow.ellipsis),
                      ),
                    ),
                  ],
                  onChanged: (value) => setState(() {
                    _subjectId = value;
                    _folderId = null;
                    _dirty = true;
                  }),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: PillDropdown<String?>(
                  key: ValueKey((_subjectId, _folderId)),
                  hint: 'No folder',
                  icon: Icons.folder_outlined,
                  value: _folderId,
                  items: [
                    const DropdownMenuItem<String?>(
                      value: null,
                      child: Text('No folder'),
                    ),
                    ...folders.map(
                      (folder) => DropdownMenuItem<String?>(
                        value: folder.id,
                        child:
                            Text(folder.name, overflow: TextOverflow.ellipsis),
                      ),
                    ),
                    if (includeOrphanFolder && _folderId != null)
                      DropdownMenuItem<String?>(
                        value: _folderId,
                        child: Text(
                          provider.folders
                                  .where((folder) => folder.id == _folderId)
                                  .map((folder) => folder.name)
                                  .firstOrNull ??
                              'Current folder',
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() {
                    _folderId = value;
                    _dirty = true;
                  }),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  }

