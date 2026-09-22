#version 320 es
#include <flutter/runtime_effect.glsl>

// Real liquid-glass backdrop filter.
//
// The engine binds:
//   u_size    (vec2)  – size of the backdrop texture (first uniform, engine-set)
//   u_texture (sampler) – the rendered content behind the glass
//
// The shader refracts the backdrop through a rounded-droplet SDF surface:
//   * lens distortion driven by the SDF gradient, strong near the rim
//   * chromatic dispersion: R/G/B sampled at different offsets, strongest
//     where curvature is highest — never a fixed rainbow outline
//   * Fresnel reflectance (Schlick) brightening grazing angles
//   * specular highlights from two static lights plus one reactive light
//     that follows the pointer
//   * an internal thickness rim and a faint body blur
//   * high transparency in the centre: the backdrop passes through almost
//     untouched, so tinting adapts to whatever is behind the glass.

uniform vec2 u_size;
uniform sampler2D u_texture;

uniform float u_radius;     // corner radius of the droplet (px)
uniform float u_edge;       // width of the curved bevel band (px)
uniform float u_refraction; // refraction offset at the rim (px)
uniform float u_dispersion; // per-channel dispersion at the rim (px)
uniform float u_fresnel;    // fresnel multiplier
uniform float u_tint_r;     // glass tint 0..1
uniform float u_tint_g;
uniform float u_tint_b;
uniform float u_specular;   // specular intensity multiplier
uniform vec2 u_pointer;     // pointer position in local px (huge + off when idle)
uniform float u_rim_tint;   // 0..1 — how much the edge light takes the under-colour
uniform float u_corner_dim; // 0..1 — edge-light fade at bottom-left / top-right
uniform float u_dew;        // 0..1 — dew-style internal corner reflections

out vec4 frag_color;

float sdRoundedRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 local = FlutterFragCoord().xy;
  vec2 hs = u_size * 0.5;
  vec2 p = local - hs;

  float d = sdRoundedRect(p, hs, u_radius);
  if (d > 0.0) {
    // outside the droplet: leave the backdrop untouched
    frag_color = vec4(0.0);
    return;
  }

  // Surface normal from the SDF gradient (|grad| ~= 1 for an SDF).
  float e = 1.0;
  float ddx = sdRoundedRect(p + vec2(e, 0.0), hs, u_radius) -
              sdRoundedRect(p - vec2(e, 0.0), hs, u_radius);
  float ddy = sdRoundedRect(p + vec2(0.0, e), hs, u_radius) -
              sdRoundedRect(p - vec2(0.0, e), hs, u_radius);
  vec2 grad = vec2(ddx, ddy) / (2.0 * e);

  // Light enters from the top-left and bottom-right, so the edge light
  // fades out around the bottom-left and top-right corners (the SDF normal
  // points exactly at the corner diagonal there; straight edges stay lit).
  const vec2 dirTR = vec2(0.70710678, -0.70710678);
  const vec2 dirBL = vec2(-0.70710678, 0.70710678);
  float cornerDim = clamp(u_corner_dim *
      (smoothstep(0.72, 0.97, dot(grad, dirTR)) +
       smoothstep(0.72, 0.97, dot(grad, dirBL))), 0.0, 1.0);
  float edgeFade = 1.0 - cornerDim;

  // Thickness profile: flat centre, curving down toward the rim like a
  // water droplet sitting on glass.
  float inside = -d;
  float t = clamp(1.0 - inside / u_edge, 0.0, 1.0);
  float curve = t * t * (3.0 - 2.0 * t);

  // 3D normal of the droplet surface.
  vec3 n = normalize(vec3(grad * curve * 1.9, mix(1.0, 0.55, curve)));

  // Refraction: a convex droplet is a MAGNIFIER — sample toward the centre
  // so content spreads outward. (Sampling outward would be a minifier and
  // would pull objects into view before they reach the glass.)
  vec2 off = -grad * u_refraction * curve;

  // Chromatic dispersion: each channel takes its own refracted path.
  // Proportional to curvature, so the centre stays perfectly clear.
  float disp = u_dispersion * curve;
  vec2 offR = -grad * (u_refraction + disp) * curve;
  vec2 offG = off;
  vec2 offB = -grad * (u_refraction - disp) * curve;

  vec2 uvMax = u_size - vec2(0.5);

  // Apply the offset in the same coordinate system on both axes. The old
  // code inverted only the Y offset on Vulkan/Metal, so the refracted image
  // under small pills was visibly displaced from the content beneath it.
  vec2 uvR = clamp((local + offR) / u_size, vec2(0.0), vec2(1.0));
  vec2 uvG = clamp((local + offG) / u_size, vec2(0.0), vec2(1.0));
  vec2 uvB = clamp((local + offB) / u_size, vec2(0.0), vec2(1.0));

  vec3 refracted;
  refracted.r = texture(u_texture, uvR).r;
  refracted.g = texture(u_texture, uvG).g;
  refracted.b = texture(u_texture, uvB).b;

  // Faint body blur: a cheap 4-tap average blended in, stronger near edges.
  vec2 o = vec2(1.6);
  vec3 blurAcc = refracted;
  blurAcc += texture(u_texture, clamp(uvG + o / u_size, vec2(0.0), vec2(1.0))).rgb;
  blurAcc += texture(u_texture, clamp(uvG - o / u_size, vec2(0.0), vec2(1.0))).rgb;
  blurAcc += texture(u_texture, clamp(uvG + vec2(o.y, o.x) / u_size, vec2(0.0), vec2(1.0))).rgb;
  blurAcc += texture(u_texture, clamp(uvG - vec2(o.y, o.x) / u_size, vec2(0.0), vec2(1.0))).rgb;
  blurAcc *= 0.2;
  vec3 body = mix(refracted, blurAcc, 0.22 + 0.2 * curve);

  // Adaptive tint: multiplies what the glass actually gathered from behind,
  // so the colour always comes from the live backdrop.
  vec3 tint = vec3(u_tint_r, u_tint_g, u_tint_b);
  vec3 col = mix(body, body * tint, 0.35);

  // Fresnel reflectance (Schlick) with per-channel weighting: red bends
  // least and blue most, so the rim carries a faint rainbow split instead
  // of flat white light.
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float fresBase = pow(clamp(1.0 - n.z, 0.0, 1.0), 5.0);
  vec3 fresnel = vec3(
    0.04 + 0.96 * pow(clamp(1.0 - n.z * 0.94, 0.0, 1.0), 5.0),
    0.04 + 0.96 * fresBase,
    0.04 + 0.96 * pow(clamp(1.0 - n.z * 1.06, 0.0, 1.0), 5.0)
  );
  fresnel = clamp(fresnel * u_fresnel, 0.0, 1.0);

  // Edge light with dispersion: instead of flat white, the Fresnel rim
  // picks up the colour of the content sitting under that part of the edge
  // (over-saturated so the hue survives the frost).
  float rimLum = max(max(body.r, body.g), body.b);
  vec3 underCol = clamp((body - vec3(rimLum * 0.2)) * 1.5, 0.0, 1.0);
  vec3 rimLight = mix(vec3(1.0), underCol, u_rim_tint);
  col += fresnel * 0.30 * rimLight * edgeFade;

  // Specular highlights from two fixed studio lights.
  vec3 l1 = normalize(vec3(-0.35, -0.85, 0.4));
  vec3 l2 = normalize(vec3(0.65, 0.5, 0.3));
  float s1 = pow(max(dot(normalize(reflect(-l1, n)), viewDir), 0.0), 64.0);
  float s2 = pow(max(dot(normalize(reflect(-l2, n)), viewDir), 0.0), 26.0);
  col += vec3(1.0) * s1 * 0.6 * u_specular;
  col += vec3(1.0) * s2 * 0.22 * u_specular;

  // Reactive specular: a light that tracks the pointer/interaction point so
  // the highlight slides across the glass as the finger/cursor moves.
  vec2 toP = u_pointer - local;
  float pd = max(length(toP), 1.0);
  float hasP = step(0.0, u_pointer.x);
  vec3 lP = normalize(vec3(-toP / pd, 0.9));
  float sP = pow(max(dot(normalize(reflect(-lP, n)), viewDir), 0.0), 22.0);
  col += vec3(1.0) * sP * 0.5 * u_specular * hasP *
         exp(-pd * pd / (u_size.x * u_size.x * 0.35));

  // Internal thickness rim: a soft spectral band just inside the edge.
  float rim = smoothstep(u_edge * 0.12, u_edge * 0.55, inside) *
              smoothstep(u_edge * 1.45, u_edge * 0.75, inside);
  col += vec3(rim * 1.05, rim * 0.92, rim * 0.8) * 0.10 * u_fresnel * edgeFade;

  // Thin-film style iridescent caustics along the rim — the angle of the
  // surface normal picks the hue, depth picks the intensity, so the rainbow
  // is visible even over a plain white background and shifts as content
  // (and the pointer) moves.
  float angle = atan(grad.y, grad.x);
  vec3 irid = 0.5 + 0.5 * cos(6.28318 *
      (vec3(0.0, 0.33, 0.67) + angle / 6.28318 + inside * 0.012));
  float caustic = rim * rim;
  col += irid * caustic * 0.12 * u_fresnel * edgeFade;

  // Dew-style internal reflections: soft glints hugging the inside of the
  // dimmed corners, like light bouncing around inside a water droplet.
  const vec2 uBL = vec2(-0.70710678, 0.70710678);
  const vec2 uTR = vec2(0.70710678, -0.70710678);
  float isCap = step(hs.x, u_radius + 0.5);
  vec2 dewBL = mix(vec2(-hs.x + u_radius, hs.y - u_radius) + uBL * u_radius * 0.62,
                   uBL * u_radius * 0.58, isCap);
  vec2 dewTR = mix(vec2(hs.x - u_radius, -hs.y + u_radius) + uTR * u_radius * 0.62,
                   uTR * u_radius * 0.58, isCap);
  vec2 tang = vec2(0.70710678, 0.70710678); // local edge tangent at both spots
  vec2 dBL = p - dewBL;
  float lBL = length(vec2(dot(dBL, tang) / (u_radius * 0.95),
                          dot(dBL, uBL) / (u_radius * 0.42)));
  vec2 dTR = p - dewTR;
  float lTR = length(vec2(dot(dTR, tang) / (u_radius * 0.95),
                          dot(dTR, uTR) / (u_radius * 0.42)));
  float dewIn = smoothstep(0.0, u_edge * 0.9, inside); // keep it off the rim
  // soft depth halo so the glint also reads over light backgrounds
  float halo = (exp(-lBL * lBL * 0.3) + exp(-lTR * lTR * 0.3)) * dewIn;
  col = mix(col, col * 0.78, clamp(halo * 0.55 * u_dew, 0.0, 1.0));
  float dew = (exp(-lBL * lBL) + exp(-lTR * lTR)) * dewIn;
  col += vec3(0.90, 0.95, 1.0) * dew * 0.60 * u_dew;

  // Top inner sheen: light catching the upper bevel.
  float topBand = smoothstep(hs.y - u_edge * 1.6, hs.y - u_edge * 0.3, p.y) *
                  (1.0 - curve * 0.6);
  col += vec3(1.0) * topBand * 0.10 * u_fresnel * edgeFade;

  // Slight darkening where the glass is thickest, for physical weight.
  col *= mix(1.0, 0.93, curve);

  float alpha = smoothstep(0.5, -0.5, d);
  frag_color = vec4(col, alpha);
}
