/**
 * Venom hover for every [data-venom] button (adapted from Nexus UI's Venom Button, no libraries).
 *
 * The button behaves like a symbiote looking for a host. When the mouse comes within SENSE, the
 * edge swells toward it and pseudopods ooze out and feel about in its direction, reaching further
 * the closer it gets. At REACH they lunge and latch onto the pointer, strung together with fine web
 * threads, and a pulse runs along them toward it. Pull away past RELEASE and they stretch thin,
 * snap and slump back into the body, which wobbles and throws up a few spikes that sink again. Back
 * off before it grabs and the feelers simply withdraw.
 *
 * Only the button nearest the mouse is "hunting"; when the mouse moves on to a neighbour, the old
 * one lets go while the new one already reaches out. A click makes the button gulp: the strands are
 * slurped back in and a ripple of little spikes runs round the edge from the pointer, meeting on the
 * far side where it flicks off a drop that falls back in.
 *
 * The button itself is untouched: one fixed canvas over the page draws only the goo that reaches
 * past each button's edge, in that button's own (live) background colour, so it reads as the same
 * flat pill growing. The goo is one WebGL shader (smooth-unioned distance fields), so every join is
 * seamless; the strands are verlet ropes with heavy damping so they move like something viscous.
 * The white circle is an eye: its iris turns toward the pointer while the goo hunts, the pupil widens
 * once it has hold, and the eye blinks on click.
 *
 * Touch has no hover, so on a phone the goo follows a finger only while it is down, lingers a moment
 * after it lifts (a tap is a quick poke), and lets go at once if the browser takes the gesture to
 * scroll; a tap on the button gulps like a click. Off under reduced motion; the loop sleeps when
 * nothing moves.
 */

/* With the system pointer there is no hand, so the strands gather round the hotspot. */
const GRIPS: [number, number][] = [[0, 0], [5, 7], [-4, 6], [8, 13], [-2, 12], [3, 3], [6, 18], [0, 16]];

/* Limits baked into the shader. */
const MS = 7; // thick strands rendered as goo
const NP = 12; // points per strand
const MSPK = 20; // room for the click ripple plus a snap's spikes
const MDROP = 6;

/** Thick strands (2 to MS); about as many fine hairs are added between them. */
const STRANDS = 5;
/** Distance from the edge, in px, at which the goo notices the mouse and starts reaching for it. */
const SENSE = 180;
/** Distance from the edge, in px, at which the strands lunge and grab the pointer. */
const REACH = 80;
/** Distance from the edge, in px, at which they snap. Keep it above REACH. */
const RELEASE = 130;
/** Seconds the click ripple takes to run from the pointer round to the far side. */
const RIPPLE = 0.32;
/** Ms the goo keeps hold after a finger lifts. */
const LINGER = 1700;

const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;

/*
 * The goo is one signed distance field: the pill, a mound pulled toward the pointer, the strands
 * (tapered capsules), spikes and droplets, all joined with a smooth minimum so every join melts
 * into the next. Only what reaches past the pill's own edge is painted: the button draws itself.
 */
const FRAG = `precision highp float;
uniform vec2 uRes;      // canvas px
uniform float uDpr;
uniform vec4 uPill;     // x, y, w, h in css px
uniform vec4 uPts[${MS * NP}]; // x, y, radius, unused
uniform float uCount;   // strands in use
uniform vec4 uSpk[${MSPK}];    // base x, y, tip x, y
uniform vec4 uSpkR[${MSPK}];   // base radius, alive
uniform vec4 uDrop[${MDROP}];  // x, y, r, alive
uniform vec4 uMound;    // from x, y to x, y
uniform vec2 uMoundR;   // radius at base, radius at tip
uniform vec4 uColor;    // the button's background, straight alpha

float smin(float a, float b, float k){
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
// exact distance to a tapered capsule (a circle of radius ra at a, rb at b, joined by tangents)
float cone(vec2 p, vec2 a, vec2 b, float ra, float rb){
  vec2 pb = b - a;
  p -= a;
  float h = dot(pb, pb);
  float bb = ra - rb;
  if (h <= bb * bb + 1e-3) {
    // too short to taper: the larger circle swallows the smaller one
    return ra > rb ? length(p) - ra : length(p - pb) - rb;
  }
  vec2 q = vec2(dot(p, vec2(pb.y, -pb.x)), dot(p, pb)) / h;
  q.x = abs(q.x);
  vec2 c = vec2(sqrt(h - bb * bb), bb);
  float k = c.x * q.y - c.y * q.x;
  float m = dot(c, q);
  float n = dot(q, q);
  if (k < 0.0) return sqrt(h * n) - ra;
  if (k > c.x) return sqrt(h * (n + 1.0 - 2.0 * q.y)) - rb;
  return m - ra;
}
float pill(vec2 p){
  float rr = uPill.w * 0.5;
  vec2 c = vec2(uPill.x + uPill.z * 0.5, uPill.y + rr);
  float a = max(0.0, uPill.z * 0.5 - rr);
  vec2 q = p - c;
  return length(q - vec2(clamp(q.x, -a, a), 0.0)) - rr;
}

void main(){
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  float dp = pill(p);
  float body = dp;
  if (uMoundR.x > 0.01) body = smin(body, cone(p, uMound.xy, uMound.zw, uMoundR.x, uMoundR.y), 14.0);
  // strands, melted into each other a little and into the body a lot
  float st = 1e5;
  for (int s = 0; s < ${MS}; s++) {
    if (float(s) >= uCount) break;
    // one strand is a hard union of its pieces (no beads at the joints)...
    float one = 1e5;
    for (int i = 0; i < ${NP - 1}; i++) {
      vec4 A = uPts[s * ${NP} + i];
      vec4 B = uPts[s * ${NP} + i + 1];
      one = min(one, cone(p, A.xy, B.xy, A.z, B.z));
    }
    // ...and neighbouring strands melt together where they touch
    st = smin(st, one, 3.5);
  }
  for (int k = 0; k < ${MSPK}; k++) {
    if (uSpkR[k].y < 0.5) continue;
    st = smin(st, cone(p, uSpk[k].xy, uSpk[k].zw, uSpkR[k].x, 0.35), 3.0);
  }
  for (int k = 0; k < ${MDROP}; k++) {
    if (uDrop[k].w < 0.5) continue;
    st = smin(st, length(p - uDrop[k].xy) - uDrop[k].z, 5.0);
  }
  float d = smin(body, st, 11.0);
  float aa = clamp(0.5 - d * uDpr, 0.0, 1.0);
  // paint only where the goo grows past the button's edge (plus a 1px overlap, so no seam shows)
  float outside = clamp(0.5 + (dp + 1.0) * uDpr, 0.0, 1.0);
  float grown = clamp((dp - d) * uDpr, 0.0, 1.0);
  float alpha = aa * outside * grown * uColor.a;
  gl_FragColor = vec4(uColor.rgb * alpha, alpha);
}`;

type Strand = {
  x: Float32Array; y: Float32Array; px: Float32Array; py: Float32Array;
  spread: number; s: number; slack: number; width: number;
  grip: [number, number]; reachK: number; ex: number; ey: number; follow: number;
  seg: number; phase: number; hair: boolean;
};
/** A negative age is a delay: the spike is not born yet. One with `drop` flicks off a drop at birth. */
type Spike = { s: number; tilt: number; len: number; r: number; age: number; life: number; drop?: boolean };
type Drop = { x: number; y: number; vx: number; vy: number; r: number; age: number };
/** draw() only reads the page and paints the canvases; commit() then writes the eye's styles, so a
 * frame never interleaves layout reads with style writes. */
type Goo = { draw: (now: number, dt: number, live: boolean) => boolean; commit: () => void; gulp: (x: number, y: number) => void };

const buttons = [...document.querySelectorAll<HTMLElement>("[data-venom]")];
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

if (buttons.length) {
  let failed = false;
  let glc: HTMLCanvasElement | null = null;
  let fxc: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | null = null;
  let fx: CanvasRenderingContext2D | null = null;
  const U: Record<string, WebGLUniformLocation | null> = {};
  const quadData = new Float32Array(8);
  const pts = new Float32Array(MS * NP * 4);
  const spk = new Float32Array(MSPK * 4), spkR = new Float32Array(MSPK * 4), drp = new Float32Array(MDROP * 4);
  let w = 0, h = 0, dpr = 1;
  const ptr = { x: -999, y: -999, inside: false, touch: false, down: false, upAt: 0 };
  /** On a narrow touch screen the sensing distance shrinks with it, or the whole screen would be inside it. */
  const sense = () => (ptr.touch ? SENSE * Math.max(0.55, Math.min(1, document.documentElement.clientWidth / 560)) : SENSE);
  /** Buttons whose goo is still moving; the loop runs while this is not empty. */
  const goos = new Map<HTMLElement, Goo>();

  // Turns any CSS colour into straight rgba (0 to 1) through a 1px canvas.
  const probe = Object.assign(document.createElement("canvas"), { width: 1, height: 1 }).getContext("2d", { willReadFrequently: true })!;
  const toRgba = (css: string) => {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = css;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255, a / 255];
  };

  let prog: WebGLProgram | null = null;
  /** Compiles shaders off the main thread where supported (KHR_parallel_shader_compile). */
  let parallel: { COMPLETION_STATUS_KHR: number } | null = null;
  let ready = false;

  // The canvases cover the screen only once ready, and stay out of the compositor while idle.
  const fit = () => {
    if (!ready) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = document.documentElement.clientWidth;
    h = document.documentElement.clientHeight;
    for (const c of [glc!, fxc!]) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = `${w}px`; c.style.height = `${h}px`;
    }
    gl!.viewport(0, 0, glc!.width, glc!.height);
  };
  const show = (on: boolean) => {
    if (glc && fxc) glc.style.display = fxc.style.display = on ? "" : "none";
  };

  // Starts building the shader. Run while the browser is idle, so the first approach never waits on
  // a compile; the canvases stay tiny and hidden until the goo first moves.
  const prepare = () => {
    if (glc || failed) return;
    const g = document.createElement("canvas"), f = document.createElement("canvas");
    for (const c of [g, f]) {
      c.setAttribute("aria-hidden", "true");
      Object.assign(c.style, { position: "fixed", top: "0", left: "0", pointerEvents: "none", zIndex: "60", display: "none" });
    }
    const ctx = g.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    const p = ctx?.createProgram();
    if (!ctx || !p) {
      // no WebGL: the buttons simply stay as they are
      failed = true;
      return;
    }
    parallel = ctx.getExtension("KHR_parallel_shader_compile");
    for (const [type, src] of [[ctx.VERTEX_SHADER, VERT], [ctx.FRAGMENT_SHADER, FRAG]] as const) {
      const sh = ctx.createShader(type)!;
      ctx.shaderSource(sh, src);
      ctx.compileShader(sh);
      ctx.attachShader(p, sh);
    }
    ctx.linkProgram(p);
    g.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      failed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      goos.clear();
      g.remove();
      f.remove();
    });
    glc = g; fxc = f; gl = ctx; prog = p;
    document.body.append(g, f);
  };

  /** True once the shader is built and wired up; false while it is still compiling or if it failed. */
  const init = () => {
    if (ready) return true;
    prepare();
    if (failed || !gl || !prog) return false;
    // still compiling in the background: try again on the next move
    if (parallel && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) return false;
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // the shader did not build: the buttons simply stay as they are
      failed = true;
      glc!.remove();
      fxc!.remove();
      return false;
    }
    gl.useProgram(prog);
    for (const n of ["uRes", "uDpr", "uPill", "uPts", "uCount", "uSpk", "uSpkR", "uDrop", "uMound", "uMoundR", "uColor"]) U[n] = gl.getUniformLocation(prog, n);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    const aLoc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
    // several buttons can be busy at once (one letting go while the next reaches out)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    fx = fxc!.getContext("2d")!;
    ready = true;
    fit();
    return true;
  };

  /** Edge distance from a point to a button's pill, in viewport px (the canvas shares the space). */
  const pillDist = (b: DOMRect, qx: number, qy: number) => {
    const r = b.height / 2;
    const cx = Math.max(b.left + r, Math.min(b.right - r, qx));
    return Math.hypot(qx - cx, qy - (b.top + r)) - r;
  };

  /** The visible button nearest the mouse, if it is within SENSE: the one that hunts. */
  const target = () => {
    // a lifted finger keeps hold for a moment, then lets go
    if (ptr.touch && !ptr.down && performance.now() - ptr.upAt > LINGER) ptr.inside = false;
    if (!ptr.inside || failed || reducedMotion.matches) return null;
    let best: HTMLElement | null = null, bestD = sense();
    for (const b of buttons) {
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const d = pillDist(r, ptr.x, ptr.y);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  };

  /** One button's goo: its own strands, spikes, drops and mound. */
  const createGoo = (el: HTMLElement): Goo => {
    // ---- pill geometry, re-measured every frame ----
    const pill = { x: 0, y: 0, w: 0, h: 0, r: 0, ls: 0, P: 1 };
    const measure = () => {
      const b = el.getBoundingClientRect();
      pill.x = b.left; pill.y = b.top; pill.w = b.width; pill.h = b.height;
      pill.r = pill.h / 2;
      pill.ls = Math.max(0, pill.w - pill.h);
      pill.P = 2 * pill.ls + 2 * Math.PI * pill.r || 1;
    };
    const at = (s: number) => {
      const { x, y, w: W, h: H, r, ls, P } = pill;
      s = ((s % P) + P) % P;
      if (s < ls) return { x: x + r + s, y, nx: 0, ny: -1 };
      s -= ls;
      if (s < Math.PI * r) {
        const a = -Math.PI / 2 + s / r;
        return { x: x + W - r + Math.cos(a) * r, y: y + r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
      }
      s -= Math.PI * r;
      if (s < ls) return { x: x + W - r - s, y: y + H, nx: 0, ny: 1 };
      s -= ls;
      const a = Math.PI / 2 + s / r;
      return { x: x + r + Math.cos(a) * r, y: y + r + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    };
    const edgeDist = (qx: number, qy: number) => {
      const { x, w: W, r } = pill;
      const cx = Math.max(x + r, Math.min(x + W - r, qx));
      return Math.hypot(qx - cx, qy - (pill.y + r)) - r;
    };
    const nearest = (qx: number, qy: number) => {
      const { x, w: W, r, ls } = pill;
      const cy = pill.y + r;
      let s: number;
      if (qx > x + W - r) s = ls + (Math.atan2(qy - cy, qx - (x + W - r)) + Math.PI / 2) * r;
      else if (qx < x + r) {
        let a = Math.atan2(qy - cy, qx - (x + r));
        if (a < -Math.PI / 2) a += Math.PI * 2;
        s = 2 * ls + Math.PI * r + (a - Math.PI / 2) * r;
      } else s = qy < cy ? qx - (x + r) : ls + Math.PI * r + (x + W - r - qx);
      return { s, dist: edgeDist(qx, qy) };
    };
    const loopDiff = (a: number, b: number) => {
      const P = pill.P;
      let d = (b - a) % P;
      if (d > P / 2) d -= P;
      if (d < -P / 2) d += P;
      return d;
    };

    // the eye: an iris on a spring inside the white circle, with a pupil that widens
    const ball = el.querySelector<HTMLElement>("[data-venom-ball]");
    const iris = el.querySelector<HTMLElement>("[data-venom-iris]");
    const pupil = el.querySelector<HTMLElement>("[data-venom-pupil]");
    const eye = el.querySelector<SVGElement>(".venom-eye");
    let eyeX = 0, eyeY = 0, eyeVX = 0, eyeVY = 0, dilate = 1, eyeBusy = false;
    let eyeSide = 0;

    // The goo takes the button's live background (it changes on hover).
    let colorCss = "";
    let color = [0, 0, 0, 1];
    const readColor = () => {
      const css = getComputedStyle(el).backgroundColor;
      if (css !== colorCss) { colorCss = css; color = toRgba(css); }
    };

    // ---- goo state ----
    // idle -> seek (pseudopods reach for the pointer) -> grow (they lunge for it) -> hold -> snap;
    // a click jumps to gulp from anywhere
    let mode: "idle" | "seek" | "grow" | "hold" | "snap" | "gulp" = "idle";
    let violentSnap = false;
    let grow = 0;
    let seekF = 0;
    let gulpT = 0;
    let list: Strand[] = [];
    let webs: [number, number, number, number, number][] = [];
    const spikes: Spike[] = [];
    const drops: Drop[] = [];
    let near = { s: 0, dist: 999 };
    let stretch = 0;
    // the mound is a damped spring, so it wobbles when the strands let go
    let mound = 0, moundV = 0, moundS = 0;
    let moundDir = { x: 0, y: 1 };

    const gripAt = (g: [number, number]) => ({ x: ptr.x + g[0], y: ptr.y + g[1] });

    const spawn = () => {
      list = [];
      const main = Math.max(2, Math.min(MS, Math.round(STRANDS)));
      const total = main * 2 - 1;
      const root = at(near.s);
      if (Math.abs(mound) < 0.05) moundS = near.s;
      for (let k = 0; k < total; k++) {
        const hair = k % 2 === 1;
        const mi = Math.floor(k / 2);
        // each thick strand claims a spot round the pointer; each hair takes a spot between two of them
        const g: [number, number] = hair
          ? [(GRIPS[mi % GRIPS.length][0] + GRIPS[(mi + 1) % GRIPS.length][0]) / 2, (GRIPS[mi % GRIPS.length][1] + GRIPS[(mi + 1) % GRIPS.length][1]) / 2]
          : GRIPS[mi % GRIPS.length];
        list.push({
          x: new Float32Array(NP).fill(root.x), y: new Float32Array(NP).fill(root.y),
          px: new Float32Array(NP).fill(root.x), py: new Float32Array(NP).fill(root.y),
          spread: (k / (total - 1)) * 2 - 1 + (Math.random() - 0.5) * 0.15,
          s: near.s,
          slack: 1.02 + Math.random() * (hair ? 0.2 : 0.12),
          width: hair ? 0.5 : 0.8 + Math.random() * 0.45,
          grip: g,
          reachK: hair ? 0.35 : 0.55 + Math.random() * 0.4,
          ex: root.x, ey: root.y,
          follow: 9 + Math.random() * 8,
          seg: 0, phase: Math.random() * 10, hair,
        });
      }
      webs = [];
      for (let k = 0; k < list.length - 1; k++) {
        const count = 1 + Math.floor(Math.random() * 2);
        for (let c = 0; c < count; c++) {
          const i = 3 + Math.floor(Math.random() * (NP - 5));
          const j = Math.max(2, Math.min(NP - 2, i + Math.round((Math.random() - 0.5) * 3)));
          webs.push([k, k + 1, i, j, (Math.random() - 0.5) * 5]);
        }
      }
      grow = 0;
      mode = "seek";
    };

    const snap = (violent: boolean) => {
      if (mode === "idle" || mode === "snap" || mode === "gulp") return;
      mode = "snap";
      violentSnap = violent;
      if (!violent) return;
      moundV -= 90; // the body recoils
      const seen = new Set<number>();
      for (const st of list) {
        if (st.hair) continue;
        const key = Math.round(st.s / 8);
        if (seen.has(key) || spikes.length >= MSPK) continue;
        seen.add(key);
        spikes.push({ s: st.s, tilt: (Math.random() - 0.5) * 0.8, len: 10 + Math.random() * 16, r: 2.6, age: 0, life: 1.1 + Math.random() * 0.6 });
        if (Math.random() < 0.6 && drops.length < MDROP) {
          const i = 4 + Math.floor(Math.random() * 4);
          const root = at(st.s);
          drops.push({ x: st.x[i], y: st.y[i], vx: (root.x - st.x[i]) * 2, vy: (root.y - st.y[i]) * 2 - 40, r: 2 + Math.random() * 2.2, age: 0 });
        }
      }
    };

    // The click: the strands are slurped back in, the body jolts, and a ripple of little spikes runs
    // round the edge from the pointer both ways, meeting on the far side, which flicks off a drop.
    const gulp = (x: number, y: number) => {
      measure();
      near = nearest(x, y);
      // the eye blinks: the white closes to a slit and opens again
      ball?.animate(
        [{ transform: "scaleY(1)", easing: "cubic-bezier(0.5, 0, 0.75, 0)" }, { transform: "scaleY(0.08)", offset: 0.4, easing: "cubic-bezier(0.25, 1, 0.5, 1)" }, { transform: "scaleY(1)" }],
        { duration: 260 },
      );
      mode = "gulp";
      gulpT = 0;
      moundV -= 140;
      // a few snap spikes may still be up; the ripple takes whatever room is left
      const count = Math.min(MSPK - spikes.length, Math.max(8, Math.round(pill.P / 32))) & ~1;
      for (let k = 0; k < count; k++) {
        const hop = Math.min(k, count - k) / (count / 2); // 0 at the pointer, 1 on the far side
        spikes.push({
          s: near.s + (k / count) * pill.P,
          tilt: 0,
          len: 4 + 6 * hop * hop + Math.random() * 2,
          r: 1.6 + 0.9 * hop,
          age: -hop * RIPPLE,
          life: 0.42 + 0.12 * hop,
          drop: k === count / 2,
        });
      }
    };

    /** Advances and paints one frame; returns false once everything has settled. */
    const draw = (now: number, dt: number, hunting: boolean) => {
      measure();
      readColor();
      const time = now / 1000;

      // a button that vanished (resize, hidden) counts as the pointer leaving
      const live = hunting && pill.w > 0;
      near = nearest(ptr.x, ptr.y);
      // over the button it counts as touching
      const D = Math.max(0, near.dist);
      const sn = sense(), rc = REACH, rl = RELEASE;

      if (mode === "idle" && live && D < sn) spawn();
      else if (mode === "snap" && !violentSnap && live && D < sn) mode = "seek"; // changed its mind
      else if (mode === "seek" && (!live || D > sn + 25)) snap(false);
      else if (mode === "seek" && D < rc) { mode = "grow"; grow = 0; }
      else if ((mode === "grow" || mode === "hold") && (!live || D > rl)) snap(true);

      const holding = mode === "hold" || mode === "grow";
      const seeking = mode === "seek";
      // how hard it is reaching: nothing at the edge of its senses, everything at grabbing range
      const fT = seeking ? Math.max(0, Math.min(1, (sn - D) / Math.max(1, sn - rc))) : holding ? 1 : 0;
      seekF += (fT - seekF) * Math.min(1, dt * 5);
      stretch = holding ? Math.min(1, D / rl) : 0;
      if (mode === "grow") {
        grow = Math.min(1, grow + dt / 0.3);
        if (grow >= 1) mode = "hold";
      }
      if (mode === "gulp") gulpT += dt;

      // ---- simulate ----
      const spreadPx = Math.max(14, Math.min(pill.w * 0.3, D * 0.4 + 14)) * (seeking ? 0.65 : 1);
      let alive = 0;
      for (const st of list) {
        const target = near.s + st.spread * spreadPx;
        st.s += loopDiff(st.s, target) * Math.min(1, dt * (mode === "snap" ? 1.5 : 6));
        const root = at(st.s);
        const rx = root.x - root.nx * 3, ry = root.y - root.ny * 3;
        let pinTip = false;
        const gp = gripAt(st.grip);
        if (seeking) {
          // a pseudopod reaching for the pointer: part of the way there, feeling about as it goes
          const vx = gp.x - rx, vy = gp.y - ry;
          const vl = Math.hypot(vx, vy) || 1;
          const ease = seekF * seekF * (3 - 2 * seekF);
          // it hesitates, then darts a little further, then draws back, like it is testing the air
          const dart = Math.pow(Math.max(0, Math.sin(time * 1.9 + st.phase * 3.1)), 10) * 0.28;
          const len = Math.max(3, vl * st.reachK * 0.85 * ease * (1 + dart));
          const sway = Math.sin(time * 2.7 + st.phase) * (3 + 9 * ease) + Math.sin(time * 5.3 + st.phase * 2) * 2 * ease;
          const tx = rx + (vx / vl) * len - (vy / vl) * sway;
          const ty = ry + (vy / vl) * len + (vx / vl) * sway;
          const k = 1 - Math.exp(-dt * 6);
          st.ex += (tx - st.ex) * k;
          st.ey += (ty - st.ey) * k;
          pinTip = true;
          st.seg = (Math.hypot(st.ex - rx, st.ey - ry) * (st.slack + 0.06)) / (NP - 1);
        } else if (holding) {
          // lunge for the pointer and coil in around it, then hold on and trail it like syrup
          let gx = gp.x, gy = gp.y;
          if (mode === "grow") {
            const coil = Math.pow(1 - grow, 1.6) * (st.hair ? 7 : 13);
            const a = st.phase + grow * Math.PI * 2.6;
            gx += Math.cos(a) * coil;
            gy += Math.sin(a) * coil * 0.8;
          }
          const k = 1 - Math.exp(-dt * (mode === "grow" ? 20 + st.follow : st.follow * 1.4));
          st.ex += (gx - st.ex) * k;
          st.ey += (gy - st.ey) * k;
          pinTip = true;
          st.seg = (Math.hypot(st.ex - rx, st.ey - ry) * st.slack) / (NP - 1);
        } else {
          // reel back in, slowly, like something heavy; a gulp slurps it in at once
          st.seg *= Math.exp(-dt * (mode === "gulp" ? 16 : 5.5));
          if (st.seg * (NP - 1) > 1.5) alive++;
        }
        const damp = mode === "gulp" ? 0.8 : mode === "snap" ? 0.86 : 0.92;
        for (let i = 1; i < NP; i++) {
          const vx = (st.x[i] - st.px[i]) * damp, vy = (st.y[i] - st.py[i]) * damp;
          st.px[i] = st.x[i]; st.py[i] = st.y[i];
          const mid = Math.sin((i / (NP - 1)) * Math.PI);
          const wx = Math.sin(time * 1.6 + st.phase + i * 0.55) * 14 * mid;
          const wy = Math.cos(time * 1.3 + st.phase * 1.3 + i * 0.45) * 14 * mid;
          st.x[i] += vx + wx * dt * dt;
          st.y[i] += vy + (260 + wy) * dt * dt;
        }
        st.x[0] = st.px[0] = rx; st.y[0] = st.py[0] = ry;
        if (pinTip) { st.x[NP - 1] = st.ex; st.y[NP - 1] = st.ey; }
        const len = Math.max(0.01, st.seg);
        for (let it = 0; it < 14; it++) {
          for (let i = 0; i < NP - 1; i++) {
            const dx = st.x[i + 1] - st.x[i], dy = st.y[i + 1] - st.y[i];
            const d = Math.hypot(dx, dy) || 0.0001;
            const diff = (d - len) / d;
            const a = i === 0 ? 0 : 0.5, b = pinTip && i + 1 === NP - 1 ? 0 : i === 0 ? 1 : 0.5;
            const m = a + b || 1;
            st.x[i] += dx * diff * (a / m); st.y[i] += dy * diff * (a / m);
            st.x[i + 1] -= dx * diff * (b / m); st.y[i + 1] -= dy * diff * (b / m);
          }
        }
        // a little bending stiffness, so a strand curves like goo instead of folding into kinks
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 1; i < NP - 1; i++) {
            st.x[i] += ((st.x[i - 1] + st.x[i + 1]) / 2 - st.x[i]) * 0.22;
            st.y[i] += ((st.y[i - 1] + st.y[i + 1]) / 2 - st.y[i]) * 0.22;
          }
        }
        if (!Number.isFinite(st.x[NP - 1])) { st.x.fill(rx); st.y.fill(ry); st.px.fill(rx); st.py.fill(ry); }
      }
      // after a gulp it rests until the ripple has run, then (if the mouse is still there) reaches again
      if ((mode === "snap" || (mode === "gulp" && gulpT > RIPPLE + 0.2)) && alive === 0) { mode = "idle"; list = []; webs = []; }

      // mound spring
      const moundTarget = holding ? 5 + 16 * stretch : seeking ? 3 + 9 * seekF : 0;
      moundV += ((moundTarget - mound) * 150 - moundV * 9) * dt;
      mound += moundV * dt;
      if (holding || seeking) {
        moundS += loopDiff(moundS, near.s) * Math.min(1, dt * 6);
        const e = at(moundS);
        const tx = ptr.x - e.x, ty = ptr.y - e.y, tl = Math.hypot(tx, ty) || 1;
        moundDir = { x: e.nx * 0.55 + (tx / tl) * 0.45, y: e.ny * 0.55 + (ty / tl) * 0.45 };
      }

      // the iris turns toward the pointer as the goo reaches for it, and the pupil widens once it has hold
      eyeBusy = false;
      if (iris && pupil && ball) {
        const b = ball.getBoundingClientRect();
        const look = holding ? 1 : seeking ? seekF : 0;
        let tx = 0, ty = 0;
        const dx = ptr.x - (b.left + b.width / 2), dy = ptr.y - (b.top + b.height / 2);
        if (look > 0) {
          const dl = Math.hypot(dx, dy) || 1;
          // it stays clear of the white's rim
          const reach = Math.min(Math.max(0, b.width / 2 - iris.offsetWidth / 2 - 2), dl * 0.5) * look;
          tx = (dx / dl) * reach; ty = (dy / dl) * reach;
        }
        if (eye) {
          const watching = look > 0.35;
          const side = !watching ? 0 : dx < 0 ? -1 : 1;
          if (side !== eyeSide) {
            eyeSide = side;
            if (side === 0) {
              eye.style.animation = "";
              eye.style.transform = "";
            } else {
              eye.style.animation = "none";
              // Mirrored art: the thick end faces the pointer, the point trails the other way.
              eye.style.transform = side < 0 ? "rotate(-14deg) scale(1.04)" : "scaleX(-1) rotate(-14deg) scale(1.04)";
            }
          }
        }
        // a slightly springy follow, so the eye darts and settles instead of sliding
        eyeVX += ((tx - eyeX) * 320 - eyeVX * 24) * dt; eyeX += eyeVX * dt;
        eyeVY += ((ty - eyeY) * 320 - eyeVY * 24) * dt; eyeY += eyeVY * dt;
        dilate += ((holding ? 1.5 : 1) - dilate) * Math.min(1, dt * 10);
        eyeBusy = Math.abs(eyeX) + Math.abs(eyeY) + Math.abs(eyeVX) + Math.abs(eyeVY) > 0.05 || Math.abs(dilate - 1) > 0.005;
      }

      for (let k = spikes.length - 1; k >= 0; k--) {
        const sp = spikes[k];
        const born = sp.age < 0 && sp.age + dt >= 0;
        sp.age += dt;
        if (born && sp.drop && drops.length < MDROP) {
          // the two halves of the ripple meet here and flick a drop off, which falls back in
          const b = at(sp.s);
          drops.push({ x: b.x + b.nx * 6, y: b.y + b.ny * 6, vx: b.nx * 70, vy: b.ny * 70 - 90, r: 2.8, age: 0 });
        }
        if (sp.age > sp.life) spikes.splice(k, 1);
      }
      for (let k = drops.length - 1; k >= 0; k--) {
        const d = drops[k];
        d.age += dt;
        d.vy += 520 * dt;
        d.vx *= Math.exp(-dt * 2); d.vy *= Math.exp(-dt * 1);
        d.x += d.vx * dt; d.y += d.vy * dt;
        d.r *= Math.exp(-dt * 1.5);
        if (d.age > 0.9 || edgeDist(d.x, d.y) < -d.r) drops.splice(k, 1);
      }

      // ---- upload to the shader ----
      const thin = 1 - 0.5 * stretch;
      const mains = list.filter((s) => !s.hair).slice(0, MS);
      let minX = pill.x, minY = pill.y, maxX = pill.x + pill.w, maxY = pill.y + pill.h;
      const grow2 = seeking ? 0.55 + 0.45 * seekF : 1;
      mains.forEach((st, si) => {
        for (let i = 0; i < NP; i++) {
          const f = i / (NP - 1);
          // thick where it leaves the body, a fine thread at the pointer
          let r = (st.width * (3.0 - 1.9 * f)) * thin * grow2;
          // a slow pulse travels from the body toward the pointer, as if it is feeding
          if (holding) r *= 1 + 0.24 * Math.sin(f * 9 - time * 6 + st.phase) * Math.sin(f * Math.PI);
          if (mode === "snap" || mode === "gulp") r *= 1.15; // gathering up as it slumps back
          const o = (si * NP + i) * 4;
          pts[o] = st.x[i]; pts[o + 1] = st.y[i]; pts[o + 2] = Math.max(0.55, r); pts[o + 3] = 1;
          minX = Math.min(minX, st.x[i]); maxX = Math.max(maxX, st.x[i]);
          minY = Math.min(minY, st.y[i]); maxY = Math.max(maxY, st.y[i]);
        }
      });
      spk.fill(0); spkR.fill(0);
      spikes.forEach((sp, k) => {
        if (sp.age < 0) return;
        const p = sp.age / sp.life;
        const up = p < 0.15 ? 1 - Math.pow(1 - p / 0.15, 3) : p > 0.45 ? Math.max(0, 1 - (p - 0.45) / 0.55) : 1;
        const len = sp.len * (p > 0.45 ? up * up * (3 - 2 * up) : up);
        const b = at(sp.s);
        const sway = Math.sin(sp.age * 14) * Math.exp(-sp.age * 3) * 0.35;
        const ang = Math.atan2(b.ny, b.nx) + sp.tilt + sway;
        const tx = b.x + Math.cos(ang) * len, ty = b.y + Math.sin(ang) * len;
        spk[k * 4] = b.x - b.nx * 2; spk[k * 4 + 1] = b.y - b.ny * 2; spk[k * 4 + 2] = tx; spk[k * 4 + 3] = ty;
        spkR[k * 4] = sp.r * Math.min(1, up + 0.2); spkR[k * 4 + 1] = len > 0.6 ? 1 : 0;
        minX = Math.min(minX, tx); maxX = Math.max(maxX, tx); minY = Math.min(minY, ty); maxY = Math.max(maxY, ty);
      });
      drp.fill(0);
      drops.forEach((d, k) => {
        drp[k * 4] = d.x; drp[k * 4 + 1] = d.y; drp[k * 4 + 2] = d.r; drp[k * 4 + 3] = 1;
        minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x); minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
      });
      const me = at(moundS);
      const mlen = Math.max(0, mound);
      const mr = mlen > 0.3 ? (9 + spreadPx * 0.32) * Math.min(1, mound / 6) : 0;
      const mtx = me.x + moundDir.x * mlen, mty = me.y + moundDir.y * mlen;

      const g = gl!;
      g.uniform2f(U.uRes, glc!.width, glc!.height);
      g.uniform1f(U.uDpr, dpr);
      g.uniform4f(U.uPill, pill.x, pill.y, pill.w, pill.h);
      g.uniform4fv(U.uPts, pts);
      g.uniform1f(U.uCount, mains.length);
      g.uniform4fv(U.uSpk, spk);
      g.uniform4fv(U.uSpkR, spkR);
      g.uniform4fv(U.uDrop, drp);
      g.uniform4f(U.uMound, me.x - me.nx * 6, me.y - me.ny * 6, mtx, mty);
      g.uniform2f(U.uMoundR, mr, mr * 0.45);
      g.uniform4f(U.uColor, color[0], color[1], color[2], color[3]);
      // only shade the box around the goo
      const pad = 24;
      const x0 = Math.max(0, minX - pad), x1 = Math.min(w, maxX + pad), y0 = Math.max(0, minY - pad), y1 = Math.min(h, maxY + pad);
      if (x1 > x0 && y1 > y0) {
        const X = (v: number) => (v / w) * 2 - 1, Y = (v: number) => 1 - (v / h) * 2;
        quadData.set([X(x0), Y(y0), X(x1), Y(y0), X(x0), Y(y1), X(x1), Y(y1)]);
        g.bufferData(g.ARRAY_BUFFER, quadData, g.DYNAMIC_DRAW);
        g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      }

      // ---- fine hairs and web threads in 2D, kept off the button's face ----
      const c = fx!;
      if (list.length && (holding || mode === "snap" || mode === "gulp")) {
        c.save();
        c.beginPath();
        c.rect(0, 0, w, h);
        c.roundRect(pill.x, pill.y, pill.w, pill.h, pill.r);
        c.clip("evenodd");
        c.lineCap = "round";
        c.lineJoin = "round";
        c.strokeStyle = colorCss;
        c.globalAlpha = 0.9;
        for (const st of list) {
          if (!st.hair) continue;
          c.lineWidth = 0.7 * thin;
          c.beginPath();
          c.moveTo(st.x[0], st.y[0]);
          for (let i = 1; i < NP - 1; i++) c.quadraticCurveTo(st.x[i], st.y[i], (st.x[i] + st.x[i + 1]) / 2, (st.y[i] + st.y[i + 1]) / 2);
          c.lineTo(st.x[NP - 1], st.y[NP - 1]);
          c.stroke();
        }
        if (mode === "hold") {
          c.globalAlpha = 0.6;
          c.lineWidth = 0.5;
          for (const [a, b, i, j, kink] of webs) {
            const A = list[a], Bs = list[b];
            if (!A || !Bs) continue;
            c.beginPath();
            c.moveTo(A.x[i], A.y[i]);
            c.lineTo((A.x[i] + Bs.x[j]) / 2 + kink, (A.y[i] + Bs.y[j]) / 2 - Math.abs(kink) * 0.4);
            c.lineTo(Bs.x[j], Bs.y[j]);
            c.stroke();
          }
        }
        c.restore();
      }

      return mode !== "idle" || eyeBusy || spikes.length > 0 || drops.length > 0 || Math.abs(mound) > 0.05 || Math.abs(moundV) > 0.05;
    };

    const commit = () => {
      if (!iris || !pupil) return;
      iris.style.transform = eyeBusy ? `translate(${eyeX.toFixed(2)}px, ${eyeY.toFixed(2)}px)` : "";
      pupil.style.transform = eyeBusy ? `scale(${dilate.toFixed(3)})` : "";
    };

    return { draw, commit, gulp };
  };

  // ---- loop: runs only while some button is busy ----
  let raf = 0;
  let prev = 0;
  const frame = (now: number) => {
    const dt = Math.max(1 / 240, Math.min(0.033, (now - prev) / 1000));
    prev = now;
    const hunter = target();
    if (hunter && !goos.has(hunter)) goos.set(hunter, createGoo(hunter));
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    fx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    fx!.clearRect(0, 0, w, h);
    const settled = [...goos].filter(([el, goo]) => !goo.draw(now, dt, el === hunter));
    for (const goo of goos.values()) goo.commit();
    for (const [el] of settled) goos.delete(el);
    raf = goos.size ? requestAnimationFrame(frame) : 0;
    if (!raf) show(false);
  };
  const start = () => {
    if (raf) return;
    show(true);
    prev = performance.now();
    raf = requestAnimationFrame(frame);
  };

  // Wakes the loop when the mouse comes within SENSE of a button.
  const wake = () => {
    if (!raf && target() && init()) start();
  };

  const place = (e: PointerEvent) => {
    ptr.x = e.clientX;
    ptr.y = e.clientY;
    ptr.inside = true;
    wake();
  };
  addEventListener(
    "pointermove",
    (e) => {
      if (e.pointerType === "touch") {
        if (!ptr.down || !e.isPrimary) return;
        ptr.touch = true;
      } else ptr.touch = false;
      place(e);
    },
    { passive: true },
  );
  addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      ptr.touch = true;
      ptr.down = true;
      place(e);
    },
    { passive: true },
  );
  const lift = (e: PointerEvent) => {
    if (e.pointerType !== "touch" || !e.isPrimary || !ptr.down) return;
    ptr.down = false;
    ptr.upAt = performance.now();
    // the browser took the gesture to scroll the page: let go straight away
    if (e.type === "pointercancel") ptr.inside = false;
  };
  addEventListener("pointerup", lift, { passive: true });
  addEventListener("pointercancel", lift, { passive: true });
  for (const el of buttons) {
    el.addEventListener("pointerdown", (e) => {
      if (!e.isPrimary || e.button !== 0 || reducedMotion.matches || !init()) return;
      let goo = goos.get(el);
      if (!goo) goos.set(el, (goo = createGoo(el)));
      goo.gulp(e.clientX, e.clientY);
      start();
    });
  }
  // a mouse that leaves the window sends no more moves, so without this the goo would keep holding
  document.documentElement.addEventListener("mouseleave", () => { if (!ptr.touch) ptr.inside = false; });
  // the page can scroll a button under a resting mouse
  addEventListener("scroll", wake, { passive: true });
  addEventListener("resize", fit, { passive: true });

  // Build the shader ahead of time, once the page has loaded and the browser is idle.
  if (!reducedMotion.matches) {
    const whenIdle = () => ("requestIdleCallback" in window ? requestIdleCallback(prepare, { timeout: 4000 }) : setTimeout(prepare, 1500));
    if (document.readyState === "complete") whenIdle();
    else addEventListener("load", whenIdle, { once: true });
  }
}
