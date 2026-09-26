"use client";

import { glassEntries, registryGeneration, type GlassEntry, type GlassKind } from "./registry";
import type { GlassFinish } from "./prefs";
import { BACKGROUND_FS, BLIT_FS, BLUR_FS, FULLSCREEN_VS, GLASS_FS, MAX_SHAPES } from "./shaders";

export const PRESET_INDEX = { harbour: 0, citrus: 1, prism: 2, contour: 3, ember: 4, studio: 5, image: 6 } as const;

export interface EngineLook {
  background: keyof typeof PRESET_INDEX;
  image: ImageBitmap | null;
  dark: boolean;
  finish: GlassFinish;
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
  clip: { x: number; y: number; w: number; h: number } | null;
}

type Target = { fbo: WebGLFramebuffer | null; tex: WebGLTexture | null; w: number; h: number };

const FINISH = {
  // frost of clear controls, frost of chrome, tint of reading surfaces
  clear: { control: 0.12, chrome: 0.5, slab: 0.4 },
  balanced: { control: 0.3, chrome: 0.72, slab: 0.52 },
  frosted: { control: 0.6, chrome: 0.9, slab: 0.66 },
} as const;

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
  private bgSoftA!: Target;
  private bgSoft!: Target;
  private bgHeavyA!: Target;
  private bgHeavy!: Target;
  private scene!: Target;
  private sceneSoftA!: Target;
  private sceneSoft!: Target;
  private width = 0;
  private height = 0;
  dpr = 1;
  private look: EngineLook | null = null;
  private bgDirty = true;
  private level1Key = "";
  private level2Key = "";

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: "high-performance" });
    if (!gl) throw new Error("WebGL2 is unavailable.");
    this.gl = gl;
    this.vao = gl.createVertexArray()!;
    this.bgProgram = new Program(gl, BACKGROUND_FS);
    this.blurProgram = new Program(gl, BLUR_FS);
    this.glassProgram = new Program(gl, GLASS_FS);
    this.blitProgram = new Program(gl, BLIT_FS);
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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
    this.bgSoftA = this.target(half(w), half(h), this.bgSoftA);
    this.bgSoft = this.target(half(w), half(h), this.bgSoft);
    this.bgHeavyA = this.target(eighth(w), eighth(h), this.bgHeavyA);
    this.bgHeavy = this.target(eighth(w), eighth(h), this.bgHeavy);
    this.scene = this.target(w, h, this.scene);
    this.sceneSoftA = this.target(half(w), half(h), this.sceneSoftA);
    this.sceneSoft = this.target(half(w), half(h), this.sceneSoft);
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

  private renderBackground() {
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
    gl.uniform1i(p.loc("uPreset"), useImage ? 6 : PRESET_INDEX[look.background === "image" ? "harbour" : look.background]);
    gl.uniform1f(p.loc("uDark"), look.dark ? 1 : 0);
    this.draw();
    // Frost levels: ~6 px and ~40 px (CSS) Gaussian.
    this.blur(this.bg, this.bgSoftA, true, 1);
    this.blur(this.bgSoftA, this.bgSoft, false, 1);
    this.blur(this.bgSoft, this.bgHeavyA, true, 1.6);
    this.blur(this.bgHeavyA, this.bgHeavy, false, 1.6);
    this.blur(this.bgHeavy, this.bgHeavyA, true, 1.3);
    this.blur(this.bgHeavyA, this.bgHeavy, false, 1.3);
  }

  private glassPass(target: Target | null, src: Target, soft: Target, heavy: Target, shapes: Shape[], pointer: [number, number, number]) {
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
    gl.uniform2f(p.loc("uRes"), this.width, this.height);
    gl.uniform1f(p.loc("uDark"), look.dark ? 1 : 0);
    gl.uniform1f(p.loc("uDpr"), dpr);
    // Key light from the upper left (GL space is y-up).
    gl.uniform2f(p.loc("uLight"), -0.55, 0.835);
    gl.uniform3f(p.loc("uPointer"), pointer[0] * dpr, this.height - pointer[1] * dpr, pointer[2]);

    const n = Math.min(shapes.length, MAX_SHAPES);
    const rect = new Float32Array(MAX_SHAPES * 4);
    const shape = new Float32Array(MAX_SHAPES * 4);
    const tint = new Float32Array(MAX_SHAPES * 4);
    const optic = new Float32Array(MAX_SHAPES * 4);
    const state = new Float32Array(MAX_SHAPES * 4);
    const clip = new Float32Array(MAX_SHAPES * 4);
    const legible = new Float32Array(MAX_SHAPES);
    for (let i = 0; i < n; i++) {
      const s = shapes[i];
      // A pressed control gives a little, like a soft body.
      const squeeze = 1 - s.press * 0.035;
      const hw = (s.w / 2) * squeeze * dpr;
      const hh = (s.h / 2) * squeeze * dpr;
      rect.set([(s.x + s.w / 2) * dpr, this.height - (s.y + s.h / 2) * dpr, hw, hh], i * 4);
      const radius = Math.min(s.radius * dpr * squeeze, hw, hh);
      const m = this.material(s.kind, Math.min(hw, hh), radius, look);
      shape.set([radius, m.bezel, m.height, m.shadowBlur * (1 + s.hover * 0.25)], i * 4);
      tint.set(m.tint, i * 4);
      legible[i] = m.legible;
      optic.set([m.frost, m.dispersion, m.rim, m.shadow * (1 + s.hover * 0.35)], i * 4);
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
    gl.uniform1fv(p.loc("uLegible"), legible);
    this.draw();
  }

  /** Optical recipe per kind of glass, in device pixels. */
  private material(kind: GlassKind, halfShort: number, radius: number, look: EngineLook) {
    const dpr = this.dpr;
    const f = FINISH[look.finish];
    const dark = look.dark;
    const solid = look.solid;
    const white = [1, 1, 1];
    const night = [0.075, 0.075, 0.085];
    switch (kind) {
      case "slab":
        return {
          bezel: Math.min(radius, 26 * dpr),
          height: 36 * dpr,
          tint: [...(dark ? night : white), solid ? 0.92 : dark ? f.slab - 0.04 : f.slab],
          legible: dark ? -1 : 1,
          frost: 1,
          dispersion: 0.12,
          rim: 0.75,
          shadow: dark ? 0.32 : 0.14,
          shadowBlur: 34 * dpr,
        };
      case "chrome":
        return {
          bezel: Math.min(radius, 26 * dpr),
          height: 42 * dpr,
          tint: [...(dark ? night : white), solid ? 0.88 : dark ? 0.36 : 0.26],
          legible: dark ? -1 : 1,
          frost: f.chrome,
          dispersion: 0.16,
          rim: 1,
          shadow: dark ? 0.34 : 0.16,
          shadowBlur: 30 * dpr,
        };
      case "control":
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort * 1.1, 22 * dpr),
          tint: [...white, dark ? 0.1 : 0.34],
          legible: dark ? -1 : 1,
          frost: f.control,
          dispersion: 0.22,
          rim: 1.1,
          shadow: dark ? 0.26 : 0.1,
          shadowBlur: 10 * dpr,
        };
      case "ink":
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort * 1.1, 20 * dpr),
          tint: dark ? [0.93, 0.93, 0.95, 0.86] : [0.1, 0.1, 0.12, 0.8],
          legible: dark ? 1 : -1,
          frost: 0.55,
          dispersion: 0.18,
          rim: 0.9,
          shadow: dark ? 0.3 : 0.16,
          shadowBlur: 12 * dpr,
        };
      case "well":
        return {
          bezel: Math.min(radius, halfShort),
          height: Math.min(halfShort, 10 * dpr),
          tint: dark ? [0, 0, 0, 0.22] : [0.2, 0.22, 0.26, 0.06],
          legible: 0,
          frost: 0.85,
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
    const key1 = JSON.stringify(level1) + pointer.join(",");
    const key2 = JSON.stringify(level2);
    const bgChanged = this.bgDirty;
    if (bgChanged) {
      this.renderBackground();
      this.bgDirty = false;
    }
    const level1Changed = bgChanged || key1 !== this.level1Key;
    if (!level1Changed && key2 === this.level2Key) return false;
    if (level1Changed) {
      this.glassPass(this.scene, this.bg, this.bgSoft, this.bgHeavy, level1, pointer);
      if (level2.length) {
        this.blur(this.scene, this.sceneSoftA, true, 1);
        this.blur(this.sceneSoftA, this.sceneSoft, false, 1);
      }
      this.level1Key = key1;
    }
    if (level2.length) {
      this.glassPass(null, this.scene, this.sceneSoft, this.sceneSoft, level2, pointer);
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

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

// ---------------------------------------------------------------------------
// Tracking DOM elements

interface Motion {
  hover: number;
  press: number;
  opacity: number;
}

const approach = (value: number, target: number, rate: number) =>
  Math.abs(target - value) < 0.002 ? target : value + (target - value) * rate;

/** Reads every registered element's live geometry into shapes. */
export class ShapeTracker {
  private motion = new WeakMap<HTMLElement, Motion>();
  private lastGeneration = -1;
  animating = false;

  collect(pointer: { x: number; y: number; down: boolean; inside: boolean }): [Shape[], Shape[]] {
    const level1: Shape[] = [];
    const level2: Shape[] = [];
    this.animating = false;
    const gen = registryGeneration();
    const regenerated = gen !== this.lastGeneration;
    this.lastGeneration = gen;
    for (const entry of glassEntries.values()) {
      const shape = this.shapeOf(entry, pointer, regenerated);
      if (!shape) continue;
      (entry.spec.level === 1 ? level1 : level2).push(shape);
    }
    return [level1, level2];
  }

  private shapeOf(entry: GlassEntry, pointer: { x: number; y: number; down: boolean; inside: boolean }, refreshRadius: boolean): Shape | null {
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
      m = { hover: 0, press: 0, opacity: 0 };
      this.motion.set(el, m);
    }
    m.hover = approach(m.hover, spec.interactive && inside ? 1 : 0, 0.22);
    m.press = approach(m.press, spec.interactive && inside && pointer.down ? 1 : 0, pointer.down ? 0.45 : 0.18);
    m.opacity = approach(m.opacity, 1, 0.2);
    if (m.opacity !== 1 || (m.hover !== 0 && m.hover !== 1) || (m.press !== 0 && m.press !== 1)) this.animating = true;
    const round = (v: number) => Math.round(v * 4) / 4;
    return {
      x: round(r.x),
      y: round(r.y),
      w: round(r.width),
      h: round(r.height),
      radius: round(radius),
      kind: spec.kind,
      hover: Math.round(m.hover * 1000) / 1000,
      press: Math.round(m.press * 1000) / 1000,
      opacity: Math.round(m.opacity * 1000) / 1000,
      clip,
    };
  }
}
