import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/project.dart';
import '../models/study_note.dart';
import '../models/subject_folder.dart';
import '../models/task.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/task_formatters.dart';
import '../widgets/glass_button.dart';
import '../widgets/note_card.dart';
import 'add_task_sheet.dart';
import 'assignment_detail_page.dart';
import 'name_color_dialog.dart';
import 'note_view_page.dart';
import 'study_note_editor_page.dart';
import 'task_detail_sheet.dart';

/// A subject workspace — one focused world per subject: what's due next,
/// what's overdue, and every note and folder that belongs here. Closer to a
/// lightweight Notion page than a task filter.
class SubjectWorkspacePage extends StatefulWidget {
  final String subjectId;

  const SubjectWorkspacePage({super.key, required this.subjectId});

  @override
  State<SubjectWorkspacePage> createState() => _SubjectWorkspacePageState();
}

class _SubjectWorkspacePageState extends State<SubjectWorkspacePage> {
  Future<void> _openEditor({StudyNote? note}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StudyNoteEditorPage(
          note: note,
          initialSubjectId: note == null ? widget.subjectId : null,
        ),
      ),
    );
  }

  Future<void> _openNote(StudyNote note) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NoteViewPage(noteId: note.id),
      ),
    );
  }

  Future<void> _editSubject(Project subject) async {
    final result = await showNameAndColorDialog(
      context,
      title: 'Edit subject',
      hintText: 'Subject name',
      initialName: subject.title,
      initialColor: Color(subject.colorValue),
    );
    if (result == null || !mounted) return;
    context.read<TaskProvider>().updateProject(Project(
          id: subject.id,
          title: result.$1,
          colorValue: result.$2.toARGB32(),
        ));
  }

  Future<void> _deleteSubject(Project subject) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete “${subject.title}”?'),
        content: const Text(
          'Tasks will be kept, but will no longer have a subject. Notes keep '
          'their content but lose the subject link. This cannot be undone.',
        ),
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
    context.read<TaskProvider>().deleteProject(subject.id);
    if (Navigator.of(context).canPop()) Navigator.of(context).pop();
  }

  Future<void> _createFolder(TaskProvider provider) async {
    final controller = TextEditingController();
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('New folder'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.sentences,
          decoration: const InputDecoration(
            labelText: 'Folder name',
            hintText: 'Lecture notes',
          ),
          onSubmitted: (value) {
            if (value.trim().isNotEmpty) Navigator.pop(context, value.trim());
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final value = controller.text.trim();
              if (value.isNotEmpty) Navigator.pop(context, value);
            },
            child: const Text('Create'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || !mounted) return;
    context.read<TaskProvider>().addFolder(
          SubjectFolder(
            id: const Uuid().v4(),
            name: name,
            subjectId: widget.subjectId,
          ),
        );
  }

  Future<void> _deleteFolder(SubjectFolder folder) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('Delete “${folder.name}”?'),
        content: const Text(
          'Notes in this folder will be kept and moved out of the folder.',
        ),
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
    context.read<TaskProvider>().deleteFolder(folder.id);
  }

  void _openTask(Task task) {
    if (task.parentTaskId != null || task.type == TaskType.assignment) {
      Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) => AssignmentDetailPage(
                taskId: task.parentTaskId ?? task.id)),
      );
    } else {
      showTaskDetails(context, task);
    }
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final subject = provider.projects
        .where((p) => p.id == widget.subjectId)
        .cast<Project?>()
        .firstOrNull;

    if (subject == null) {
      // Deleted while viewing — close.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && Navigator.canPop(context)) Navigator.pop(context);
      });
      return const Scaffold(body: SizedBox());
    }

    final accent = Color(subject.colorValue);
    final subjectTasks = provider.tasks
        .where((t) => t.projectId == subject.id)
        .toList()
      ..sort((a, b) => a.date.compareTo(b.date));
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final overdue = subjectTasks
        .where((t) => !t.isDone && t.date.isBefore(today))
        .toList();
    final upcoming = subjectTasks
        .where((t) => !t.isDone && !t.date.isBefore(today))
        .toList();
    final completedCount =
        subjectTasks.where((t) => t.isDone).length;

    final folders = provider.folders
        .where((folder) => folder.subjectId == subject.id)
        .toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    final notes = provider.notes
        .where((note) => note.subjectId == subject.id)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _header(context, subject, accent)),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(20, 0, 20, 0),
              sliver: SliverToBoxAdapter(
                child: _overviewCard(
                  context,
                  overdue: overdue,
                  upcoming: upcoming,
                  completedCount: completedCount,
                  noteCount: notes.length,
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: _upcomingSection(context, overdue, upcoming),
            ),
            SliverToBoxAdapter(
              child: _foldersSection(provider, folders),
            ),
            if (notes.isEmpty)
              SliverToBoxAdapter(child: _notesEmptyState())
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 140),
                sliver: SliverLayoutBuilder(
                  builder: (context, constraints) {
                    final width = constraints.crossAxisExtent;
                    final columns = width >= 1000
                        ? 3
                        : width >= 650
                            ? 2
                            : 1;
                    return SliverGrid(
                      gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                        crossAxisCount: columns,
                        mainAxisExtent: columns == 1 ? 154 : 178,
                        crossAxisSpacing: 12,
                        mainAxisSpacing: 12,
                      ),
                      delegate: SliverChildBuilderDelegate(
                        (context, index) {
                          final note = notes[index];
                          return NoteCard(
                            note: note,
                            subjectColor: accent,
                            subjectName: subject.title,
                            folder: _folderFor(folders, note.folderId),
                            onTap: () => _openNote(note),
                          );
                        },
                        childCount: notes.length,
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
      floatingActionButton: Padding(
        // 82 + the FAB slot's own 16px bottom margin = the 98px level the
        // New Task pill sits at on the tab pages.
        padding: const EdgeInsets.only(bottom: 82),
        child: GlassPillButton(
          icon: Icons.note_add_outlined,
          label: 'New note',
          onTap: () => _openEditor(),
        ),
      ),
    );
  }

  Widget _header(BuildContext context, Project subject, Color accent) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back),
            onPressed: () => Navigator.pop(context),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 12,
                      height: 12,
                      decoration:
                          BoxDecoration(color: accent, shape: BoxShape.circle),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        subject.title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                            fontSize: 24, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          IconButton(
            tooltip: 'New task in this subject',
            icon: const Icon(Icons.add_task_outlined),
            onPressed: () => showAddTaskDialog(context,
                initialProjectId: subject.id),
          ),
          PopupMenuButton<String>(
            icon: const Icon(Icons.more_horiz),
            color: context.card,
            shape:
                RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
            onSelected: (value) {
              if (value == 'edit') _editSubject(subject);
              if (value == 'delete') _deleteSubject(subject);
            },
            itemBuilder: (_) => const [
              PopupMenuItem(value: 'edit', child: Text('Edit subject')),
              PopupMenuItem(
                  value: 'delete', child: Text('Delete subject')),
            ],
          ),
        ],
      ),
    );
  }

  Widget _overviewCard(
    BuildContext context, {
    required List<Task> overdue,
    required List<Task> upcoming,
    required int completedCount,
    required int noteCount,
  }) {
    final next = upcoming.isNotEmpty ? upcoming.first : null;
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: context.card,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: context.hairline),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.02),
            blurRadius: 10,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              _OverviewStat(
                  icon: Icons.upcoming_outlined,
                  value: '${upcoming.length}',
                  label: 'upcoming'),
              _divider(),
              _OverviewStat(
                  icon: Icons.warning_amber_rounded,
                  value: '${overdue.length}',
                  label: 'overdue',
                  valueColor:
                      overdue.isEmpty ? context.ink : Colors.red[700]),
              _divider(),
              _OverviewStat(
                  icon: Icons.sticky_note_2_outlined,
                  value: '$noteCount',
                  label: 'notes'),
              _divider(),
              _OverviewStat(
                  icon: Icons.check_circle_outline,
                  value: '$completedCount',
                  label: 'done'),
            ],
          ),
          if (next != null) ...[
            const SizedBox(height: 12),
            Container(
              width: double.infinity,
              padding:
                  const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
              decoration: BoxDecoration(
                color: context.fillSoft,
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: context.ink,
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      DateFormat('MMM d').format(next.date),
                      style: TextStyle(
                          fontSize: 10.5,
                          color: context.inkInverse,
                          fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      'Next: ${next.title}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                          fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _divider() => Container(
        width: 1,
        height: 28,
        color: context.hairline,
        margin: const EdgeInsets.symmetric(horizontal: 6),
      );

  Widget _upcomingSection(
      BuildContext context, List<Task> overdue, List<Task> upcoming) {
    final items = [...overdue, ...upcoming.take(6 - overdue.length.clamp(0, 6))]
        .take(6)
        .toList();
    if (items.isEmpty) {
      return Padding(
        padding: const EdgeInsets.fromLTRB(20, 18, 20, 6),
        child: Row(
          children: [
            _caption('UPCOMING'),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                'Nothing due — you’re on top of this subject',
                style: TextStyle(fontSize: 12.5, color: context.inkSoft),
              ),
            ),
          ],
        ),
      );
    }
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 14, 16, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: _caption('UPCOMING'),
          ),
          const SizedBox(height: 8),
          ...items.map((task) => _TaskRow(
                task: task,
                isOverdue: overdue.contains(task),
                onTap: () => _openTask(task),
              )),
        ],
      ),
    );
  }

  Widget _foldersSection(TaskProvider provider, List<SubjectFolder> folders) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: _caption('FOLDERS'),
              ),
              const Spacer(),
              TextButton.icon(
                onPressed: () => _createFolder(provider),
                icon: const Icon(Icons.create_new_folder_outlined, size: 18),
                label: const Text('New folder'),
              ),
            ],
          ),
          SizedBox(
            height: 76,
            child: folders.isEmpty
                ? Row(
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(left: 4, top: 4),
                        child: Text(
                          'No folders yet — group your notes into topics.',
                          style: TextStyle(
                              fontSize: 12.5, color: context.inkSoft),
                        ),
                      ),
                    ],
                  )
                : ListView(
                    scrollDirection: Axis.horizontal,
                    children: [
                      ...folders.map(
                        (folder) => FolderCard(
                          name: folder.name,
                          count: provider.notes
                              .where((note) => note.folderId == folder.id)
                              .length,
                          selected: false,
                          onTap: () => _openFolderNotes(folder),
                          onDelete: () => _deleteFolder(folder),
                        ),
                      ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }

  void _openFolderNotes(SubjectFolder folder) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => _FolderNotesPage(subjectId: widget.subjectId, folder: folder),
      ),
    );
  }

  Widget _notesEmptyState() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(32, 26, 32, 20),
      child: Column(
        children: [
          Icon(Icons.menu_book_outlined, size: 44, color: context.inkFaint),
          const SizedBox(height: 12),
          Text('No notes in this subject yet',
              style:
                  const TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(
            'Write lecture notes, paste links, attach files — they all stay with this subject.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.inkSoft, height: 1.45, fontSize: 13),
          ),
        ],
      ),
    );
  }

  SubjectFolder? _folderFor(List<SubjectFolder> folders, String? id) {
    if (id == null) return null;
    for (final folder in folders) {
      if (folder.id == id) return folder;
    }
    return null;
  }

  Widget _caption(String text) => Text(
        text,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w600,
          letterSpacing: 1.2,
          color: context.inkFaint,
        ),
      );
}

class _FolderNotesPage extends StatelessWidget {
  final String subjectId;
  final SubjectFolder folder;

  const _FolderNotesPage({required this.subjectId, required this.folder});

  Future<void> _openEditor(BuildContext context, {StudyNote? note}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StudyNoteEditorPage(
          note: note,
          initialSubjectId: note == null ? subjectId : null,
          initialFolderId: note == null ? folder.id : null,
        ),
      ),
    );
  }

  Future<void> _openNote(BuildContext context, StudyNote note) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => NoteViewPage(noteId: note.id),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final subject = provider.projects
        .where((p) => p.id == subjectId)
        .cast<Project?>()
        .firstOrNull;
    final notes = provider.notes
        .where((note) => note.folderId == folder.id)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    return Scaffold(
      appBar: AppBar(
        title: Text(folder.name, style: const TextStyle(fontSize: 20)),
      ),
      floatingActionButton: Padding(
        padding: const EdgeInsets.only(bottom: 12),
        child: GlassPillButton(
          icon: Icons.note_add_outlined,
          label: 'New note',
          onTap: () => _openEditor(context),
        ),
      ),
      body: notes.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.folder_open_outlined,
                      size: 52, color: context.inkFaint),
                  const SizedBox(height: 12),
                  Text('This folder is empty',
                      style: const TextStyle(
                          fontSize: 15.5, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 6),
                  Text('New notes you create here stay in “${folder.name}”.',
                      style: TextStyle(color: context.inkSoft, fontSize: 13)),
                ],
              ),
            )
          : SafeArea(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final width = constraints.maxWidth;
                  final columns = width >= 1000
                      ? 3
                      : width >= 650
                          ? 2
                          : 1;
                  return GridView.builder(
                    padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
                    gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
                      crossAxisCount: columns,
                      mainAxisExtent: columns == 1 ? 154 : 178,
                      crossAxisSpacing: 12,
                      mainAxisSpacing: 12,
                    ),
                    itemCount: notes.length,
                    itemBuilder: (context, index) {
                      final note = notes[index];
                      return NoteCard(
                        note: note,
                        subjectColor: subject == null
                            ? null
                            : Color(subject.colorValue),
                        subjectName: subject?.title,
                        folder: folder,
                        onTap: () => _openNote(context, note),
                      );
                    },
                  );
                },
              ),
            ),
    );
  }
}

class _OverviewStat extends StatelessWidget {
  final IconData icon;
  final String value;
  final String label;
  final Color? valueColor;

  const _OverviewStat({
    required this.icon,
    required this.value,
    required this.label,
    this.valueColor,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: Row(
        children: [
          Icon(icon, size: 17, color: context.inkFaint),
          const SizedBox(width: 7),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(value,
                    style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: valueColor ?? context.ink)),
                Text(label,
                    style:
                        TextStyle(fontSize: 10, color: context.inkSoft)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Compact task row for the workspace overview: checkbox + title + date.
class _TaskRow extends StatelessWidget {
  final Task task;
  final bool isOverdue;
  final VoidCallback onTap;

  const _TaskRow({
    required this.task,
    required this.isOverdue,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final provider = Provider.of<TaskProvider>(context, listen: false);
    final isMilestone = task.parentTaskId != null;
    final isDone = task.isDone;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
        decoration: BoxDecoration(
          color: context.card,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: context.hairline),
        ),
        child: Row(
          children: [
            GestureDetector(
              behavior: HitTestBehavior.opaque,
              onTap: () => provider.toggleTask(task.id),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 150),
                width: 22,
                height: 22,
                decoration: BoxDecoration(
                  color: isDone ? context.ink : Colors.transparent,
                  borderRadius: BorderRadius.circular(7),
                  border: Border.all(
                    color: isDone ? context.ink : context.hairline,
                    width: 1.8,
                  ),
                ),
                child: isDone
                    ? Icon(Icons.check, size: 14, color: context.inkInverse)
                    : null,
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                task.title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  decoration: isDone ? TextDecoration.lineThrough : null,
                  color: isDone ? context.inkFaint : context.ink,
                ),
              ),
            ),
            if (isMilestone) ...[
              const SizedBox(width: 6),
              Icon(Icons.flag_outlined, size: 14, color: context.inkFaint),
            ],
            if (task.type == TaskType.assignment) ...[
              const SizedBox(width: 6),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: Colors.blue[50],
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text('DUE',
                    style: TextStyle(
                        fontSize: 8.5,
                        color: Colors.blue[800],
                        fontWeight: FontWeight.bold)),
              ),
            ],
            const SizedBox(width: 10),
            Text(
              formatDueLabel(task.date, isDone: task.isDone),
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: isDone
                    ? context.inkFaint
                    : isOverdue
                        ? Colors.red[700]
                        : context.inkSoft,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
