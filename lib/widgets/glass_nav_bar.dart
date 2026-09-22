import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'glass_rim_painter.dart';
import 'liquid_glass.dart';

// Liquid-glass bottom bar — rebuilt from scratch.
//
// One single glass surface spans the whole bar (a rounded droplet, not a
// rectangle): on Impeller platforms it is a real GPU fragment shader
// (shaders/liquid_glass.frag) that refracts the backdrop with chromatic
// dispersion, Fresnel rim lighting and pointer-reactive speculars; on web /
// Skia it falls back to a clean frosted layer. The selection is a soft ink
// highlight that slides beneath the icons — no second filter, so it is
// always perfectly centered — and the icons render above the glass, crisp.
class GlassNavBar extends StatefulWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;

  const GlassNavBar({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
  });

  static const _items = [
    (Icons.check_circle_outline, 'Today'),
    (Icons.view_week_outlined, 'Week'),
    (Icons.calendar_month_outlined, 'Calendar'),
    (Icons.school_outlined, 'Assignments'),
    (Icons.auto_stories_outlined, 'Subjects'),
  ];

  @override
  State<GlassNavBar> createState() => _GlassNavBarState();
}

class _GlassNavBarState extends State<GlassNavBar> {
  static const _height = 64.0;
  static const _innerPadding = 6.0;

  // Pointer position in bar-local pixels; null when the pointer is away.
  Offset? _pointer;

  void _select(int index) {
    HapticFeedback.selectionClick();
    widget.onDestinationSelected(index);
  }

  @override
  Widget build(BuildContext context) {
    return MouseRegion(
      onHover: (event) => setState(() => _pointer = event.localPosition),
      onExit: (_) => setState(() => _pointer = null),
      child: LayoutBuilder(
        builder: (context, constraints) {
          final width = constraints.maxWidth;
          final itemWidth =
              (width - _innerPadding * 2) / GlassNavBar._items.length;

          return SizedBox(
            height: _height,
            child: Stack(
              children: [
                // ---- one glass droplet spans the whole bar ----
                Positioned.fill(
                  child: Builder(builder: (context) {
                    final mq = MediaQuery.of(context);
                    return _glassSurface(
                      center: Offset(
                        mq.size.width / 2,
                        mq.size.height - mq.viewPadding.bottom - 16 - 32,
                      ),
                    );
                  }),
                ),
                // ---- sliding selection highlight (no filter, always true
                //      to the layout, so it can never be off-center) ----
                AnimatedPositioned(
                  duration: const Duration(milliseconds: 320),
                  curve: Curves.easeOutCubic,
                  left: _innerPadding + widget.selectedIndex * itemWidth,
                  width: itemWidth,
                  top: 6,
                  bottom: 6,
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      DecoratedBox(
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.55),
                          borderRadius:
                              BorderRadius.circular(_height / 2 - 6),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.08),
                              blurRadius: 10,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                      ),
                      // the selection bubble carries the same edge light as
                      // the buttons: rim fade at BL/TR + dew glints
                      CustomPaint(
                        painter: GlassEdgePainter(
                            radius: _height / 2 - 6, dew: 0.8),
                      ),
                    ],
                  ),
                ),
                // ---- destinations float above the glass, always crisp.
                //      Same inner padding + slot math as the highlight pill,
                //      so every icon sits exactly at its pill's center ----
                Positioned.fill(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: _innerPadding),
                    child: Row(
                      children: List.generate(GlassNavBar._items.length, (i) {
                        final (icon, label) = GlassNavBar._items[i];
                        final selected = i == widget.selectedIndex;

                        return Expanded(
                          child: Semantics(
                            label: label,
                            button: true,
                            selected: selected,
                            child: GestureDetector(
                              behavior: HitTestBehavior.opaque,
                              onTap: () => _select(i),
                              child: Center(
                                child: AnimatedScale(
                                  duration:
                                      const Duration(milliseconds: 200),
                                  curve: Curves.easeOutCubic,
                                  scale: selected ? 1.0 : 0.94,
                                  child: Icon(
                                    icon,
                                    size: 22,
                                    color: selected
                                        ? Colors.black
                                        : Colors.black38,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        );
                      }),
                    ),
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  /// The refractive glass sheet. Shader path on Impeller (per-pixel SDF
  /// refraction + dispersion); on web / Skia — where fragment shaders don't
  /// exist — the same droplet bending is approximated geometrically: a
  /// vertical lens stretch that compresses content toward the top/bottom
  /// rims, so scrolling content visibly bends as it passes the glass.
  Widget _glassSurface({required Offset center}) {
    if (LiquidGlass.supported) {
      final filter = LiquidGlass.filter(
        radius: 32,
        edge: 28,
        refraction: 22,
        dispersion: 11,
        fresnel: 1.0,
        specular: 1.1,
        pointer: _pointer,
        rimTint: 0.55,
        cornerDim: 0.85,
        dew: 0.9,
      );
      if (filter != null) {
        return BackdropFilter(filter: filter, child: const SizedBox.expand());
      }
    }

    // ---- fallback (web / Skia): clean frosted glass + geometric
    // refraction. An affine matrix can't do per-pixel curvature, so the
    // lens bends vertically only (1.25× around the bar's centre): content
    // compresses toward the rims as it scrolls past. The horizontal axis
    // stays 1:1 — any horizontal scale shears the whole backdrop sideways,
    // which reads as the glass showing objects left/right of where they
    // really are (the shader path bends at the rims without this shift).
    final lens = Matrix4.identity()
      ..translateByDouble(center.dx, center.dy, 0, 1)
      ..scaleByDouble(1.0, 1.25, 1, 1)
      ..translateByDouble(-center.dx, -center.dy, 0, 1);
    return ClipRRect(
      borderRadius: BorderRadius.circular(32),
      child: BackdropFilter(
        filter: ImageFilter.compose(
          outer: ImageFilter.blur(sigmaX: 2, sigmaY: 2),
          inner: ImageFilter.matrix(lens.storage,
              filterQuality: FilterQuality.medium),
        ),
        child: Container(
          foregroundDecoration: BoxDecoration(
            borderRadius: BorderRadius.circular(32),
            // Neutral under-tint beneath the highlight, so the bar reads as a
            // sheet of glass against the page instead of a flat white wash.
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
            children: [
              const SizedBox.expand(),
              // dispersion edge light: a thin ring where the backdrop is
              // bent harder, so the rim picks up the colour under it
              Positioned.fill(
                child: ClipPath(
                  clipper: const RimRingClipper(radius: 32),
                  child: BackdropFilter(
                    filter: rimRingFilter(),
                    child: const SizedBox.expand(),
                  ),
                ),
              ),
              // rim fading out at the BL/TR corners + dew corner glints
              Positioned.fill(
                child: CustomPaint(painter: const GlassEdgePainter(radius: 32)),
              ),
              // specular highlight along the top edge, fading out before
              // the dimmed top-right corner
              Positioned(
                top: 0,
                left: 28,
                right: 28,
                height: 1,
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      stops: const [0.0, 0.3, 0.72],
                      colors: [
                        Colors.white.withValues(alpha: 0.0),
                        Colors.white.withValues(alpha: 0.9),
                        Colors.white.withValues(alpha: 0.0),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Vertical companion of [GlassNavBar] for wide screens (Mac/tablet): the
/// same glass material as a left rail with icon + label per destination.
class GlassSideRail extends StatelessWidget {
  final int selectedIndex;
  final ValueChanged<int> onDestinationSelected;

  const GlassSideRail({
    super.key,
    required this.selectedIndex,
    required this.onDestinationSelected,
  });

  static const List<(IconData, String)> _items = [
    (Icons.check_circle_outline, 'Today'),
    (Icons.view_week_outlined, 'Week'),
    (Icons.calendar_month_outlined, 'Calendar'),
    (Icons.school_outlined, 'Assignments'),
    (Icons.auto_stories_outlined, 'Subjects'),
  ];

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 88,
      margin: const EdgeInsets.fromLTRB(12, 12, 0, 12),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(28),
        border: Border.all(
          color: Colors.white.withValues(alpha: 0.6),
          width: 1.2,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.07),
            blurRadius: 16,
            offset: const Offset(0, 6),
          ),
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.10),
            blurRadius: 40,
            offset: const Offset(0, 18),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(28),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 2, sigmaY: 2),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(28),
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  Colors.white.withValues(alpha: 0.34),
                  Colors.white.withValues(alpha: 0.12),
                ],
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: List.generate(_items.length, (i) {
                final (icon, label) = _items[i];
                final selected = i == selectedIndex;
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 5),
                  child: Semantics(
                    label: label,
                    button: true,
                    selected: selected,
                    child: GestureDetector(
                      behavior: HitTestBehavior.opaque,
                      onTap: () {
                        HapticFeedback.selectionClick();
                        onDestinationSelected(i);
                      },
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 240),
                        curve: Curves.easeOutCubic,
                        width: 68,
                        padding: const EdgeInsets.symmetric(vertical: 9),
                        decoration: BoxDecoration(
                          color: selected
                              ? Colors.white.withValues(alpha: 0.55)
                              : Colors.transparent,
                          borderRadius: BorderRadius.circular(18),
                          border: Border.all(
                            color: selected
                                ? Colors.white.withValues(alpha: 0.9)
                                : Colors.transparent,
                            width: 1.2,
                          ),
                        ),
                        child: Column(
                          children: [
                            Icon(
                              icon,
                              size: 21,
                              color:
                                  selected ? Colors.black : Colors.black45,
                            ),
                            const SizedBox(height: 4),
                            AnimatedDefaultTextStyle(
                              duration: const Duration(milliseconds: 150),
                              style: TextStyle(
                                fontSize: 9.5,
                                fontWeight: FontWeight.w600,
                                color: selected
                                    ? Colors.black
                                    : Colors.black45,
                              ),
                              child: Text(label, maxLines: 1),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }
}
