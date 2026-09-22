import 'package:flutter/material.dart';
import 'package:flutter_quill/flutter_quill.dart';

import '../theme/app_theme.dart';

/// Shared compact look for quill toolbar buttons across the app: a soft grey
/// rounded selection instead of quill's solid black circle. Group buttons
/// (headers, lists, …) resolve the theme from `buttonOptions.base`, direct
/// buttons from `iconTheme` — pass it to both.
///
/// [context] is optional so existing call sites keep working: with a context
/// the selected fill and icon colours follow the app theme, without one the
/// original light palette is kept.
QuillIconTheme quillToolbarIconTheme([BuildContext? context]) {
  return QuillIconTheme(
    iconButtonSelectedData: IconButtonData(
      iconSize: 17,
      color: context?.ink ?? Colors.black,
      style: IconButton.styleFrom(
        backgroundColor: context?.fillSoft ?? const Color(0xFFE7E7EE),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(9)),
      ),
    ),
    iconButtonUnselectedData: IconButtonData(
      iconSize: 17,
      color: context?.inkSoft ?? Colors.black54,
    ),
  );
}

/// Blue underlined links (quill's default inherits the theme's grey
/// secondary color, which reads as disabled).
const quillEditorCustomStyles = DefaultStyles(
  link: TextStyle(
    color: Colors.blue,
    decoration: TextDecoration.underline,
    decorationColor: Colors.blue,
  ),
);
