import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/models/task.dart';

void main() {
  test('a chosen Level 1 survives a save and reload', () {
    final task = Task(
      id: 't1',
      title: 'Read',
      date: DateTime(2026, 9, 26),
      difficulty: 1,
      difficultySelected: true,
    );
    final json = task.toJson();
    expect(json['difficultySelected'], isTrue);
    final back = Task.fromJson(jsonDecode(jsonEncode(json)));
    expect(back.hasDifficulty, isTrue);
    expect(back.difficulty, 1);
  });

  test('records without the flag are unchanged', () {
    final task = Task(id: 't2', title: 'Gym', date: DateTime(2026, 9, 26));
    expect(task.toJson().containsKey('difficultySelected'), isFalse);
    expect(task.hasDifficulty, isFalse);
    expect(Task(id: 't3', title: 'x', date: DateTime(2026), difficulty: 3).hasDifficulty, isTrue);
  });
}
