import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// App-styled dropdown: rounded pill field (no Material label notch) and a
/// matching rounded menu that follows the active theme.
class PillDropdown<T> extends StatelessWidget {
  final IconData? icon;
  final String hint;
  final T? value;
  final List<DropdownMenuItem<T>> items;
  final ValueChanged<T?>? onChanged;

  const PillDropdown({
    super.key,
    required this.hint,
    required this.items,
    required this.onChanged,
    this.value,
    this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return DropdownButtonFormField<T>(
      initialValue: value,
      items: items,
      onChanged: onChanged,
      isExpanded: true,
      dropdownColor: context.card,
      elevation: 8,
      borderRadius: BorderRadius.circular(18),
      menuMaxHeight: 360,
      icon: Icon(Icons.keyboard_arrow_down_rounded,
          size: 22, color: context.inkFaint),
      style: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: context.ink,
      ),
      decoration: InputDecoration(
        hintText: hint,
        hintStyle: TextStyle(color: context.inkFaint),
        prefixIcon: icon == null
            ? null
            : Icon(icon, size: 19, color: context.inkSoft),
        filled: true,
        fillColor: context.fillSoft,
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide.none,
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(18),
          borderSide: BorderSide(
              color: context.ink.withValues(alpha: 0.12), width: 1.2),
        ),
      ),
    );
  }
}
