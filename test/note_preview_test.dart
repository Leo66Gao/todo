import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/widgets/note_card.dart';

void main() {
  group('plainNotePreview', () {
    test('strips headings, lists and emphasis but keeps wording', () {
      final md = '# Plan\n- find **sources** for criteria\n- _review_ notes';
      final preview = plainNotePreview(md);
      expect(preview, contains('find sources for criteria'));
      expect(preview, contains('review notes'));
      expect(preview.contains('#'), isFalse);
      expect(preview.contains('**'), isFalse);
    });

    test('keeps hyphens and underscores inside normal words', () {
      expect(plainNotePreview('co-op deadline and snake_case names'),
          'co-op deadline and snake_case names');
    });

    test('keeps link labels and drops image markup', () {
      final preview =
          plainNotePreview('![diagram](https://x/y.png) read [the syllabus](https://school.example)');
      expect(preview, contains('read the syllabus'));
      expect(preview.contains('diagram'), isFalse);
      expect(preview.contains('https'), isFalse);
    });

    test('handles empty content', () {
      expect(plainNotePreview(''), isEmpty);
    });
  });
}
