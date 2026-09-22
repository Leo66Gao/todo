import 'package:flutter_test/flutter_test.dart';
import 'package:todo_app/utils/task_formatters.dart';

void main() {
  test('completed tasks are never overdue', () {
    final yesterday = DateTime.now().subtract(const Duration(days: 1));

    expect(isTaskOverdue(yesterday), isTrue);
    expect(isTaskOverdue(yesterday, isDone: true), isFalse);
    expect(formatDueLabel(yesterday, isDone: true), 'Completed');
  });
}
