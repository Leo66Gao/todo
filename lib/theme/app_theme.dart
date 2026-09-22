import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

ThemeData buildAppTheme() {
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    colorScheme: ColorScheme.fromSeed(
      seedColor: Colors.black,
      primary: Colors.black,
      secondary: Colors.grey[800],
      surface: Colors.white,
    ).copyWith(
      surfaceContainerHighest: const Color(0xFFF2F2F4),
      // Borders stay essentially invisible in light mode (the pre-dark-mode
      // look) — M3's default outline is a mid-grey that reads as dark lines.
      outlineVariant: const Color(0xFFEFEFF2),
    ),
    textTheme: GoogleFonts.poppinsTextTheme().apply(
      bodyColor: Colors.black87,
      displayColor: Colors.black,
    ),
    scaffoldBackgroundColor: Color(0xFFF5F5F7),
    dividerTheme: const DividerThemeData(
      color: Color(0xFFE4E4E9),
      thickness: 0.6,
      space: 1,
    ),
    // The black seed otherwise yields warm pink-tinted surfaces on dialogs —
    // keep dialogs, menus and pickers crisp white like the rest of the app.
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: GoogleFonts.poppins(
        color: Colors.black,
        fontSize: 20,
        fontWeight: FontWeight.w600,
      ),
      contentTextStyle: GoogleFonts.poppins(
        color: Colors.black87,
        fontSize: 14,
        height: 1.45,
      ),
    ),
    dropdownMenuTheme: DropdownMenuThemeData(
      menuStyle: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(Colors.white),
        surfaceTintColor: WidgetStatePropertyAll(Colors.transparent),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        ),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: Colors.white,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.grey.shade100),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: Color(0xFFF5F5F7),
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: GoogleFonts.poppins(
        color: Colors.black,
        fontSize: 22,
        fontWeight: FontWeight.bold,
      ),
      iconTheme: IconThemeData(color: Colors.black),
    ),
  );
}

ThemeData buildAppDarkTheme() {
  const bg = Color(0xFF0E0F13);
  const card = Color(0xFF17181D);
  const ink = Color(0xFFF2F2F5);
  final scheme = ColorScheme.fromSeed(
    seedColor: Colors.black,
    brightness: Brightness.dark,
  ).copyWith(
    primary: Colors.white,
    onPrimary: Colors.black,
    secondary: const Color(0xFFC9C9D1),
    surface: card,
    onSurface: ink,
    surfaceContainerHighest: const Color(0xFF23252C),
    outlineVariant: Colors.white.withValues(alpha: 0.14),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: scheme,
    textTheme: GoogleFonts.poppinsTextTheme(ThemeData(brightness: Brightness.dark).textTheme)
        .apply(
      bodyColor: ink,
      displayColor: Colors.white,
    ),
    scaffoldBackgroundColor: bg,
    dividerTheme: DividerThemeData(
      color: Colors.white.withValues(alpha: 0.10),
      thickness: 0.6,
      space: 1,
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: const Color(0xFF1E2026),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
      titleTextStyle: GoogleFonts.poppins(
        color: Colors.white,
        fontSize: 20,
        fontWeight: FontWeight.w600,
      ),
      contentTextStyle: GoogleFonts.poppins(
        color: ink,
        fontSize: 14,
        height: 1.45,
      ),
    ),
    dropdownMenuTheme: DropdownMenuThemeData(
      menuStyle: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(const Color(0xFF1E2026)),
        surfaceTintColor: WidgetStatePropertyAll(Colors.transparent),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        ),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: Colors.white.withValues(alpha: 0.08)),
      ),
    ),
    appBarTheme: AppBarTheme(
      backgroundColor: bg,
      elevation: 0,
      scrolledUnderElevation: 0,
      titleTextStyle: GoogleFonts.poppins(
        color: Colors.white,
        fontSize: 22,
        fontWeight: FontWeight.bold,
      ),
      iconTheme: IconThemeData(color: Colors.white),
    ),
  );
}

/// Theme-following colour shorthands for the app's hand-built surfaces.
/// Light mode resolves to the original palette (white cards, black ink);
/// dark mode to the charcoal palette, so screens can be written once.
extension AppColors on BuildContext {
  /// Page background.
  Color get bg => Theme.of(this).scaffoldBackgroundColor;

  /// Card / sheet fill.
  Color get card => Theme.of(this).cardColor;

  /// Primary text and icon colour (black in light, near-white in dark).
  Color get ink => Theme.of(this).colorScheme.onSurface;

  /// Secondary text.
  Color get inkSoft => ink.withValues(alpha: 0.55);

  /// Tertiary / placeholder text.
  Color get inkFaint => ink.withValues(alpha: 0.35);

  /// Text or icon that sits on an [ink]-coloured fill (the emphasised black
  /// chips in light mode, white chips in dark mode).
  Color get inkInverse => Theme.of(this).colorScheme.surface;

  /// Soft fill for inputs, neutral chips and hover surfaces.
  Color get fillSoft => Theme.of(this).colorScheme.surfaceContainerHighest;

  /// Hairline borders and dividers. Reads outlineVariant (pinned per theme)
  /// rather than dividerColor, which M3 derives from the much darker
  /// `outline` tone.
  Color get hairline => Theme.of(this).colorScheme.outlineVariant;
}
