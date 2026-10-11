"use client";

import { glassEntries, isScrolling, registryGeneration, type GlassEntry, type GlassKind } from "./registry";
import { BACKGROUND_FS, BLIT_FS, BLUR_FS, FULLSCREEN_VS, glassFragment } from "./shaders";

export const PRESET_INDEX = { harbour: 0, contour: 1, ember: 2, studio: 3, image: 4 } as const;

export interface EngineLook {
  background: keyof typeof PRESET_INDEX;
  image: ImageBitmap | null;
  dark: boolean;
  /** 0 sharp … 1 fully diffused. */
  blur: number;
  /** Frosted surface: 0 smooth … 1 fully frosted (milky white haze and an icy grain). */
  frost: number;
  /** Light text over a light background: the glass then keeps itself dark. */
  lightText: boolean;
  pointerLight: boolean;
  /** prefers-reduced-transparency: glass becomes nearly opaque. */
  solid: boolean;
}

/** A glass shape in CSS px (viewport coordinates, y down). */
export interface Shape {
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  kind: GlassKind;
  hover: number;
  press: number;
  opacity: number;
  /** Direction towards the light for this shape (GL space, y up), eased over time. */
  light: [number, number];
  clip: { x: number; y: number; w: number; h: number } | null;
}

type Target = { fbo: WebGLFramebuffer | null; tex: WebGLTexture | null; w: number; h: number };

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Glass shader failed to compile: ${log}`);
  }
  return shader;
}

class Program {
  readonly program: WebGLProgram;
  private locations = new Map<string, WebGLUniformLocation | null>();
  constructor(
    private gl: WebGL2RenderingContext,
    fragment: string,
  ) {
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, FULLSCREEN_VS));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Glass program failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    this.program = program;
  }
  loc(name: string) {
    if (!this.locations.has(name)) this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name)!;
  }
}

/**
 * Renders the background and every glass surface into one canvas that sits
 * behind the page.
 *
 *   background ─► soft blur (½) ─► heavy blur (⅛)
 *        └─ level-1 glass (sidebar, panels) ─► scene ─► soft blur
 *                                               └─ level-2 glass (pills, buttons) ─► screen
 *
 * Work is only redone for what changed: the background when the look or size
 * changes, the glass passes when a shape, the pointer or an animation moves.
 */
export class GlassEngine {
  private gl: WebGL2RenderingContext;
  private vao: WebGLVertexArrayObject;
  private bgProgram: Program;
  private blurProgram: Program;
  private glassProgram: Program;
  private blitProgram: Program;
  private imageTex: WebGLTexture | null = null;
  private imageSource: ImageBitmap | null = null;
  private bg!: Target;
  /** The background being faded out when it changes. */
  private bgPrev!: Target;
  private bgSoftA!: Target;
  private bgSoft!: Target;
  private bgMidA!: Target;
  private bgMid!: Target;
  private bgHeavyA!: Target;
  private bgHeavy!: Target;
  private scene!: Target;
  private sceneSoftA!: Target;
  private sceneSoft!: Target;
  private sceneMidA!: Target;
  private sceneMid!: Target;
  private sceneHeavyA!: Target;
  private sceneHeavy!: Target;
  private width = 0;
  private height = 0;
  dpr = 1;
  private look: EngineLook | null = null;
  /** Most glass shapes one pass can draw on this device. */
  readonly maxShapes: number;
  private bgDirty = true;
  private bgDrawn = false;
  /** Start of the current background cross-fade (ms), or null. */
  private fadeStart: number | null = null;
  private static readonly FADE_MS = 520;
  /** Cross-fade background changes (off for one-shot renders such as previews). */
  fades = true;
  private level1Key = "";
  private level2Key = "";

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is unavailable.");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.bgProgram = new Program(gl, BACKGROUND_FS);
    this.blurProgram = new Program(gl, BLUR_FS);
    // Each shape takes seven uniform vectors; fit as many as the GPU allows.
    const vectors = gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number;
    this.maxShapes = Math.max(8, Math.min(48, Math.floor((vectors - 32) / 7)));
    this.glassProgram = new Program(gl, glassFragment(this.maxShapes));
    this.blitProgram = new Program(gl, BLIT_FS);
  }

  /** Called with the background's colour along the top edge whenever it settles. */
  onTopColor: ((rgb: [number, number, number]) => void) | null = null;

  /** Average colour (0…255) of the top strip of the background, under the status bar. */
  private topColor(): [number, number, number] {
    const gl = this.gl;
    const { w, h } = this.bg;
    const rows = Math.min(h, Math.ceil(28 * this.dpr));
    const pixels = new Uint8Array(w * rows * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.bg.fbo);
    gl.readPixels(0, h - rows, w, rows, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const sum = [0, 0, 0];
    for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += pixels[i + c];
    const n = Math.max(1, w * rows);
    return [Math.round(sum[0] / n), Math.round(sum[1] / n), Math.round(sum[2] / n)];
  }

  private target(w: number, h: number, previous?: Target): Target {
    const gl = this.gl;
    if (previous) {
      gl.deleteTexture(previous.tex);
      gl.deleteFramebuffer(previous.fbo);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Mirrored: glass at the window's edge refracts what lies beyond it, and
    // a clamped edge would smear its last row of pixels into streaks.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fbo, tex, w, h };
  }

  /** Sizes the canvas in device pixels; returns true when it changed. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number) {
    // Very large displays render slightly below native to keep frames cheap.
    const budget = Math.sqrt(9_000_000 / Math.max(1, cssWidth * cssHeight));
    const dpr = Math.max(1, Math.min(devicePixelRatio, 2, budget));
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    if (w === this.width && h === this.height && dpr === this.dpr) return false;
    this.dpr = dpr;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const half = (n: number) => Math.max(1, Math.round(n / 2));
    const eighth = (n: number) => Math.max(1, Math.round(n / 8));
    this.bg = this.target(w, h, this.bg);
    this.bgPrev = this.target(w, h, this.bgPrev);
    this.bgDrawn = false;
    this.bgSoftA = this.target(half(w), half(h), this.bgSoftA);
    this.bgSoft = this.target(half(w), half(h), this.bgSoft);
    const quarter = (n: number) => Math.max(1, Math.round(n / 4));
    this.bgMidA = this.target(quarter(w), quarter(h), this.bgMidA);
    this.bgMid = this.target(quarter(w), quarter(h), this.bgMid);
    this.bgHeavyA = this.target(eighth(w), eighth(h), this.bgHeavyA);
    this.bgHeavy = this.target(eighth(w), eighth(h), this.bgHeavy);
    this.scene = this.target(w, h, this.scene);
    this.sceneSoftA = this.target(half(w), half(h), this.sceneSoftA);
    this.sceneSoft = this.target(half(w), half(h), this.sceneSoft);
    this.sceneMidA = this.target(quarter(w), quarter(h), this.sceneMidA);
    this.sceneMid = this.target(quarter(w), quarter(h), this.sceneMid);
    this.sceneHeavyA = this.target(eighth(w), eighth(h), this.sceneHeavyA);
    this.sceneHeavy = this.target(eighth(w), eighth(h), this.sceneHeavy);
    this.bgDirty = true;
    this.level1Key = this.level2Key = "";
    return true;
  }

  setLook(look: EngineLook) {
    const prev = this.look;
    this.look = look;
    if (!prev || prev.background !== look.background || prev.dark !== look.dark || prev.image !== look.image) {
      this.bgDirty = true;
    }
    this.level1Key = this.level2Key = "";
  }

  private uploadImage(image: ImageBitmap) {
    const gl = this.gl;
    if (this.imageSource === image && this.imageTex) return;
    if (!this.imageTex) this.imageTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.imageTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.imageSource = image;
  }

  private bind(target: Target | null) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, target ? target.w : this.width, target ? target.h : this.height);
  }

  private texture(unit: number, tex: WebGLTexture | null) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  private draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private blur(src: Target, dst: Target, horizontal: boolean, spread: number) {
    const gl = this.gl;
    const p = this.blurProgram;
    gl.useProgram(p.program);
    this.bind(dst);
    this.texture(0, src.tex);
    gl.uniform1i(p.loc("uSrc"), 0);
    gl.uniform2f(p.loc("uStep"), horizontal ? spread / src.w : 0, horizontal ? 0 : spread / src.h);
    gl.uniform2f(p.loc("uDst"), dst.w, dst.h);
    this.draw();
  }

  private renderBackground(fade = 1) {
    const gl = this.gl;
    const look = this.look!;
    const p = this.bgProgram;
    gl.useProgram(p.program);
    this.bind(this.bg);
    const useImage = look.background === "image" && look.image != null;
    if (useImage) this.uploadImage(look.image!);
    this.texture(0, useImage ? this.imageTex : null);
    gl.uniform1i(p.loc("uImage"), 0);
    gl.uniform2f(p.loc("uImageSize"), look.image?.width ?? 1, look.image?.height ?? 1);
    gl.uniform2f(p.loc("uRes"), this.width, this.height);
    gl.uniform1i(p.loc("uPreset"), useImage ? PRESET_INDEX.image : PRESET_INDEX[look.background === "image" ? "harbour" : look.background]);
    gl.uniform1f(p.loc("uDark"), look.dark ? 1 : 0);
    this.texture(3, this.bgPrev.tex);
    gl.uniform1i(p.loc("uPrev"), 3);
    gl.uniform1f(p.loc("uFade"), fade);
    this.draw();
    // Blur levels: ~6, ~16 and ~40 px (CSS) Gaussian.
    this.blur(this.bg, this.bgSoftA, true, 1);
    this.blur(this.bgSoftA, this.bgSoft, false, 1);
    this.blur(this.bgSoft, this.bgMidA, true, 1.5);
    this.blur(this.bgMidA, this.bgMid, false, 1.5);
    this.blur(this.bgMid, this.bgHeavyA, true, 1.6);
    this.blur(this.bgHeavyA, this.bgHeavy, false, 1.6);
    this.blur(this.bgHeavy, this.bgHeavyA, true, 1.3);
    this.blur(this.bgHeavyA, this.bgHeavy, false, 1.3);
  }

  private glassPass(
    target: Target | null,
    src: Target,
    soft: Target,
    mid: Target,
    heavy: Target,
    shapes: Shape[],
    pointer: [number, number, number],
  ) {
    const gl = this.gl;
    const look = this.look!;
    const p = this.glassProgram;
    const dpr = this.dpr;
    gl.useProgram(p.program);
    this.bind(target);
    this.texture(0, src.tex);
    this.texture(1, soft.tex);
    this.texture(2, heavy.tex);
    gl.uniform1i(p.loc("uSrc"), 0);
    gl.uniform1i(p.loc("uSoft"), 1);
    gl.uniform1i(p.loc("uHeavy"), 2);
    this.texture(3, mid.tex);
    gl.uniform1i(p.loc("uMid"), 3);
    gl.uniform2f(p.loc("uRes"), this.width, this.height);
    gl.uniform1f(p.loc("uDark"), look.dark || look.lightText ? 1 : 0);
    gl.uniform1f(p.loc("uAsh"), look.lightText ? 1 : 0);
    gl.uniform1f(p.loc("uDpr"), dpr);
    // Key light from the upper left (GL space is y-up).
    gl.uniform2f(p.loc("uLight"), -0.55, 0.835);
    gl.uniform3f(p.loc("uPointer"), pointer[0] * dpr, this.height - pointer[1] * dpr, pointer[2]);

    const MAX_SHAPES = this.maxShapes;
    const n = Math.min(shapes.length, MAX_SHAPES);
    const rect = new Float32Array(MAX_SHAPES * 4);
    const shape = new Float32Array(MAX_SHAPES * 4);
    const tint = new Float32Array(MAX_SHAPES * 4);
    const optic = new Float32Array(MAX_SHAPES * 4);
    const state = new Float32Array(MAX_SHAPES * 4);
    const clip = new Float32Array(MAX_SHAPES * 4);
    const extra = new Float32Array(MAX_SHAPES * 4);
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      // A pressed control gives a little, like a soft body (at most a few px).
      const give = s.press * Math.min(0.035 * Math.min(s.w, s.h), 3) * dpr;
      const hw = Math.max(1, (s.w / 2) * dpr - give);
      const hh = Math.max(1, (s.h / 2) * dpr - give);
      const squeeze = hh / ((s.h / 2) * dpr);
      rect.set([(s.x + s.w / 2) * dpr, this.height - (s.y + s.h / 2) * dpr, hw, hh], i * 4);
      const radius = Math.min(s.radius * dpr * squeeze, hw, hh);
      const m = this.material(s.kind, Math.min(hw, hh), radius, look);
      shape.set([radius, m.bezel, m.height, m.shadowBlur * (1 + s.hover * 0.25)], i * 4);
      tint.set(m.tint, i * 4);
      extra.set([m.legible, s.light[0], s.light[1], m.frosted], i * 4);
      optic.set([m.blur, m.dispersion, m.rim, m.shadow * (1 + s.hover * 0.35)], i * 4);
      state.set([s.hover, s.press, s.opacity, s.kind === "well" ? 1 : 0], i * 4);
      const c = s.clip ?? { x: -1e5, y: -1e5, w: 2e5, h: 2e5 };
      clip.set([c.x * dpr, this.height - (c.y + c.h) * dpr, (c.x + c.w) * dpr, this.height - c.y * dpr], i * 4);
    }
    gl.uniform1i(p.loc("uCount"), n);
    gl.uniform4fv(p.loc("uRect"), rect);
    gl.uniform4fv(p.loc("uShape"), shape);
    gl.uniform4fv(p.loc("uTint"), tint);
    gl.uniform4fv(p.loc("uOptic"), optic);
    gl.uniform4fv(p.loc("uState"), state);
    gl.uniform4fv(p.loc("uClip"), clip);
    gl.uniform4fv(p.loc("uExtra"), extra);
    this.draw();
  }

  /**
   * Optical recipe per kind of glass, in device pixels. Panels take the blur
   * and frost settings; selection pills and task cards are clear lenses with
   * no haze or highlights, so only their refraction and colour fringes show.
   */
  private material(kind: GlassKind, halfShort: number, radius: number, look: EngineLook) {
    const dpr = this.dpr;
    const b = look.blur;
    const f = look.frost;
    // Glass under light text behaves as it does in dark mode.
    const dark = look.dark || look.lightText;
    const solid = look.solid;
    // Blur only softens what shows through; frost turns the glass milky and
    // grained. Reading surfaces also keep a fixed, gentle legibility band.
    const haze = dark ? [0.4, 0.41, 0.44] : [1, 1, 1];
    const hold = 0.55;
    switch (kind) {
      case "slab":
        return {
          // A wide, deep bevel (wider than the corners are round) for a clear lens edge.
          bezel: Math.min(34 * dpr, halfShort * 0.4),
          height: 52 * dpr,
          tint: solid ? [...(dark ? [0.075, 0.075, 0.085] : [1, 1, 1]), 0.92] : [1, 1, 1, 0],
          legible: (dark ? -1 : 1) * hold,
          blur: mix(0.04, 1, b),
          frosted: f,
          dispersion: 0.16,
          rim: 0.75,
          shadow: dark ? 0.32 : 0.14,
          shadowBlur: 34 * dpr,
        };
      case "chrome":
        return {
          // Small chrome (the phone tab bar) gets a proportionally gentler lens.
          bezel: Math.min(32 * dpr, halfShort * 0.55),
          height: Math.min(52 * dpr, halfShort * 0.9),
          tint: solid ? [...(dark ? [0.075, 0.075, 0.085] : [1, 1, 1]), 0.88] : [1, 1, 1, 0],
          legible: (dark ? -1 : 1) * hold * 0.9,
          blur: mix(0.03, 0.95, b),
          frosted: f * 0.9,
          dispersion: 0.16,
          rim: 1,
          shadow: dark ? 0.34 : 0.16,
          shadowBlur: 30 * dpr,
        };
      case "control":
        // Selection pills: a clear lens, no haze, no highlights.
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort * 1.1, 22 * dpr),
          tint: [1, 1, 1, 0],
          legible: 0,
          blur: 0,
          frosted: 0,
          dispersion: 0.22,
          rim: 0,
          shadow: dark ? 0.16 : 0.07,
          shadowBlur: 10 * dpr,
        };
      case "ink":
        // Primary actions: a clear lens with a little frost and light.
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort * 1.3, 26 * dpr),
          tint: [...haze, dark ? 0.06 : 0.14],
          legible: (dark ? -1 : 1) * hold * 0.9,
          blur: mix(0.02, 0.45, b),
          frosted: f * 0.6,
          dispersion: 0.17,
          rim: 1.2,
          shadow: dark ? 0.24 : 0.12,
          shadowBlur: 12 * dpr,
        };
      case "card":
        // Task plates: a shallow clear lens, no haze, no highlights, no shadow.
        return {
          bezel: Math.min(radius, 12 * dpr, halfShort),
          height: Math.min(14 * dpr, halfShort * 0.6),
          tint: [1, 1, 1, 0],
          legible: 0,
          blur: 0,
          frosted: 0,
          dispersion: 0.12,
          rim: 0,
          // No drop shadow: stacked plates' shadows merge through the gaps
          // into one dark slab under the list.
          shadow: 0,
          shadowBlur: 8 * dpr,
        };
      case "well":
        // The search field: a shallow recessed well.
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort, 10 * dpr),
          tint: dark ? [0, 0, 0, 0.12] : [0.2, 0.22, 0.26, 0.06],
          legible: 0,
          blur: 0.85,
          frosted: 0,
          dispersion: 0.1,
          rim: 0.55,
          shadow: 0,
          shadowBlur: 4 * dpr,
        };
    }
  }

  /**
   * Draws a frame. Shapes are in CSS px; the pointer is [x, y, influence].
   * Returns false when nothing needed redrawing.
   */
  render(level1: Shape[], level2: Shape[], pointer: [number, number, number]) {
    if (!this.look || this.width === 0) return false;
    // The pointer lights the rims near it, and a press lights the glass under it.
    const pressed = level1.some((s) => s.press > 0) || level2.some((s) => s.press > 0);
    const at = pressed || pointer[2] > 0 ? pointer.join(",") : "";
    const key1 = JSON.stringify(level1) + at;
    const key2 = JSON.stringify(level2) + at;
    let bgChanged = this.bgDirty;
    if (bgChanged) {
      // A new background cross-fades over the old one.
      if (this.fades && this.bgDrawn && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        this.copy(this.bg, this.bgPrev);
        this.fadeStart = performance.now();
      }
      this.bgDirty = false;
    }
    if (this.fadeStart != null) {
      const t = Math.min(1, (performance.now() - this.fadeStart) / GlassEngine.FADE_MS);
      this.renderBackground(t * t * (3 - 2 * t));
      if (t >= 1) this.fadeStart = null;
      bgChanged = true;
    } else if (bgChanged) {
      this.renderBackground();
    }
    this.bgDrawn = true;
    if (bgChanged && this.fadeStart == null && this.onTopColor) this.onTopColor(this.topColor());
    const level1Changed = bgChanged || key1 !== this.level1Key;
    if (!level1Changed && key2 === this.level2Key) return false;
    if (level1Changed) {
      this.glassPass(this.scene, this.bg, this.bgSoft, this.bgMid, this.bgHeavy, level1, pointer);
      if (level2.length) {
        this.blur(this.scene, this.sceneSoftA, true, 1);
        this.blur(this.sceneSoftA, this.sceneSoft, false, 1);
        this.blur(this.sceneSoft, this.sceneMidA, true, 1.5);
        this.blur(this.sceneMidA, this.sceneMid, false, 1.5);
        this.blur(this.sceneMid, this.sceneHeavyA, true, 1.6);
        this.blur(this.sceneHeavyA, this.sceneHeavy, false, 1.6);
      }
      this.level1Key = key1;
    }
    if (level2.length) {
      this.glassPass(null, this.scene, this.sceneSoft, this.sceneMid, this.sceneHeavy, level2, pointer);
    } else {
      const gl = this.gl;
      const p = this.blitProgram;
      gl.useProgram(p.program);
      this.bind(null);
      this.texture(0, this.scene.tex);
      gl.uniform1i(p.loc("uSrc"), 0);
      gl.uniform2f(p.loc("uDst"), this.width, this.height);
      this.draw();
    }
    this.level2Key = key2;
    return true;
  }

  /** Copies one target into another (same size). */
  private copy(from: Target, to: Target) {
    const gl = this.gl;
    const p = this.blitProgram;
    gl.useProgram(p.program);
    this.bind(to);
    this.texture(0, from.tex);
    gl.uniform1i(p.loc("uSrc"), 0);
    gl.uniform2f(p.loc("uDst"), to.w, to.h);
    this.draw();
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

// ---------------------------------------------------------------------------
// Tracking DOM elements

/** The key light, from the upper left (GL space, y up). */
const KEY_LIGHT = [-0.55, 0.835] as const;

export interface TrackedPointer {
  x: number;
  y: number;
  down: boolean;
  inside: boolean;
  /** 0…1: how strongly the light follows the pointer right now. */
  influence: number;
}


function scrollingAncestor(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowY, overflowX } = getComputedStyle(node);
    if (/(auto|scroll)/.test(overflowY) || /(auto|scroll)/.test(overflowX)) return node;
  }
  return null;
}

interface Motion {
  hover: number;
  press: number;
  opacity: number;
  /** Last centre and smoothed velocity (CSS px per frame), for the liquid stretch. */
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  /** Eased light direction (GL space). */
  lx: number;
  ly: number;
  /** Eased pull of the pointer on the light, 0 far … 1 over the shape. */
  near: number;
}

const approach = (value: number, target: number, rate: number) =>
  Math.abs(target - value) < 0.002 ? target : value + (target - value) * rate;

/** Reads every registered element's live geometry into shapes. */
export class ShapeTracker {
  private motion = new WeakMap<HTMLElement, Motion>();
  private lastGeneration = -1;
  animating = false;

  /**
   * `origin` is where the canvas's corner is in the coordinates elements
   * report. It is (0, 0) except while Safari is pinch-zoomed: there element
   * positions are measured from the visible area, while the canvas stays
   * attached to the page's viewport.
   */
  collect(pointer: TrackedPointer, origin = { x: 0, y: 0 }): [Shape[], Shape[]] {
    const level1: Shape[] = [];
    const level2: Shape[] = [];
    this.animating = false;
    const gen = registryGeneration();
    const regenerated = gen !== this.lastGeneration;
    this.lastGeneration = gen;
    const cards: Shape[] = [];
    for (const entry of glassEntries.values()) {
      const shape = this.shapeOf(entry, pointer, regenerated);
      if (!shape) continue;
      if (origin.x || origin.y) {
        shape.x -= origin.x;
        shape.y -= origin.y;
        if (shape.clip) shape.clip = { ...shape.clip, x: shape.clip.x - origin.x, y: shape.clip.y - origin.y };
      }
      if (entry.spec.level === 1) level1.push(shape);
      else (shape.kind === "card" ? cards : level2).push(shape);
    }
    // Cards go last, so a device's shape budget drops them before controls.
    return [level1, level2.concat(cards)];
  }

  private shapeOf(entry: GlassEntry, pointer: TrackedPointer, refreshRadius: boolean): Shape | null {
    const { el, spec } = entry;
    if (!el.isConnected) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    let clip: Shape["clip"] = null;
    // Children register before their parents, so the clipping panel is found late.
    if (spec.level === 2 && !entry.clip?.isConnected) {
      entry.clip = el.parentElement?.closest<HTMLElement>('[data-glass="1"]') ?? null;
    }
    if (entry.clip) {
      const c = entry.clip.getBoundingClientRect();
      if (c.width < 2 || c.height < 2) return null;
      clip = { x: c.x, y: c.y, w: c.width, h: c.height };
    }
    // Shapes in a list are also clipped to the list's scrolling box.
    if (spec.inScroll && entry.scroller === undefined) entry.scroller = scrollingAncestor(el);
    if (entry.scroller) {
      const b = entry.scroller.getBoundingClientRect();
      const x0 = Math.max(b.x, clip?.x ?? -1e5);
      const y0 = Math.max(b.y, clip?.y ?? -1e5);
      const x1 = Math.min(b.right, clip ? clip.x + clip.w : 1e5);
      const y1 = Math.min(b.bottom, clip ? clip.y + clip.h : 1e5);
      clip = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    }
    // Nothing to draw when it is scrolled or clipped out of sight.
    const view = clip ?? { x: 0, y: 0, w: document.documentElement.clientWidth, h: document.documentElement.clientHeight };
    if (r.right < view.x || r.left > view.x + view.w || r.bottom < view.y || r.top > view.y + view.h) return null;
    if (entry.radiusPx == null || refreshRadius) {
      entry.radiusPx =
        spec.radius === "pill"
          ? Infinity
          : (spec.radius ?? (parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0));
    }
    const radius = entry.radiusPx === Infinity ? Math.min(r.width, r.height) / 2 : entry.radiusPx;
    const inside = pointer.inside && pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom;
    let m = this.motion.get(el);
    if (!m) {
      m = { hover: 0, press: 0, opacity: 0, cx: r.x + r.width / 2, cy: r.y + r.height / 2, vx: 0, vy: 0, lx: KEY_LIGHT[0], ly: KEY_LIGHT[1], near: 0 };
      this.motion.set(el, m);
    }
    // Moving selections stretch a little along their path, like a drop of
    // liquid, and settle back as they arrive.
    let { x, y, width: w, height: h } = r;
    if (spec.level === 2 && (spec.kind === "control" || spec.kind === "ink")) {
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      // A jump (first sight after scrolling back into view) is not motion.
      const jump = Math.abs(cx - m.cx) > 160 || Math.abs(cy - m.cy) > 160;
      m.vx = jump ? 0 : m.vx * 0.55 + (cx - m.cx) * 0.45;
      m.vy = jump ? 0 : m.vy * 0.55 + (cy - m.cy) * 0.45;
      m.cx = cx;
      m.cy = cy;
      if (Math.abs(m.vx) < 0.05) m.vx = 0;
      if (Math.abs(m.vy) < 0.05) m.vy = 0;
      if (m.vx || m.vy) {
        this.animating = true;
        const sx = Math.min(Math.abs(m.vx) * 0.45, Math.min(10, r.width * 0.12));
        const sy = Math.min(Math.abs(m.vy) * 0.45, Math.min(10, r.height * 0.3));
        w += sx * 2 - sy * 0.6;
        h += sy * 2 - sx * 0.35;
        x = cx - w / 2;
        y = cy - h / 2;
      }
    }
    m.hover = approach(m.hover, spec.interactive && inside ? 1 : 0, 0.22);
    m.press = approach(m.press, spec.interactive && inside && pointer.down ? 1 : 0, pointer.down ? 0.45 : 0.18);
    // While its list scrolls, a card fades to its CSS stand-in (which moves
    // with the compositor) and returns once the list settles.
    const moving = entry.scroller != null && spec.kind === "card" && isScrolling(entry.scroller);
    const opacity = moving ? 0 : el.dataset.taskCard === "done" ? 0.5 : 1;
    m.opacity = approach(m.opacity, opacity, moving ? 0.5 : 0.2);
    if (m.opacity !== opacity || (m.hover !== 0 && m.hover !== 1) || (m.press !== 0 && m.press !== 1)) this.animating = true;
    // The highlight leans towards a nearby pointer: fully over the shape, less
    // as the pointer moves away. It glides round the rim rather than jumping
    // when the pointer crosses to the other side.
    {
      const gapX = Math.max(r.left - pointer.x, pointer.x - r.right, 0);
      const gapY = Math.max(r.top - pointer.y, pointer.y - r.bottom, 0);
      const near = pointer.influence * Math.exp(-Math.hypot(gapX, gapY) / 200);
      m.near = Math.abs(near - m.near) < 0.004 ? near : m.near + (near - m.near) * 0.08;
      if (m.near !== near) this.animating = true;
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const dx = pointer.x - cx;
      const dy = cy - pointer.y;
      const len = Math.hypot(dx, dy) || 1;
      const pull = 0.85 * m.near;
      let tx = KEY_LIGHT[0] * (1 - pull) + (dx / len) * pull;
      let ty = KEY_LIGHT[1] * (1 - pull) + (dy / len) * pull;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl;
      ty /= tl;
      // Turn by angle, a little each frame, so the light travels round the rim.
      const from = Math.atan2(m.ly, m.lx);
      let turn = Math.atan2(ty, tx) - from;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      const angle = Math.abs(turn) < 0.002 ? from + turn : from + turn * 0.05;
      m.lx = Math.cos(angle);
      m.ly = Math.sin(angle);
      if (Math.abs(turn) >= 0.002) this.animating = true;
    }
    if (m.opacity === 0) return null;
    const round = (v: number) => Math.round(v * 4) / 4;
    return {
      x: round(x),
      y: round(y),
      w: round(w),
      h: round(h),
      radius: round(radius),
      kind: spec.kind,
      hover: Math.round(m.hover * 1000) / 1000,
      press: Math.round(m.press * 1000) / 1000,
      opacity: Math.round(m.opacity * 1000) / 1000,
      light: [Math.round(m.lx * 1000) / 1000, Math.round(m.ly * 1000) / 1000],
      clip,
    };
  }
}
