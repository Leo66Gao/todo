import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:uuid/uuid.dart';

import '../models/project.dart';
import '../models/study_note.dart';
import '../models/subject_folder.dart';
import '../state/task_provider.dart';
import '../theme/app_theme.dart';
import '../utils/note_content.dart';
import '../widgets/glass_button.dart';
import '../widgets/note_card.dart';
import 'name_color_dialog.dart';
import 'note_view_page.dart';
import 'study_note_editor_page.dart';
import 'subject_workspace_page.dart';

/// Subjects landing page: a card per subject (tap to open its workspace),
/// plus the full notes browser underneath for when you just want to look.
class SubjectsPage extends StatefulWidget {
  const SubjectsPage({super.key});

  @override
  State<SubjectsPage> createState() => _SubjectsPageState();
}

class _SubjectsPageState extends State<SubjectsPage> {
  final _searchController = TextEditingController();
  String? _selectedFolderId;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _createSubject() async {
    final result = await showNameAndColorDialog(
      context,
      title: 'New subject',
      hintText: 'Subject name',
      initialName: '',
      initialColor: kItemPalette[6],
    );
    if (result == null || !mounted) return;
    context.read<TaskProvider>().addProject(Project(
          id: const Uuid().v4(),
          title: result.$1,
          colorValue: result.$2.toARGB32(),
        ));
  }

  Future<void> _openEditor({StudyNote? note}) async {
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => StudyNoteEditorPage(note: note),
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

  @override
  Widget build(BuildContext context) {
    final provider = context.watch<TaskProvider>();
    final projects = provider.projects;
    final query = _searchController.text.trim().toLowerCase();
    final searching = query.isNotEmpty;

    final notes = provider.notes.where((note) {
      // A selected folder scopes the browse list, but a search always
      // looks through every note.
      if (!searching &&
          _selectedFolderId != null &&
          note.folderId != _selectedFolderId) {
        return false;
      }
      if (query.isEmpty) return true;
      return note.title.toLowerCase().contains(query) ||
          notePlainText(note.content).toLowerCase().contains(query);
    }).toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));

    return Scaffold(
      body: SafeArea(
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _header(projects.length)),
            if (!searching)
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
                sliver: _subjectGrid(provider, projects),
              ),
            SliverToBoxAdapter(child: _browseHeader(notes.length, searching)),
            if (!searching)
              SliverToBoxAdapter(child: _foldersSection(provider)),
            // The empty state scrolls with the page itself (no nested scroll
            // view), so the whole screen moves and the copy is never clipped
            // behind the glass navigation bar.
            if (notes.isEmpty)
              SliverToBoxAdapter(
                child: _emptyState(provider.notes.isEmpty, searching),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 4, 16, 150),
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
                          final subject = _projectFor(
                              projects, note.subjectId);
                          return NoteCard(
                            note: note,
                            subjectColor: subject == null
                                ? null
                                : Color(subject.colorValue),
                            subjectName: subject?.title,
                            folder: _folderFor(
                                provider.folders, note.folderId),
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

  Widget _header(int subjectCount) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 20, 12, 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Expanded(
                child: Text(
                  'Subjects',
                  style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold),
                ),
              ),
              IconButton(
                tooltip: 'New subject',
                onPressed: _createSubject,
                icon: const Icon(Icons.add_circle_outline, size: 26),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _searchController,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              hintText: 'Search all notes',
              prefixIcon: const Icon(Icons.search),
              suffixIcon: _searchController.text.isEmpty
                  ? null
                  : IconButton(
                      tooltip: 'Clear search',
                      onPressed: () {
                        _searchController.clear();
                        setState(() {});
                      },
                      icon: const Icon(Icons.close),
                    ),
              filled: true,
              fillColor: context.fillSoft,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(16),
                borderSide: BorderSide.none,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _subjectGrid(TaskProvider provider, List<Project> projects) {
    if (projects.isEmpty) {
      return SliverToBoxAdapter(
        child: Container(
          margin: const EdgeInsets.only(top: 4),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 18),
          decoration: BoxDecoration(
            color: context.card,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: context.hairline),
          ),
          child: Row(
            children: [
              Icon(Icons.school_outlined, color: context.inkFaint),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Add your subjects — each one gets its own space for tasks and notes.',
                  style: TextStyle(
                      fontSize: 13, color: context.inkSoft, height: 1.4),
                ),
              ),
              TextButton(
                onPressed: _createSubject,
                style: TextButton.styleFrom(foregroundColor: context.ink),
                child: const Text('Add',
                    style: TextStyle(fontWeight: FontWeight.w600)),
              ),
            ],
          ),
        ),
      );
    }

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    return SliverLayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.crossAxisExtent >= 650 ? 2 : 1;
        return SliverGrid(
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisExtent: 92,
            crossAxisSpacing: 12,
            mainAxisSpacing: 12,
          ),
          delegate: SliverChildBuilderDelegate(
            (context, index) {
              final subject = projects[index];
              final tasks = provider.tasks
                  .where((t) => t.projectId == subject.id)
                  .where((t) => !t.isDone)
                  .toList();
              final next = tasks.isEmpty
                  ? null
                  : tasks.reduce((a, b) =>
                      a.date.isBefore(b.date) ? a : b);
              final overdue = tasks.where((t) => t.date.isBefore(today)).length;
              final noteCount = provider.notes
                  .where((note) => note.subjectId == subject.id)
                  .length;
              return _SubjectCard(
                subject: subject,
                taskCount: tasks.length,
                noteCount: noteCount,
                nextDue: next?.date,
                overdueCount: overdue,
              );
            },
            childCount: projects.length,
          ),
        );
      },
    );
  }

  Widget _browseHeader(int noteCount, bool searching) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 4),
      child: Row(
        children: [
          Text(
            searching ? 'RESULTS' : 'ALL NOTES',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              letterSpacing: 1.2,
              color: context.inkFaint,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            '$noteCount',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: context.inkFaint,
            ),
          ),
        ],
      ),
    );
  }

  Widget _foldersSection(TaskProvider provider) {
    // Folders from before subjects existed (no subjectId) stay visible here.
    final folders = provider.folders.toList()
      ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      child: SizedBox(
        height: 76,
        child: folders.isEmpty
            ? const SizedBox.shrink()
            : ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  ...folders.map(
                    (folder) => FolderCard(
                      name: folder.name,
                      count: provider.notes
                          .where((note) => note.folderId == folder.id)
                          .length,
                      selected: _selectedFolderId == folder.id,
                      onTap: () => setState(() {
                        _selectedFolderId =
                            _selectedFolderId == folder.id ? null : folder.id;
                      }),
                    ),
                  ),
                ],
              ),
      ),
    );
  }

  Widget _emptyState(bool noNotesAtAll, bool searching) {
    return Padding(
      // Extra bottom padding keeps the copy clear of the New note FAB.
      padding: const EdgeInsets.fromLTRB(32, 20, 32, 150),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            searching ? Icons.search_off : Icons.menu_book_outlined,
            size: 56,
            color: context.inkFaint,
          ),
          const SizedBox(height: 14),
          Text(
            noNotesAtAll
                ? 'Your study notes live here'
                : (searching ? 'No matching notes' : 'Nothing in this folder'),
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: 6),
          Text(
            noNotesAtAll
                ? 'Create one with the New note button — format it with Markdown and keep files with it.'
                : 'Try another folder or search.',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.inkSoft, height: 1.45),
          ),
        ],
      ),
    );
  }

  Project? _projectFor(List<Project> projects, String? id) {
    if (id == null) return null;
    for (final project in projects) {
      if (project.id == id) return project;
    }
    return null;
  }

  SubjectFolder? _folderFor(List<SubjectFolder> folders, String? id) {
    if (id == null) return null;
    for (final folder in folders) {
      if (folder.id == id) return folder;
    }
    return null;
  }
}

class _SubjectCard extends StatelessWidget {
  final Project subject;
  final int taskCount;
  final int noteCount;
  final DateTime? nextDue;
  final int overdueCount;

  const _SubjectCard({
    required this.subject,
    required this.taskCount,
    required this.noteCount,
    required this.nextDue,
    required this.overdueCount,
  });

  @override
  Widget build(BuildContext context) {
    final accent = Color(subject.colorValue);
    return Material(
      color: context.card,
      borderRadius: BorderRadius.circular(20),
      child: InkWell(
        onTap: () => Navigator.push(
          context,
          MaterialPageRoute(
            builder: (_) =>
                SubjectWorkspacePage(subjectId: subject.id),
          ),
        ),
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
            mainAxisAlignment: MainAxisAlignment.center,
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
                          fontSize: 16.5, fontWeight: FontWeight.w700),
                    ),
                  ),
                  Icon(Icons.chevron_right,
                      size: 18, color: context.inkFaint),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    [
                      '$taskCount task${taskCount == 1 ? '' : 's'}',
                      '$noteCount note${noteCount == 1 ? '' : 's'}',
                    ].join('  ·  '),
                    style: TextStyle(fontSize: 12, color: context.inkSoft),
                  ),
                  const Spacer(),
                  if (overdueCount > 0)
                    Text(
                      '$overdueCount overdue',
                      style: TextStyle(
                          fontSize: 11.5,
                          color: Colors.red[700],
                          fontWeight: FontWeight.w600),
                    )
                  else if (nextDue != null)
                    Text(
                      'Next ${DateFormat('MMM d').format(nextDue!)}',
                      style: TextStyle(
                          fontSize: 11.5,
                          color: context.inkSoft,
                          fontWeight: FontWeight.w600),
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
