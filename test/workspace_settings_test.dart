import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/models/workspace_settings.dart';

void main() {
  group('WorkspaceSettings field order', () {
    test('defaults to the canonical order', () {
      final settings = WorkspaceSettings();
      expect(settings.fieldOrder, WorkspaceSettings.defaultFieldOrder);
    });

    test('reordered order round-trips through JSON', () {
      final reordered = [
        'date',
        'time',
        'title-fake',
        'type',
        'priority',
        'subject',
        'notes',
        'duration',
        'difficulty',
        'labels',
      ];
      final settings = WorkspaceSettings.fromJson({
        'fieldOrder': reordered,
      });

      // Unknown ids are dropped, known ids keep the saved order.
      expect(settings.fieldOrder.first, 'date');
      expect(settings.fieldOrder.contains('title-fake'), isFalse);
      expect(settings.fieldOrder, containsAll(WorkspaceSettings.defaultFieldOrder));
      expect(
        settings.toJson()['fieldOrder'],
        settings.fieldOrder,
      );
    });

    test('missing fields from an old payload are appended, never dropped',
        () {
      final settings = WorkspaceSettings.fromJson({
        'fieldOrder': ['type', 'date'],
      });

      for (final id in WorkspaceSettings.defaultFieldOrder) {
        expect(settings.fieldOrder, contains(id), reason: '$id missing');
      }
      // Order stays stable across reloads.
      final reloaded = WorkspaceSettings.fromJson(settings.toJson());
      expect(reloaded.fieldOrder, settings.fieldOrder);
    });

    test('legacy payloads without fieldOrder fall back to defaults', () {
      final settings = WorkspaceSettings.fromJson({
        'showDifficulty': false,
      });
      expect(settings.fieldOrder, WorkspaceSettings.defaultFieldOrder);
      expect(settings.showDifficulty, isFalse);
    });
  });

  group('WorkspaceSettings theme mode', () {
    test('defaults to system', () {
      expect(WorkspaceSettings().themeMode, 'system');
    });

    test('round-trips through JSON', () {
      final dark = WorkspaceSettings(themeMode: 'dark');
      final reloaded = WorkspaceSettings.fromJson(dark.toJson());
      expect(reloaded.themeMode, 'dark');
    });

    test('unknown or missing values fall back to system', () {
      expect(WorkspaceSettings.fromJson({}).themeMode, 'system');
      expect(
          WorkspaceSettings.fromJson({'themeMode': 'midnight'}).themeMode,
          'system');
    });
  });
}
