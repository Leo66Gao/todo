import 'dart:ui';

import 'package:flutter/material.dart';

import 'glass_rim_painter.dart';
import 'liquid_glass.dart';

/// Liquid-glass buttons built from the exact same recipe as the navbar
/// lens (`glass_nav_bar.dart`): same frost, same refraction bend, same
/// dispersive rim with the corner fade and dew reflections — and like the
/// navbar, no drop shadow.
class GlassCircleButton extends StatelessWidget {
  final double size;
  final Widget child;
  final VoidCallback? onTap;
  final String? tooltip;

  const GlassCircleButton({
    super.key,
    this.size = 56,
    required this.child,
    required this.onTap,
    this.tooltip,
  });

  @override
  Widget build(BuildContext context) {
    final button = GestureDetector(
      onTap: onTap,
      child: GlassShape(
        borderRadius: size / 2,
        size: Size.square(size),
        child: Center(child: child),
      ),
    );
    if (tooltip == null) {
      return button;
    }
    return Tooltip(message: tooltip!, child: button);
  }
}

/// Extended pill variant (the "New Task" / "New note" style).
class GlassPillButton extends StatelessWidget {
  final VoidCallback? onTap;
  final IconData icon;
  final String label;

  const GlassPillButton({
    super.key,
    required this.onTap,
    required this.icon,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: GlassShape(
        borderRadius: 28,
        size: const Size.fromHeight(56),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 20),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: 24, color: Colors.black),
              const SizedBox(width: 10),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: Colors.black,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The exact glass of the navbar lens. On Impeller it is the same
/// fragment-shader droplet with the navbar's parameters — including the
/// dispersive rim, corner fade and dew reflections. On web / Skia — where
/// shaders can't run — the same geometric approximation: frost (blur
/// σ=2), a 1.25× vertical lens stretch around the button's own screen
/// centre (horizontal stays 1:1 so objects show at their true x), the
/// vertical sheen, and the painted rim / dew layers from
/// [GlassEdgePainter]. No shadow, no tint.
class GlassShape extends StatefulWidget {
  final Widget child;
  final double borderRadius;
  final Size size;

  /// Rim thickness in px — 2.4 for the navbar-scale glass, 1.2 for the
  /// small task-card chips.
  final double borderWidth;

  /// Dew glint intensity (0 disables); small chips use a fainter one.
  final double dew;

  const GlassShape({
    super.key,
    required this.child,
    required this.borderRadius,
    required this.size,
    this.borderWidth = 2.4,
    this.dew = 0.9,
  });

  @override
  State<GlassShape> createState() => _GlassShapeState();
}

class _GlassShapeState extends State<GlassShape> {
  static const _blurSigma = 2.0;

  @override
  Widget build(BuildContext context) {
    final radius = widget.borderRadius;

    // Native (Impeller): the same shader droplet as the navbar lens — the
    // rim/dew/corner effects are per-pixel in the shader, so no painted
    // layers are stacked on top.
    ImageFilter? shaderFilter;
    if (LiquidGlass.supported) {
      // Refraction is kept gentle on these small surfaces. A pill is ~56px
      // tall, so the navbar's 22px rim displacement would sample content from
      // nearly half a pill away and make the backdrop look shifted rather
      // than seen through glass; the rim, fresnel and dew highlights are
      // computed in the widget's own space, so they stay perfectly registered.
      final compact = widget.borderWidth < 2;
      shaderFilter = LiquidGlass.filter(
        radius: radius,
        edge: compact ? 8 : 12,
        refraction: compact ? 2 : 3,
        dispersion: compact ? 0.8 : 1.2,
        fresnel: 1.0,
        specular: 1.1,
        rimTint: 0.55,
        cornerDim: 0.85,
        dew: widget.dew,
      );
    }

    return ClipRRect(
      borderRadius: BorderRadius.circular(radius),
      child: BackdropFilter(
        filter: shaderFilter ?? _fallbackFilter(),
        child: Container(
          width: widget.size.width.isFinite ? widget.size.width : null,
          height: widget.size.height,
          foregroundDecoration: BoxDecoration(
            borderRadius: BorderRadius.circular(radius),
            // A faint neutral tint under the highlight lifts the glass off the
            // page so it reads as a material, not just a soft glow.
            color: Colors.black.withValues(alpha: 0.04),
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [
                Colors.white.withValues(alpha: 0.42),
                Colors.white.withValues(alpha: 0.16),
              ],
            ),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              widget.child,
              // web-only layers: dispersion rim ring + painted edge light
              if (shaderFilter == null) ...[
                Positioned.fill(
                  child: ClipPath(
                    clipper: RimRingClipper(radius: radius),
                    child: BackdropFilter(
                      filter: rimRingFilter(),
                      child: const SizedBox.expand(),
                    ),
                  ),
                ),
                Positioned.fill(
                  child: CustomPaint(
                      painter: GlassEdgePainter(
                          radius: radius,
                          strokeWidth: widget.borderWidth,
                          dew: widget.dew)),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  ImageFilter _fallbackFilter() {
    // An affine stretch cannot reproduce a curved lens and moves the entire
    // backdrop away from the content beneath it. Keep fallback glass aligned;
    // the rim filters still provide the refractive edge treatment.
    return ImageFilter.blur(sigmaX: _blurSigma, sigmaY: _blurSigma);
  }
}
