import 'dart:ui';

import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// A premium frosted surface used across the wide-screen workspace.
///
/// This is the calm, structural counterpart to the refractive "liquid glass"
/// lenses used for buttons and the nav bar — those read as droplets; this
/// reads as a sheet of ground glass. It blurs whatever sits behind it and lays
/// a theme-following tint with a soft top sheen and a hairline edge, so panels
/// feel like real material floating over the page rather than flat grey boxes.
class FrostedPanel extends StatelessWidget {
  final Widget child;
  final double radius;
  final EdgeInsetsGeometry? padding;
  final double blur;

  /// Fill opacity in light mode (dark mode is derived, dimmer).
  final double opacity;

  const FrostedPanel({
    super.key,
    required this.child,
    this.radius = 24,
    this.padding,
    this.blur = 22,
    this.opacity = 0.66,
  });

  @override
  Widget build(BuildContext context) {
    final dark = Theme.of(context).brightness == Brightness.dark;
    final fill = dark
        ? context.card.withValues(alpha: 0.55)
        : Colors.white.withValues(alpha: opacity);

    // A soft neutral under-layer beneath the blur. Without it the frosted
    // glass sits flat against the page; a faint gray beneath makes the panel
    // read as a real sheet of glass floating over it, so it actually pops.
    final baseTint = dark
        ? context.ink.withValues(alpha: 0.04)
        : Colors.black.withValues(alpha: 0.035);

    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            color: fill,
            borderRadius: BorderRadius.circular(radius),
            border: Border.all(color: context.hairline, width: 1),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withValues(alpha: dark ? 0.18 : 0.06),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Color.alphaBlend(
                    Colors.white.withValues(alpha: dark ? 0.05 : 0.22),
                    baseTint),
                Color.alphaBlend(Colors.transparent, baseTint),
              ],
            ),
          ),
          child: child,
        ),
      ),
    );
  }
}
