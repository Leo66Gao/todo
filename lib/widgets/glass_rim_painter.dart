import 'dart:math' as math;
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

/// Edge treatment shared by the glass navbar and the glass buttons on
/// web / Skia (where the fragment shader can't run):
///
///  * [GlassEdgePainter] — an angular rim whose light comes from the
///    top-left and bottom-right and fades out around the bottom-left and
///    top-right corners, plus "dew" internal reflections: soft glints
///    hugging the inside of those dimmed corners (the Dew style from
///    liquid.jerrylinn.com).
///  * [rimDispersionFilter] + [RimRingClipper] — a thin backdrop-filtered
///    ring that over-saturates whatever sits behind the edge, so the rim
///    light takes on the colour under it instead of staying white.
///
/// The Impeller shader path (shaders/liquid_glass.frag) renders the same
/// three effects per-pixel on native.
class GlassEdgePainter extends CustomPainter {
  final double radius;

  /// Peak brightness of the lit (top-left / bottom-right) rim.
  final double rimAlpha;

  /// How far the rim fades around the bottom-left / top-right corners.
  final double cornerDim;

  /// Dew glint intensity, 0 disables.
  final double dew;

  /// Rim thickness in px (the navbar/buttons use 2.4; small chips 1.2).
  final double strokeWidth;

  const GlassEdgePainter({
    required this.radius,
    this.rimAlpha = 0.85,
    this.cornerDim = 0.95,
    this.dew = 0.9,
    this.strokeWidth = 2.4,
  });

  @override
  void paint(Canvas canvas, Size size) {
    // inset the stroke by half its width so it isn't clipped by the
    // enclosing ClipRRect — the rim reads as a solid band
    final stroke = strokeWidth;
    final inset = stroke / 2;
    final rrect = RRect.fromRectAndRadius(
        Rect.fromLTWH(inset, inset, size.width - inset * 2,
            size.height - inset * 2),
        Radius.circular(math.max(0.0, radius - inset)));

    // ---- angular rim: bright at TL (225°) and BR (45°), faded at
    //      BL (135°) and TR (315°) — one smooth double-lobe falloff ----
    const lo = 0.0;
    const segments = 24;
    final colors = <Color>[];
    final stops = <double>[];
    for (var i = 0; i <= segments; i++) {
      final t = i / segments;
      final angle = t * 2 * math.pi;
      final w = (math.cos(2 * (angle - math.pi / 4)) + 1) / 2;
      // sharpen the fade toward the dimmed corners a little
      final shaped = w * w * (3 - 2 * w) * cornerDim + w * (1 - cornerDim);
      colors.add(Colors.white.withValues(alpha: lo + (rimAlpha - lo) * shaped));
      stops.add(t);
    }
    final sweep = SweepGradient(colors: colors, stops: stops);
    canvas.drawRRect(
      rrect,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..shader = sweep.createShader(Offset.zero & size),
    );

    if (dew > 0) {
      _dewSpot(canvas,
          center: Offset(radius * 0.9, size.height - radius * 0.38),
          rotation: 0.20);
      _dewSpot(canvas,
          center: Offset(size.width - radius * 0.9, radius * 0.38),
          rotation: -0.20);
    }
  }

  // A dew glint: a whisper of dark depth-halo first (so it reads over the
  // light glass too), then the bright internal reflection hugging the
  // corner. Kept faint — heavy halos read as smudges on light glass.
  void _dewSpot(Canvas canvas, {required Offset center, required double rotation}) {
    _blob(canvas, center, rotation, 2.4, radius * 0.42, [
      Colors.blueGrey.withValues(alpha: 0.09 * dew),
      Colors.blueGrey.withValues(alpha: 0.0),
    ]);
    _blob(canvas, center, rotation, 2.2, radius * 0.30, [
      Colors.white.withValues(alpha: 0.55 * dew),
      Colors.white.withValues(alpha: 0.20 * dew),
      Colors.white.withValues(alpha: 0.0),
    ]);
  }

  void _blob(Canvas canvas, Offset center, double rotation, double stretch,
      double coreRadius, List<Color> colors) {
    canvas.save();
    canvas.translate(center.dx, center.dy);
    canvas.rotate(rotation);
    canvas.scale(stretch, 1.0);
    final stops =
        colors.length == 2 ? const [0.0, 1.0] : const [0.0, 0.55, 1.0];
    canvas.drawCircle(
      Offset.zero,
      coreRadius,
      Paint()
        ..shader = ui.Gradient.radial(Offset.zero, coreRadius, colors, stops),
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(GlassEdgePainter old) =>
      old.radius != radius ||
      old.rimAlpha != rimAlpha ||
      old.cornerDim != cornerDim ||
      old.dew != dew ||
      old.strokeWidth != strokeWidth;
}

/// Even-odd ring path that confines the dispersion backdrop filter to the
/// rim band of a rounded-rect glass surface.
class RimRingClipper extends CustomClipper<Path> {
  final double radius;
  final double inset;

  const RimRingClipper({required this.radius, this.inset = 3.5});

  @override
  Path getClip(Size size) {
    final innerR = math.max(0.0, radius - inset);
    return Path()
      ..fillType = PathFillType.evenOdd
      ..addRRect(RRect.fromRectAndRadius(
          Offset.zero & size, Radius.circular(radius)))
      ..addRRect(RRect.fromRectAndRadius(
          Offset(inset, inset) &
              Size(size.width - inset * 2, size.height - inset * 2),
          Radius.circular(innerR)));
  }

  @override
  bool shouldReclip(RimRingClipper old) =>
      old.radius != radius || old.inset != inset;
}

/// Web stand-in for the shader's dispersive edge light: inside the thin rim
/// ring the backdrop is frosted a little harder, so the colours sitting
/// under that part of the edge bleed gently into the rim light instead of
/// the rim staying a flat painted line. (A stronger lens pull here turned
/// out to smear nearby glyphs into the rim, so this stays blur-only.)
ui.ImageFilter rimRingFilter() {
  return ui.ImageFilter.blur(sigmaX: 3.0, sigmaY: 3.0);
}
