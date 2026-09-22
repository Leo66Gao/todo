import 'package:flutter/material.dart';

Color darken(Color color, [double amount = 0.3]) {
  final hsl = HSLColor.fromColor(color);
  return hsl
      .withLightness((hsl.lightness - amount).clamp(0.0, 1.0))
      .toColor();
}

/// Soft tinted pill for a user-defined label: colored dot + name.
class LabelChip extends StatelessWidget {
  final String name;
  final Color color;

  const LabelChip({super.key, required this.name, required this.color});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2.5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.13),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 6,
            height: 6,
            decoration: BoxDecoration(color: color, shape: BoxShape.circle),
          ),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 10.5,
                fontWeight: FontWeight.w600,
                color: darken(color, 0.25),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Subject tag: colored dot + subject name, in the card's meta row.
class SubjectTag extends StatelessWidget {
  final String name;
  final Color color;

  const SubjectTag({super.key, required this.name, required this.color});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 4),
        Flexible(
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: Colors.grey[700],
            ),
          ),
        ),
      ],
    );
  }
}

/// Quiet priority marker — only shown for high/critical so it stays meaningful.
/// Difficulty answers "how hard is this?", priority answers "does this wait?".
class PriorityFlag extends StatelessWidget {
  final bool critical;

  const PriorityFlag({super.key, required this.critical});

  @override
  Widget build(BuildContext context) {
    final color = critical ? Colors.red.shade600 : Colors.orange.shade700;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(Icons.flag_rounded, size: 13, color: color),
        const SizedBox(width: 3),
        Text(
          critical ? 'Urgent' : 'High',
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ],
    );
  }
}
