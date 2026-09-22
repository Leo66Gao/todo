import 'dart:ui' as ui;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Loads and builds the liquid-glass fragment-shader backdrop filter
/// (Impeller only). On platforms without shader filter support — web,
/// or Skia desktop — [supported] is false and callers fall back to the
/// classic blurred-glass layer.
class LiquidGlass {
  static ui.FragmentProgram? _program;
  static bool _loadAttempted = false;

  /// True once the compiled shader has loaded and the engine supports
  /// shader-based image filters.
  static bool get supported =>
      _program != null && ui.ImageFilter.isShaderFilterSupported;

  /// Kicks off the one-time shader load. Safe to call multiple times.
  static Future<void> ensureLoaded() async {
    if (_loadAttempted) return;
    _loadAttempted = true;
    try {
      if (kIsWeb) return; // FragmentProgram is unavailable on web
      if (!ui.ImageFilter.isShaderFilterSupported) return;
      _program =
          await ui.FragmentProgram.fromAsset('shaders/liquid_glass.frag');
    } catch (_) {
      _program = null;
    }
  }

  /// Builds the backdrop filter for a glass surface, or null when the
  /// platform can't run it (caller should use its fallback).
  ///
  /// [pointer] is in the filter region's local pixels; pass null when there
  /// is no active pointer so the reactive specular turns off.
  static ui.ImageFilter? filter({
    required double radius,
    double edge = 26,
    double refraction = 18,
    double dispersion = 9,
    double fresnel = 1.0,
    Color tint = Colors.white,
    double specular = 1.0,
    Offset? pointer,
    double rimTint = 0.0,
    double cornerDim = 0.0,
    double dew = 0.0,
  }) {
    final program = _program;
    if (program == null) return null;
    final shader = program.fragmentShader()
      ..setFloat(2, radius)
      ..setFloat(3, edge)
      ..setFloat(4, refraction)
      ..setFloat(5, dispersion)
      ..setFloat(6, fresnel)
      ..setFloat(7, tint.r)
      ..setFloat(8, tint.g)
      ..setFloat(9, tint.b)
      ..setFloat(10, specular)
      ..setFloat(11, pointer?.dx ?? -99999.0)
      ..setFloat(12, pointer?.dy ?? -99999.0)
      ..setFloat(13, rimTint)
      ..setFloat(14, cornerDim)
      ..setFloat(15, dew);
    return ui.ImageFilter.shader(shader);
  }
}
