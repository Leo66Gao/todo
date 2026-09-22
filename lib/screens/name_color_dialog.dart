import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Shared palette for subjects, labels and folders.
const List<Color> kItemPalette = <Color>[
  Color(0xFFEF5350),
  Color(0xFFFF8A65),
  Color(0xFFFFB74D),
  Color(0xFFFFD54F),
  Color(0xFF66BB6A),
  Color(0xFF26A69A),
  Color(0xFF42A5F5),
  Color(0xFF5C6BC0),
  Color(0xFFAB47BC),
  Color(0xFF8D6E63),
];

/// Asks for a name and a color. Returns (name, color), or null when cancelled.
Future<(String, Color)?> showNameAndColorDialog(
  BuildContext context, {
  required String title,
  required String hintText,
  required String initialName,
  required Color initialColor,
  String confirmLabel = 'Save',
}) {
  final controller = TextEditingController(text: initialName);
  var color = initialColor;

  return showDialog<(String, Color)>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        backgroundColor: context.card,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(22)),
        title: Text(title),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: controller,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(
                hintText: hintText,
                filled: true,
                fillColor: context.fillSoft,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                  borderSide: BorderSide.none,
                ),
              ),
            ),
            const SizedBox(height: 18),
            Text('COLOR',
                style: TextStyle(
                    fontSize: 11,
                    letterSpacing: 1,
                    fontWeight: FontWeight.w700,
                    color: context.inkSoft)),
            const SizedBox(height: 10),
            Wrap(
              spacing: 10,
              runSpacing: 10,
              children: kItemPalette.map((option) {
                final selected = option.toARGB32() == color.toARGB32();
                return InkWell(
                  onTap: () => setState(() => color = option),
                  customBorder: const CircleBorder(),
                  child: Container(
                    width: 30,
                    height: 30,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: option,
                      border: selected
                          ? Border.all(color: context.ink, width: 2.5)
                          : null,
                    ),
                    child: selected
                        ? const Icon(Icons.check, size: 17, color: Colors.white)
                        : null,
                  ),
                );
              }).toList(),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final name = controller.text.trim();
              if (name.isNotEmpty) Navigator.pop(context, (name, color));
            },
            style: FilledButton.styleFrom(backgroundColor: context.ink),
            child: Text(confirmLabel),
          ),
        ],
      ),
    ),
  ).whenComplete(controller.dispose);
}
