// Flippin' Waffles — shared utilities (math, RNG, noise, tiny event bus, input)
window.FW = window.FW || {};

FW.U = (() => {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const angleDiff = (a, b) => (((b - a + Math.PI) % TAU) + TAU) % TAU - Math.PI;
  const angleLerp = (a, b, t) => a + angleDiff(a, b) * t;
  const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  // mulberry32 seeded RNG
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash2(x, y) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + 0x9e3779b9;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  }
  function fbm(x, y, oct = 3) {
    let s = 0, amp = 1, f = 1, n = 0;
    for (let i = 0; i < oct; i++) { s += vnoise(x * f + i * 17.3, y * f - i * 9.1) * amp; n += amp; amp *= 0.5; f *= 2.07; }
    return s / n;
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const shuffle = (r, arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const fmtTime = (s) => { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  return { TAU, clamp, lerp, smoothstep, angleDiff, angleLerp, damp, easeOut, easeInOut, rng, hash2, vnoise, fbm, pick, shuffle, fmtTime };
})();

FW.events = (() => {
  const map = new Map();
  return {
    on(name, fn) { if (!map.has(name)) map.set(name, []); map.get(name).push(fn); return () => this.off(name, fn); },
    off(name, fn) { const l = map.get(name); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(name, data) { const l = map.get(name); if (l) for (const fn of l.slice()) fn(data); },
  };
})();

// Keyboard/mouse input with edge detection
FW.Input = (() => {
  const down = new Set();
  const pressed = new Set();
  const MAP = {
    up: ['KeyW', 'ArrowUp'], down: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    hop: ['Space'], trick: ['ShiftLeft', 'ShiftRight', 'KeyE'], honk: ['KeyH'], pause: ['Escape'], reset: ['KeyR'], mute: ['KeyM'],
    enter: ['Enter', 'NumpadEnter'], flip: ['Space', 'KeyF'],
  };
  const mouse = { x: 0, y: 0, nx: 0, ny: 0, down: false, clicked: false, moved: false };
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    down.add(e.code); pressed.add(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
  const updMouse = (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.nx = (e.clientX / window.innerWidth) * 2 - 1; mouse.ny = -(e.clientY / window.innerHeight) * 2 + 1; mouse.moved = true; };
  window.addEventListener('mousemove', updMouse);
  window.addEventListener('mousedown', (e) => { if (e.button !== 0) return; updMouse(e); mouse.down = true; mouse.clicked = true; });
  window.addEventListener('mouseup', () => (mouse.down = false));
  window.addEventListener('touchstart', (e) => { const t = e.touches[0]; if (t) { updMouse(t); mouse.down = true; mouse.clicked = true; } }, { passive: true });
  window.addEventListener('touchmove', (e) => { const t = e.touches[0]; if (t) updMouse(t); }, { passive: true });
  window.addEventListener('touchend', () => (mouse.down = false));
  const anyDown = (codes) => codes.some((c) => down.has(c));
  const anyPressed = (codes) => codes.some((c) => pressed.has(c));
  // on-screen controls feed the same actions as the keyboard
  const virtual = { steer: 0, throttle: 0 };
  const vHeld = new Set(), vPressed = new Set();
  return {
    mouse, virtual,
    held: (name) => anyDown(MAP[name]) || vHeld.has(name),
    pressed: (name) => anyPressed(MAP[name]) || vPressed.has(name),
    axis() { const k = (anyDown(MAP.right) ? 1 : 0) - (anyDown(MAP.left) ? 1 : 0); return k || virtual.steer; },
    throttle() { const k = (anyDown(MAP.up) ? 1 : 0) - (anyDown(MAP.down) ? 1 : 0); return k || virtual.throttle; },
    setHeld(name, on) { if (on) { if (!vHeld.has(name)) vPressed.add(name); vHeld.add(name); } else vHeld.delete(name); },
    press(name) { vPressed.add(name); },
    endFrame() { pressed.clear(); vPressed.clear(); mouse.clicked = false; mouse.moved = false; },
    clear() { down.clear(); pressed.clear(); vHeld.clear(); vPressed.clear(); virtual.steer = 0; virtual.throttle = 0; },
  };
})();
