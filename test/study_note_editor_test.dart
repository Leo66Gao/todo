import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:todo_app/models/project.dart';
import 'package:todo_app/models/study_note.dart';
import 'package:todo_app/screens/note_view_page.dart';
import 'package:todo_app/screens/study_note_editor_page.dart';
import 'package:todo_app/state/task_provider.dart';
import 'package:todo_app/utils/note_content.dart';
import 'package:todo_app/utils/record_size.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  Future<TaskProvider> pumpEditor(
    WidgetTester tester, {
    StudyNote? note,
    String? initialSubjectId,
  }) async {
    final provider = TaskProvider();
    provider.addProject(Project(
      id: 'p-phys',
      title: 'Physics HL',
      colorValue: 0xFF66BB6A,
    ));
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: provider)],
        child: MaterialApp(
          localizationsDelegates: const [FlutterQuillLocalizations.delegate],
          home: StudyNoteEditorPage(
              note: note, initialSubjectId: initialSubjectId),
        ),
      ),
    );
    await tester.pumpAndSettle();
    return provider;
  }

  test('documentFromContent loads legacy markdown as plain text', () {
    final doc = documentFromContent('# Plan\n- find **sources**');
    final text = doc.toPlainText();
    expect(text, contains('Plan'));
    expect(text, contains('find **sources**'));
  });

  test('delta content round-trips through the helpers', () {
    final doc = Document()..insert(0, 'hello world');
    final stored = documentToContent(doc);
    expect(isQuillDelta(stored), isTrue);
    expect(notePlainText(stored), 'hello world');
  });

  test('notePlainText strips legacy markdown', () {
    expect(
        notePlainText('# Plan\n- find **sources**'), contains('find sources'));
    expect(notePlainText('co-op deadline'), contains('co-op deadline'));
  });

  test('saved note size includes generated links and metadata', () {
    final document = Document.fromJson([
      {'insert': '${List.filled(8000, 'https://example.com').join(' ')}\n'},
    ]);
    expect(recordFitsCloud({'content': documentToContent(document)}), isTrue);

    final note = StudyNote(
      id: 'large-note',
      title: 'References',
      content: documentToContent(documentWithAutoLinks(document)),
    );
    expect(recordFitsCloud(note.toJson()), isFalse);
  });

  test('legacy note links reject executable URI schemes', () {
    expect(safeNoteLink('https://example.com')?.host, 'example.com');
    expect(safeNoteLink('mailto:student@example.com')?.scheme, 'mailto');
    expect(safeNoteLink('javascript:alert(1)'), isNull);
    expect(safeNoteLink('data:text/html,hello'), isNull);
    expect(safeNoteLink('//example.com'), isNull);
  });

  testWidgets('saving a new note stores a delta document with subject',
      (tester) async {
    final provider = await pumpEditor(tester, initialSubjectId: 'p-phys');

    await tester.enterText(find.byType(TextField).first, 'SHM basics');
    await tester.tap(find.text('Save'));
    await tester.pumpAndSettle();

    expect(provider.notes.length, 1);
    final note = provider.notes.single;
    expect(note.title, 'SHM basics');
    expect(note.subjectId, 'p-phys');
    expect(isQuillDelta(note.content), isTrue);
    expect(note.updatedAt.isAfter(note.createdAt), isTrue);
  });

  testWidgets('editing a legacy markdown note keeps its text', (tester) async {
    final provider = await pumpEditor(tester);
    provider.addNote(StudyNote(
      id: 'legacy-1',
      title: 'Old style note',
      content: '# Heading\nSome body text',
    ));
    final legacy = provider.notes.single;

    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: provider)],
        child: MaterialApp(
          localizationsDelegates: const [FlutterQuillLocalizations.delegate],
          home: StudyNoteEditorPage(note: legacy),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(QuillEditor), findsOneWidget);
    expect(
      documentFromContent(legacy.content).toPlainText(),
      contains('Some body text'),
    );
  });

  testWidgets('view page renders legacy markdown without the editor',
      (tester) async {
    final provider = TaskProvider();
    provider.addNote(StudyNote(
      id: 'legacy-view',
      title: 'Readable note',
      content: '## Section\nBody text here',
    ));
    await tester.pumpWidget(
      MultiProvider(
        providers: [ChangeNotifierProvider.value(value: provider)],
        child: MaterialApp(
          localizationsDelegates: const [FlutterQuillLocalizations.delegate],
          home: const NoteViewPage(noteId: 'legacy-view'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Readable note'), findsOneWidget);
    expect(find.byType(QuillEditor), findsNothing);
  });
}
