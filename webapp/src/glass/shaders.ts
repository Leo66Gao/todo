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
 * channels are refracted slightly differently (dispersion). The backdrop is
 * sampled sharp at the rim and increasingly frosted towards the centre, then
 * tinted. Light adds a Fresnel reflection of the surroundings, a soft glow
 * and glint along the bevel facing the light, and — on the backdrop — a soft
 * shadow. The shape count is fixed per device from its uniform budget.
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
uniform vec4 uExtra[${MAX_SHAPES}];  // legibility (+1 light, -1 dark, 0 free), light direction xy
uniform vec2 uLight;                // towards the light, GL space
uniform vec3 uPointer;              // xy, influence
uniform float uDark;
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
vec3 fetch3(sampler2D t, vec2 a, vec2 b, vec2 c) {
  return vec3(texture(t, a).r, texture(t, b).g, texture(t, c).b);
}
float grainAt(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// A ring of taps around a pre-blurred level widens its blur smoothly.
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
// pre-blurred levels (~6, ~16 and ~40 CSS px).
vec3 blurAt(float R, vec2 a, vec2 b, vec2 c) {
  float s1 = 6.0 * uDpr;
  float s2 = 16.0 * uDpr;
  float s3 = 40.0 * uDpr;
  if (R <= s1) return mix(fetch3(uSrc, a, b, c), fetch3(uSoft, a, b, c), R / s1);
  if (R <= s2) {
    float f = (R - s1) / (s2 - s1);
    vec3 v = ring(uSoft, a, b, c, sqrt(R * R - s1 * s1) * 0.8);
    return f < 0.7 ? v : mix(v, fetch3(uMid, a, b, c), (f - 0.7) / 0.3);
  }
  if (R <= s3) {
    float f = (R - s2) / (s3 - s2);
    vec3 v = ring(uMid, a, b, c, sqrt(R * R - s2 * s2) * 0.8);
    return f < 0.7 ? v : mix(v, fetch3(uHeavy, a, b, c), (f - 0.7) / 0.3);
  }
  return ring(uHeavy, a, b, c, sqrt(R * R - s3 * s3) * 0.8);
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
    float d = sdRoundBox(q, R.zw, S.x);
    if (d > blur * 3.0) continue;
    vec4 C0 = uClip[i];
    float inClip = clamp(min(min(p.x - C0.x, C0.z - p.x), min(p.y - C0.y, C0.w - p.y)) + 0.5, 0.0, 1.0);
    float k = uOptic[i].w * uState[i].z * inClip;
    shade = max(shade, k * exp(-max(d, 0.0) / (blur * 0.55)) * smoothstep(-blur, blur * 0.2, d + blur * 0.2));
    float d0 = sdRoundBox(p - R.xy, R.zw, S.x);
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
    float clip = clamp(min(min(p.x - C.x, C.z - p.x), min(p.y - C.y, C.w - p.y)) + 0.5, 0.0, 1.0);
    float d = sdRoundBox(q, R.zw, S.x);
    float cover = clamp(0.5 - d, 0.0, 1.0) * clip * uState[i].z;
    if (cover <= 0.0) continue;

    vec4 T = uTint[i];
    vec4 O = uOptic[i];
    vec4 st = uState[i];
    vec2 g = gradRoundBox(q, R.zw, S.x);
    float depth = max(-d, 0.0);
    float t = clamp(depth / S.y, 0.0, 1.0);
    float u = 1.0 - t;
    float u4 = u * u * u * u;
    float prof = pow(1.0 - u4, 0.25);
    float slopeRaw = u * u * u * pow(max(1.0 - u4, 1e-4), -0.75);
    // Saturate softly: a hard cap leaves a visible seam along the rim.
    float slope = slopeRaw / (1.0 + slopeRaw / 7.0);
    float recess = st.w > 0.5 ? -0.6 : 1.0;
    vec3 n = normalize(vec3(g * slope * recess, 1.0));

    // Light: a fixed key light, drawn towards the pointer when it is near.
    // (Eased per shape on the CPU, leaning towards the pointer.)
    vec2 L2 = normalize(uExtra[i].yz + vec2(1e-4));
    vec3 L = normalize(vec3(L2 * 0.8, 0.6));

    // Refraction through the glass.
    vec3 r = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / 1.5);
    float thick = S.z * (0.2 + 0.8 * prof) * (1.0 + st.y * 0.45);
    vec2 off = r.xy / max(-r.z, 0.25) * thick;
    // Never let the offset grow faster than the surface moves: past that the
    // image folds over itself and the rim breaks into streaks.
    float offLen = length(off);
    // (At most 2.5x compression at the rim: enough to read as a lens.)
    float fold = 0.6 * S.y * u + 0.5 * uDpr;
    if (offLen > fold) off *= fold / offLen;
    float disp = O.y * 1.45 * mix(0.55, 1.0, clamp(O.x * 2.0, 0.0, 1.0)) * (1.0 + 0.6 * clamp(abs(g.x * g.y) * 4.0, 0.0, 1.0));
    vec2 uvG = (p + off) / uRes;
    vec2 uvR = (p + off * (1.0 - disp)) / uRes;
    vec2 uvB = (p + off * (1.0 + disp)) / uRes;
    // Blur: a true radius that grows smoothly with the setting and fills the
    // whole shape. Where the lens squeezes the image near the rim it softens
    // a little more, so fine detail can't alias into stripes.
    // Frosted (milky) glass diffuses a little too, however low the blur.
    float milk = dot(T.rgb, vec3(0.333)) > 0.3 ? T.a : 0.0;
    float radius = max(pow(O.x, 1.4) * 44.0, milk * 14.0) * uDpr + 9.0 * uDpr * u * u;
    vec3 base = blurAt(radius, uvR, uvG, uvB);

    // Vibrancy.
    float lum = dot(base, vec3(0.299, 0.587, 0.114));
    base = clamp(mix(vec3(lum), base, 1.22) * (uDark > 0.5 ? 1.0 : 1.03), 0.0, 1.0);
    // Frost: frosted glass scatters light, so colours wash out into a milky
    // haze with a fine grain. (A dark tint, as on the search well, deepens.)
    float fa = T.a * (1.0 - st.y * 0.25);
    if (dot(T.rgb, vec3(0.333)) > 0.3) {
      base = mix(base, vec3(dot(base, vec3(0.299, 0.587, 0.114))), 0.45 * fa);
      base = 1.0 - (1.0 - base) * (1.0 - T.rgb * fa);
      base += (grainAt(p) - 0.5) * 0.035 * fa;
    } else {
      base = mix(base, T.rgb, fa);
    }
    // Fresnel: grazing angles near the rim reflect the blurred surroundings.
    float fres = pow(1.0 - n.z, 2.2) * (0.55 + 0.45 * u);
    vec3 env = texture(uHeavy, (p + g * S.y * 2.5) / uRes).rgb;
    env = mix(vec3(dot(env, vec3(0.333))), env, 1.5) * (uDark > 0.5 ? 1.25 : 1.1) + 0.06;
    base = mix(base, env, clamp(fres * 0.6, 0.0, 0.55));

    // Shading across the bevel: lit side brighter, far side slightly deeper.
    float facing = dot(g, L2);
    float shading = min(O.z, 1.0) * step(0.0, recess);
    base *= 1.0 - 0.16 * u * u * max(-facing, 0.0) * shading;
    base += 0.05 * u * u * max(facing, 0.0) * shading;
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
      } else {
        // Darken like tinted glass (keeping the colour) rather than painting over.
        float hi = uDark > 0.5 ? 0.3 : 0.34;
        if (bl > hi) base *= mix(1.0, hi / bl, k);
      }
    }

    // Light along the bevel: a faint edge, a soft glow and a glint, brightest
    // on the side facing the light (which leans towards the pointer).
    float rimW = 1.35 * uDpr;
    float edge = 1.0 - smoothstep(0.0, rimW, depth);
    float glowBand = (1.0 - smoothstep(rimW, rimW * 3.5, depth)) * (1.0 - edge);
    float lit = 0.35 + 0.65 * max(facing, 0.0) + 0.35 * max(-facing, 0.0);
    // With a mouse about, the rims brighten near it and fade away from it.
    vec2 toPointer = p - uPointer.xy;
    float reach = 240.0 * uDpr;
    float gain = mix(1.0, 0.35 + 1.9 * exp(-dot(toPointer, toPointer) / (reach * reach)), uPointer.z);
    float rimK = O.z * (1.0 + 0.6 * st.x) * (uDark > 0.5 ? 0.55 : 0.85) * 0.2 * gain;
    base += (edge * lit * 0.5 + glowBand * 0.28 * max(facing, 0.0)) * rimK;
    vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, H), 0.0), 70.0) * u * O.z * (0.9 + 0.8 * st.x) * 0.2 * gain;
    base += spec;

    // Pressing lights the glass where it is touched.
    vec2 dp = p - uPointer.xy;
    float r2 = max(R.z, R.w) * 1.1;
    base += st.y * 0.16 * exp(-dot(dp, dp) / (r2 * r2)) * (uDark > 0.5 ? 0.8 : 1.0);

    col = mix(col, clamp(base, 0.0, 1.0), cover);
  }
  frag = vec4(col, 1.0);
}`;
