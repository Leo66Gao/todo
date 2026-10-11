// GLSL for the Liquid Glass renderer (WebGL2 / GLSL ES 3.00).

export const FULLSCREEN_VS = /* glsl */ `#version 300 es
void main() {
  // One oversized triangle covers the viewport.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * snoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
vec3 hex(float r, float g, float b) { return vec3(r, g, b) / 255.0; }
`;

/**
 * Backgrounds. Each preset pairs broad colour fields with crisp structure —
 * lines, rims, contours — because refraction only shows where the backdrop has
 * edges to bend. Coordinates: st is centred, in units of the window's short
 * side; A is the half-extent of the window in those units, so shapes are
 * placed relative to the window and every aspect ratio is covered.
 */
export const BACKGROUND_FS = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform int uPreset;
uniform float uDark;
uniform sampler2D uImage;
uniform vec2 uImageSize;
// Cross-fade from the previous background (1 = only the new one).
uniform sampler2D uPrev;
uniform float uFade;
out vec4 frag;
${COMMON}

float aaStep(float edge, float x) { float w = fwidth(x); return smoothstep(edge - w, edge + w, x); }
float glow(vec2 st, vec2 c, float r) { vec2 d = st - c; return exp(-dot(d, d) / (r * r)); }

// --- Harbour: sunlit shallow water; the caustic web bends under glass ---------
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Distance to the nearest cell border of a Voronoi pattern (0 on the web).
float cellEdge(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float F1 = 8.0, F2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 r = g + hash22(n + g) * 0.9 + 0.05 - f;
    float d = dot(r, r);
    if (d < F1) { F2 = F1; F1 = d; } else if (d < F2) { F2 = d; }
  }
  return sqrt(F2) - sqrt(F1);
}
float caustic(vec2 p) {
  vec2 w = p + 0.35 * vec2(snoise(p * 0.7), snoise(p * 0.7 + 19.3));
  float a = pow(1.0 - smoothstep(0.0, 0.16, cellEdge(w)), 3.0);
  float b = pow(1.0 - smoothstep(0.0, 0.2, cellEdge(w * 1.9 + 7.1)), 3.0);
  return clamp(a * 0.8 + b * 0.45, 0.0, 1.0);
}
vec3 harbour(vec2 st, vec2 A) {
  float y = st.y / A.y;
  float c = caustic(st * 6.5 + vec2(3.1, 1.7));
  float depth = fbm(st * 1.1 + 2.0) * 0.5 + 0.5;
  vec3 col;
  if (uDark < 0.5) {
    col = mix(hex(24., 124., 146.), hex(86., 190., 196.), smoothstep(-1.2, 0.9, y));
    col = mix(col, hex(18., 96., 122.), smoothstep(0.45, 0.8, depth) * 0.6);
    col = mix(col, hex(176., 226., 206.), smoothstep(0.3, 0.05, depth) * 0.5);
    col = mix(col, hex(255., 226., 176.), glow(st, vec2(A.x * 0.62, A.y * 0.85), 0.45) * 0.7);
    col += vec3(0.82, 1.0, 0.97) * c * mix(0.5, 0.22, smoothstep(0.3, 0.8, depth));
  } else {
    col = mix(hex(3., 16., 24.), hex(10., 44., 58.), smoothstep(-1.1, 1.0, y));
    col = mix(col, hex(2., 10., 16.), smoothstep(0.45, 0.85, depth) * 0.7);
    col += hex(60., 190., 200.) * c * 0.22 * (1.0 - smoothstep(0.4, 0.9, depth));
    // Harbour lights reflected as broken columns on the water.
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float x = A.x * (-0.6 + 0.62 * fi);
      float spread = 0.03 + 0.05 * smoothstep(A.y * 0.55, -A.y, st.y);
      float colMask = exp(-pow((st.x - x) / spread, 2.0)) * smoothstep(A.y * 0.62, A.y * 0.3, st.y) * smoothstep(-A.y * 1.1, -A.y * 0.2, st.y);
      float ripple = smoothstep(0.3, 0.9, snoise(vec2(st.x * 9.0 + fi * 3.0, st.y * 26.0)) * 0.5 + 0.5);
      col += mix(hex(255., 170., 90.), hex(255., 220., 170.), fi * 0.5) * colMask * (0.14 + ripple * 0.32);
      col += hex(255., 180., 110.) * glow(st, vec2(x, A.y * 0.62), 0.05) * 0.8;
    }
  }
  return col;
}

// --- Contour: a topographic survey ------------------------------------------
float terrain(vec2 p) {
  float s = 0.0, a = 0.55;
  for (int i = 0; i < 3; i++) { s += a * snoise(p); p = p * 2.1 + 5.3; a *= 0.42; }
  return s * 0.5 + 0.5;
}
vec3 contour(vec2 st, vec2 A) {
  float h = terrain(st * 1.05 + vec2(4.2, 1.3));
  float v = h / 0.045;
  float fv = abs(fract(v) - 0.5);
  float w = fwidth(v);
  float line = smoothstep(0.5 - w * 1.3, 0.5 - w * 0.15, fv);
  float major = step(3.5, mod(floor(v + 0.5), 4.0));
  vec3 col;
  if (uDark < 0.5) {
    col = mix(hex(128., 176., 150.), hex(196., 214., 170.), smoothstep(0.2, 0.45, h));
    col = mix(col, hex(232., 214., 164.), smoothstep(0.45, 0.65, h));
    col = mix(col, hex(214., 160., 110.), smoothstep(0.65, 0.85, h));
    col = mix(col, hex(250., 246., 238.), smoothstep(0.84, 0.97, h));
    col = mix(col, hex(52., 72., 58.), line * (0.3 + 0.35 * major));
  } else {
    col = mix(hex(6., 22., 20.), hex(18., 46., 34.), smoothstep(0.2, 0.55, h));
    col = mix(col, hex(40., 60., 34.), smoothstep(0.55, 0.85, h));
    col = mix(col, hex(160., 236., 120.), line * (0.3 + 0.45 * major));
  }
  return col;
}

// --- Ember (dark) / Afterglow (light): warm light and bokeh -----------------
vec3 ember(vec2 st, vec2 A) {
  bool dark = uDark > 0.5;
  vec3 col = dark ? hex(14., 11., 10.) : mix(hex(246., 196., 186.), hex(253., 236., 222.), st.y / A.y * 0.5 + 0.5);
  if (dark) {
    col += hex(255., 128., 34.) * glow(st, vec2(-A.x * 0.45, -A.y * 0.35), 0.5) * 0.75;
    col += hex(214., 48., 36.) * glow(st, vec2(A.x * 0.5, A.y * 0.25), 0.42) * 0.6;
    col += hex(255., 200., 96.) * glow(st, vec2(A.x * 0.05, A.y * 0.7), 0.2) * 0.45;
  } else {
    col = mix(col, hex(255., 214., 150.), glow(st, vec2(A.x * 0.45, A.y * 0.55), 0.45) * 0.8);
    col = mix(col, hex(236., 150., 150.), glow(st, vec2(-A.x * 0.6, -A.y * 0.5), 0.55) * 0.5);
  }
  for (int i = 0; i < 26; i++) {
    float fi = float(i);
    vec2 c = (vec2(hash12(vec2(fi, 1.7)), hash12(vec2(fi, 9.2))) * 2.0 - 1.0) * A * 1.05;
    float r = mix(0.018, 0.075, pow(hash12(vec2(fi, 4.4)), 2.0));
    float l = length(st - c);
    float aa = fwidth(l);
    float disc = 1.0 - smoothstep(r - aa, r + aa, l);
    float rim = disc * smoothstep(r * 0.72, r, l);
    vec3 tint = dark ? mix(hex(255., 170., 80.), hex(255., 96., 64.), hash12(vec2(fi, 3.3))) : vec3(1.0);
    col += tint * (disc * 0.07 + rim * 0.14) * (dark ? 1.0 : 1.4);
  }
  return col;
}

// --- Studio: quiet grey, a grid and a sphere -------------------------------
vec3 studio(vec2 st, vec2 A) {
  bool dark = uDark > 0.5;
  vec3 col = dark ? hex(22., 22., 24.) : hex(226., 227., 230.);
  col = mix(col, dark ? hex(40., 40., 44.) : hex(248., 248., 249.), glow(st, vec2(-A.x * 0.2, A.y * 0.9), 0.9));
  vec2 g = abs(fract(st * 14.0) - 0.5) / 14.0;
  float grid = 1.0 - aaStep(0.0007, min(g.x, g.y));
  col = mix(col, dark ? vec3(1.0) : vec3(0.0), grid * (dark ? 0.07 : 0.07));
  vec2 c = vec2(A.x * 0.48, -A.y * 0.3);
  float r = 0.36;
  float l = length(st - c);
  float aa = fwidth(l);
  float disc = 1.0 - smoothstep(r - aa, r + aa, l);
  vec2 n2 = (st - c) / r;
  float lit = clamp(dot(normalize(vec3(n2, sqrt(max(1.0 - dot(n2, n2), 0.0)))), normalize(vec3(-0.5, 0.6, 0.6))), 0.0, 1.0);
  vec3 sphere = dark ? mix(hex(30., 30., 34.), hex(92., 92., 100.), lit) : mix(hex(186., 188., 194.), hex(252., 252., 253.), lit);
  col *= 1.0 - glow(st, c + vec2(0.05, -0.06), r * 1.1) * (dark ? 0.35 : 0.14) * (1.0 - disc);
  col = mix(col, sphere, disc);
  vec2 c2 = vec2(-A.x * 0.62, -A.y * 0.55);
  col = mix(col, dark ? hex(58., 58., 64.) : hex(28., 28., 30.), 1.0 - aaStep(0.09, length(st - c2)));
  return col;
}

vec3 image(vec2 frag) {
  float s = max(uRes.x / uImageSize.x, uRes.y / uImageSize.y);
  vec2 size = uImageSize * s;
  vec2 uv = (frag - (uRes - size) * 0.5) / size;
  vec3 col = texture(uImage, vec2(uv.x, 1.0 - uv.y)).rgb;
  // Dark mode dims photographs and cools their highlights a touch.
  if (uDark > 0.5) col = mix(vec3(dot(col, vec3(0.299, 0.587, 0.114))), col, 0.9) * 0.62;
  return col;
}

void main() {
  vec2 frag2 = gl_FragCoord.xy;
  float m = min(uRes.x, uRes.y);
  vec2 st = (frag2 - 0.5 * uRes) / m;
  vec2 A = 0.5 * uRes / m;
  vec3 col;
  if (uPreset == 0) col = harbour(st, A);
  else if (uPreset == 1) col = contour(st, A);
  else if (uPreset == 2) col = ember(st, A);
  else if (uPreset == 3) col = studio(st, A);
  else col = image(frag2);
  col += (hash12(frag2) - 0.5) / 255.0;
  col = mix(texture(uPrev, frag2 / uRes).rgb, clamp(col, 0.0, 1.0), uFade);
  frag = vec4(col, 1.0);
}`;

/** Separable Gaussian (9 taps folded into 5 bilinear fetches). */
export const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
uniform vec2 uDst;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / uDst;
  vec3 c = texture(uSrc, uv).rgb * 0.2270270270;
  c += (texture(uSrc, uv + uStep * 1.3846153846).rgb + texture(uSrc, uv - uStep * 1.3846153846).rgb) * 0.3162162162;
  c += (texture(uSrc, uv + uStep * 3.2307692308).rgb + texture(uSrc, uv - uStep * 3.2307692308).rgb) * 0.0702702703;
  frag = vec4(c, 1.0);
}`;

export const BLIT_FS = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDst;
out vec4 frag;
void main() { frag = vec4(texture(uSrc, gl_FragCoord.xy / uDst).rgb, 1.0); }`;


/**
 * The glass. For every pixel under a shape: the surface height comes from a
 * convex squircle bevel around the rounded rectangle; its normal refracts the
 * view ray (IOR 1.5) through the glass thickness, and the three colour
 * channels are refracted slightly differently (dispersion). The frost covers
 * the whole surface, rim included, so the bending shows as a smooth warp of
 * what's behind. Light adds a faint Fresnel reflection, a thin edge light
 * along the top and bottom that fades towards the corners, and — on the
 * backdrop — a soft shadow. The shape count is fixed per device from its
 * uniform budget.
 */
export const glassFragment = (MAX_SHAPES: number) => /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uSoft;
uniform sampler2D uMid;
uniform sampler2D uHeavy;
uniform vec2 uRes;
uniform int uCount;
uniform vec4 uRect[${MAX_SHAPES}];  // centre xy, half size xy (px, GL space)
uniform vec4 uShape[${MAX_SHAPES}]; // radius, bezel, height, shadow blur
uniform vec4 uTint[${MAX_SHAPES}];  // frost (haze) colour, amount
uniform vec4 uOptic[${MAX_SHAPES}]; // blur, dispersion, highlights, shadow strength
uniform vec4 uState[${MAX_SHAPES}]; // hover, press, opacity, recessed
uniform vec4 uClip[${MAX_SHAPES}];  // x0, y0, x1, y1
uniform float uClipR[${MAX_SHAPES}]; // the clip's corner radius
uniform vec4 uExtra[${MAX_SHAPES}];  // legibility (+1 light, -1 dark, 0 free), light direction xy, frost
uniform vec2 uLight;                // towards the light, GL space
uniform vec3 uPointer;              // xy, influence
uniform float uDark;
uniform float uAsh;                 // light text in light mode: ash-grey frost
uniform float uDpr;
out vec4 frag;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}
vec2 gradRoundBox(vec2 p, vec2 b, float r) {
  vec2 w = abs(p) - (b - r);
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  float g = max(w.x, w.y);
  vec2 q = max(w, 0.0);
  float l = length(q);
  return s * ((g > 0.0 && l > 1e-4) ? q / l : ((w.x > w.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0)));
}
// How much of the top/bottom edge light (x) and the side darkening (y) a point
// near the outline gets. Each is strongest along the middle of its edges and
// eases off towards the corners, and round each corner the light fades
// straight into the darkness (they meet halfway round, at nothing).
vec2 edgeWeights(vec2 q, vec2 b, float r) {
  vec2 g = gradRoundBox(q, b, r);
  float w = g.y * g.y - g.x * g.x;
  vec2 fade = r * 1.3 + 0.12 * b;
  float alongX = smoothstep(0.0, 1.0, (b.x - abs(q.x) - r * 0.15) / fade.x);
  float alongY = smoothstep(0.0, 1.0, (b.y - abs(q.y) - r * 0.15) / fade.y);
  return vec2(smoothstep(0.0, 1.0, w) * mix(0.4, 1.0, alongX * alongX), smoothstep(0.0, 1.0, -w) * mix(0.4, 1.0, alongY * alongY));
}
vec3 fetch3(sampler2D t, vec2 a, vec2 b, vec2 c) {
  return vec3(texture(t, a).r, texture(t, b).g, texture(t, c).b);
}
float grainAt(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Smooth value noise: the soft mottling of ice crystals under the grain.
float noiseAt(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(grainAt(i), grainAt(i + vec2(1.0, 0.0)), f.x),
             mix(grainAt(i + vec2(0.0, 1.0)), grainAt(i + vec2(1.0, 1.0)), f.x), f.y);
}
// A ring of taps around a pre-blurred level widens its blur. (Only by less
// than that level's own blur: wider, the taps show as ghosted copies.)
vec3 ring(sampler2D t, vec2 a, vec2 b, vec2 c, float r) {
  vec3 acc = fetch3(t, a, b, c) * 0.2;
  vec2 k = vec2(r) / uRes;
  for (int j = 0; j < 8; j++) {
    float ang = float(j) * 0.7853982 + 0.3927;
    vec2 o = vec2(cos(ang), sin(ang)) * k * ((j & 1) == 0 ? 1.0 : 0.62);
    acc += fetch3(t, a + o, b + o, c + o) * 0.1;
  }
  return acc;
}
// Blur of any radius (device px) from the sharp image and its three
// pre-blurred levels (~6, ~16 and ~40 CSS px). Between two levels it blends
// them by blur variance, which is smooth at every strength and cheap (rings
// of taps over the finer level, used before, ghosted into a hatched pattern
// at some strengths). Past the heaviest level a small ring widens it.
vec3 blurAt(float R, vec2 a, vec2 b, vec2 c) {
  float s1 = 6.0 * uDpr;
  float s2 = 16.0 * uDpr;
  float s3 = 40.0 * uDpr;
  if (R <= s1) return mix(fetch3(uSrc, a, b, c), fetch3(uSoft, a, b, c), R / s1);
  if (R <= s2) return mix(fetch3(uSoft, a, b, c), fetch3(uMid, a, b, c), (R * R - s1 * s1) / (s2 * s2 - s1 * s1));
  if (R <= s3) return mix(fetch3(uMid, a, b, c), fetch3(uHeavy, a, b, c), (R * R - s2 * s2) / (s3 * s3 - s2 * s2));
  return ring(uHeavy, a, b, c, min(sqrt(R * R - s3 * s3) * 0.8, 0.5 * s3));
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec3 col = texture(uSrc, p / uRes).rgb;

  // Shadows and caustics on the backdrop.
  float shade = 0.0;
  float caustic = 0.0;
  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= uCount) break;
    vec4 R = uRect[i];
    vec4 S = uShape[i];
    float blur = S.w;
    vec2 q = p - R.xy + vec2(0.0, blur * 0.3);
    // (A cheap box test first: most shapes are far from most pixels.)
    vec2 far = abs(q) - R.zw;
    if (max(far.x, far.y) > blur * 3.3 + 2.0 * uDpr) continue;
    float d = sdRoundBox(q, R.zw, S.x);
    if (d > blur * 3.0) continue;
    vec4 C0 = uClip[i];
    float inClip = clamp(min(min(p.x - C0.x, C0.z - p.x), min(p.y - C0.y, C0.w - p.y)) + 0.5, 0.0, 1.0);
    // A shape on a panel keeps its shadow off the panel's rounded rim: it
    // fades out over the last 10 px inside the panel (following its corners).
    vec2 cc = 0.5 * (C0.xy + C0.zw);
    vec2 ch = 0.5 * (C0.zw - C0.xy);
    inClip *= smoothstep(0.0, 10.0 * uDpr, -sdRoundBox(p - cc, ch, min(uClipR[i], min(ch.x, ch.y))));
    float k = uOptic[i].w * uState[i].z * inClip;
    shade = max(shade, k * exp(-max(d, 0.0) / (blur * 0.55)) * smoothstep(-blur, blur * 0.2, d + blur * 0.2));
    float d0 = sdRoundBox(p - R.xy, R.zw, S.x);
    // A 1 px darkening just outside the sides, against the edge light on
    // the top and bottom (outside, so the sides don't look pinched in).
    // (Not round a recessed well: it has an even rim instead.)
    if (d0 > -1.0 && d0 < 2.0 * uDpr && uState[i].w < 0.5) {
      float sideLine = 1.0 - smoothstep(0.15 * uDpr, 1.15 * uDpr, d0);
      float side = edgeWeights(p - R.xy, R.zw, S.x).y;
      col *= 1.0 - sideLine * side * 0.11 * min(uOptic[i].z, 1.0) * uState[i].z * inClip * (uDark > 0.5 ? 1.25 : 1.0);
    }
    if (d0 > 0.0) {
      vec2 g = gradRoundBox(p - R.xy, R.zw, S.x);
      caustic += uState[i].z * inClip * exp(-d0 / (blur * 0.22)) * max(dot(g, -uLight), 0.0);
    }
  }
  col *= 1.0 - shade;
  col += caustic * (uDark > 0.5 ? 0.01 : 0.02);

  for (int i = 0; i < ${MAX_SHAPES}; i++) {
    if (i >= uCount) break;
    vec4 R = uRect[i];
    vec4 S = uShape[i];
    vec2 q = p - R.xy;
    if (abs(q.x) > R.z + 1.0 || abs(q.y) > R.w + 1.0) continue;
    vec4 C = uClip[i];
    // Clipped to the box it sits in, corners included.
    vec2 cc = 0.5 * (C.xy + C.zw);
    vec2 ch = 0.5 * (C.zw - C.xy);
    float clip = clamp(0.5 - sdRoundBox(p - cc, ch, min(uClipR[i], min(ch.x, ch.y))), 0.0, 1.0);
    float d = sdRoundBox(q, R.zw, S.x);
    float cover = clamp(0.5 - d, 0.0, 1.0) * clip * uState[i].z;
    if (cover <= 0.0) continue;

    vec4 T = uTint[i];
    vec4 O = uOptic[i];
    vec4 st = uState[i];
    // The bevel can be wider than the corner is round: its height follows a
    // rounder outline, so the corners curve smoothly instead of mitring.
    float fieldR = min(max(S.x, S.y), min(R.z, R.w));
    vec2 g = gradRoundBox(q, R.zw, fieldR);
    // Depth is measured from the real outline at the rim (so the bevel's
    // corners follow the box's own), easing into the rounder field inside.
    float depthOut = max(-d, 0.0);
    float depth = mix(depthOut, max(-sdRoundBox(q, R.zw, fieldR), 0.0), smoothstep(0.0, S.y, depthOut));
    float t = clamp(depth / S.y, 0.0, 1.0);
    float u = 1.0 - t;
    // A superellipse profile. Wide bevels (the big panels) are rounder, so the
    // bending spreads across the edge instead of crowding into the last pixels.
    float nE = S.y > 28.0 * uDpr ? 2.6 : 4.0;
    float un = pow(u, nE);
    float prof = pow(1.0 - un, 1.0 / nE);
    float slopeRaw = pow(u, nE - 1.0) * pow(max(1.0 - un, 1e-4), 1.0 / nE - 1.0);
    // Saturate softly: a hard cap leaves a visible seam along the rim.
    float slope = slopeRaw / (1.0 + slopeRaw / 7.0);
    float recess = st.w > 0.5 ? -0.6 : 1.0;
    vec3 n = normalize(vec3(g * slope * recess, 1.0));

    // The key light's direction (eased per shape on the CPU, leaning towards
    // the pointer), for the recessed well's shading.
    vec2 L2 = normalize(uExtra[i].yz + vec2(1e-4));

    // Refraction through the glass.
    vec3 r = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / 1.5);
    float thick = S.z * (0.2 + 0.8 * prof) * (1.0 + st.y * 0.45);
    vec2 off = r.xy / max(-r.z, 0.25) * thick;
    // Never let the offset grow faster than the surface moves: past that the
    // image folds over itself and the rim breaks into streaks.
    float offLen = length(off);
    // (At most about 4x compression at the rim: a clear lens, short of folding.)
    float fold = 0.76 * S.y * u + 0.5 * uDpr;
    if (offLen > fold) off *= fold / offLen;
    // The big panels are thick glass with a rounded edge, as on macOS: the
    // edge draws in a wide strip of what lies beyond it (up to 1.35 bevel
    // widths out), squeezed hardest at the very rim like the side of a glass
    // block. Pulling from outside never folds the image, however strong.
    bool lens = nE < 3.0;
    float squeeze = 1.0;
    if (lens) {
      // (A soft start: the bending eases in from nothing across the bevel,
      // so there's no line where it begins.)
      float reach = 1.35 * S.y * (1.0 + st.y * 0.25);
      off = g * reach * pow(u, 2.8);
      squeeze = 1.0 + 1.35 * 2.8 * pow(u, 1.8);
    }
    float disp = O.y * (lens ? 0.7 : 1.45) * mix(0.55, 1.0, clamp(O.x * 2.0, 0.0, 1.0)) * (1.0 + 0.6 * clamp(abs(g.x * g.y) * 4.0, 0.0, 1.0));
    vec2 uvG = (p + off) / uRes;
    vec2 uvR = (p + off * (1.0 - disp)) / uRes;
    vec2 uvB = (p + off * (1.0 + disp)) / uRes;
    // Frost: a smooth, milky blur (like frosted acrylic) over the whole
    // surface, rim included.
    float fr = uExtra[i].w;
    // Blur: a true radius that grows smoothly with the setting, the same
    // across the whole surface, rim included. Only where the lens squeezes
    // the image hard and the blur is light does it get a floor, so fine detail
    // can't alias into thin stripes.
    float full = (pow(O.x, 1.4) * 44.0 + fr * 30.0) * uDpr;
    float radius = min(max(full, 2.0 * squeeze * uDpr * step(1.05, squeeze)), 64.0 * uDpr);
    vec3 base = blurAt(radius, uvR, uvG, uvB);

    // Vibrancy.
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    base = clamp(mix(vec3(lum), base, 1.22) * (uDark > 0.5 ? 1.0 : 1.03), 0.0, 1.0);
    // Frost: ice scatters light every way, so the glass turns milky.
    // What is behind melts into a soft glow, colour drains, and a haze lifts
    // the whole surface: white in light mode, smoky in dark mode, and ash
    // grey under light text in light mode (as macOS does), so white text
    // reads without the glass going dark.
    if (fr > 0.0) {
      base = mix(base, ring(uHeavy, uvR, uvG, uvB, 20.0 * uDpr), 0.9 * fr);
      float bl0 = dot(base, vec3(0.299, 0.587, 0.114));
      base = mix(base, vec3(bl0), (uAsh > 0.5 ? 0.35 : 0.25) * fr);
      vec3 ice = uAsh > 0.5 ? vec3(0.43, 0.43, 0.445) : uDark > 0.5 ? vec3(0.16, 0.16, 0.18) : vec3(1.0);
      base = mix(base, ice, fr * (uAsh > 0.5 ? 0.6 : uDark > 0.5 ? 0.35 : 0.55));
    }
    // A tint (solid surfaces, the search well, primary actions).
    base = mix(base, T.rgb, T.a * (1.0 - st.y * 0.25));
    // Fresnel: grazing angles near the rim reflect the blurred surroundings
    // (faintly, with no haze of its own, so the rim doesn't fog over).
    float fres = pow(1.0 - n.z, 2.2) * (0.55 + 0.45 * u);
    vec3 env = texture(uHeavy, (p + g * S.y * 2.5) / uRes).rgb;
    env = mix(vec3(dot(env, vec3(0.333))), env, 1.4);
    base = mix(base, env, clamp(fres * 0.25, 0.0, 0.15));

    float facing = dot(g, L2);
    if (recess < 0.0) base *= 1.0 - 0.12 * smoothstep(1.0, 0.0, t) * max(facing, 0.0);

    // Legibility: keep the middle of the glass within a luminance band, so
    // text on it stays readable over any background. The sign says which way
    // (+ light, - dark); the size how firmly (it follows the frost setting).
    float legible = uExtra[i].x;
    if (legible != 0.0) {
      float k = abs(legible);
      float bl = dot(base, vec3(0.299, 0.587, 0.114));
      if (legible > 0.0) {
        float lo = uDark > 0.5 ? 0.56 : 0.66;
        if (bl < lo) base = mix(base, vec3(1.0), clamp((lo - bl) / (1.0 - bl), 0.0, 1.0) * k);
      } else if (uAsh > 0.5) {
        // Pull bright backdrops down towards ash grey, not towards black.
        float hi = 0.44;
        if (bl > hi) base = mix(base, vec3(0.34, 0.34, 0.35), clamp((bl - hi) / (bl - 0.34), 0.0, 1.0) * k);
      } else {
        // Darken like tinted glass (keeping the colour) rather than painting over.
        float hi = uDark > 0.5 ? 0.3 : 0.34;
        if (bl > hi) base *= mix(1.0, hi / bl, k);
      }
    }

    // Edge light: a thin bright line along the top and bottom edges (the top
    // brighter), fading away close to the corners, with a faint glow just
    // inside it. It gives the glass its thickness. (The sides get a 1 px
    // darkening outside them instead, drawn with the shadows.)
    float line = 1.0 - smoothstep(0.35 * uDpr, 1.6 * uDpr, depth);
    float sheen = 1.0 - smoothstep(0.0, 9.0 * uDpr, depth);
    float vert = edgeWeights(q, R.zw, S.x).x * (q.y > 0.0 ? 1.0 : 0.75);
    // The glow inside the line only on taller shapes: on a short one it
    // pinches the middle.
    sheen *= smoothstep(16.0 * uDpr, 40.0 * uDpr, R.w);
    // With a mouse about, the edges brighten near it and fade away from it.
    vec2 toPointer = p - uPointer.xy;
    float reach = 240.0 * uDpr;
    float gain = mix(1.0, 0.45 + 1.6 * exp(-dot(toPointer, toPointer) / (reach * reach)), uPointer.z);
    float rimK = O.z * (1.0 + 0.5 * st.x) * (uDark > 0.5 ? 0.7 : 1.0) * gain;
    if (recess > 0.0) base += vec3(1.0) * (line * 0.25 * vert + sheen * sheen * 0.0375 * vert) * rimK;
    // A recessed well gets an even hairline all round, so it doesn't read as
    // an hourglass between lit top and bottom edges.
    else base += vec3(1.0) * line * 0.06 * rimK;

    // Pressing lights the glass where it is touched.
    vec2 dp = p - uPointer.xy;
    float r2 = max(R.z, R.w) * 1.1;
    base += st.y * 0.16 * exp(-dot(dp, dp) / (r2 * r2)) * (uDark > 0.5 ? 0.8 : 1.0);

    col = mix(col, clamp(base, 0.0, 1.0), cover);
  }
  frag = vec4(col, 1.0);
}`;
