import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('IconButton.filled honours passed backgroundColor', (tester) async {
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: Center(
          child: IconButton.filled(
            onPressed: () {},
            icon: const Text('N'),
            style: IconButton.styleFrom(
              backgroundColor: const Color(0xFFE7E7EE),
              foregroundColor: Colors.black,
              shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(9)),
            ),
          ),
        ),
      ),
    ));
    await tester.pumpAndSettle();

    final material = tester.widgetList<Material>(
      find.descendant(
        of: find.byType(IconButton),
        matching: find.byType(Material),
      ),
    );
    final colors = material.map((m) => m.color).toList();
    // ignore: avoid_print
    print('MATERIAL COLORS: $colors');
    expect(
      colors.contains(const Color(0xFFE7E7EE)),
      isTrue,
      reason: 'the passed style background should win over the filled default',
    );
  });
}
