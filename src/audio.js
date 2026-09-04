// Flippin' Waffles — procedural WebAudio sound effects & cozy chiptune music
window.FW = window.FW || {};

FW.Audio = (() => {
  let ctx = null, master, musicGain, sfxGain, noiseBuf;
  let muted = false, engine = null, grind = null, sizzleNode = null;
  let music = { song: null, timer: null, nextTime: 0, step: 0 };

  function init() {
    if (ctx) return;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ctx.destination);
    musicGain = ctx.createGain(); musicGain.gain.value = 0.3; musicGain.connect(master);
    sfxGain = ctx.createGain(); sfxGain.gain.value = 0.9; sfxGain.connect(master);
    const len = ctx.sampleRate * 2; noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }
  function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ctx.currentTime, 0.05); }
  const ok = () => !!ctx;

  function env(g, t0, a, d, peak = 1, sustain = 0) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + a);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustain), t0 + a + d);
  }
  function tone(freq, dur, type = 'square', vol = 0.15, opts = {}) {
    if (!ok()) return;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    env(g, t0, opts.attack || 0.005, dur, vol);
    let node = o;
    if (opts.filter) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = opts.filter; f.Q.value = opts.q || 4; o.connect(f); node = f; }
    node.connect(g); g.connect(opts.dest || sfxGain);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, vol = 0.2, opts = {}) {
    if (!ok()) return;
    const t0 = ctx.currentTime + (opts.delay || 0);
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = opts.type || 'lowpass'; f.frequency.setValueAtTime(opts.freq || 1200, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q || 1;
    const g = ctx.createGain(); env(g, t0, opts.attack || 0.01, dur, vol);
    s.connect(f); f.connect(g); g.connect(sfxGain);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  // ---- SFX ----
  const sfx = {
    quack() { tone(420, 0.13, 'sawtooth', 0.22, { to: 300, filter: 1100, q: 3 }); tone(360, 0.16, 'sawtooth', 0.2, { to: 250, filter: 900, q: 3, delay: 0.14 }); },
    ding() { tone(1320, 0.5, 'sine', 0.18); tone(1760, 0.7, 'sine', 0.12, { delay: 0.06 }); },
    bonk() { tone(170, 0.16, 'triangle', 0.35, { to: 70 }); noise(0.1, 0.18, { freq: 900 }); },
    flip() { noise(0.28, 0.2, { type: 'bandpass', freq: 500, to: 2400, q: 1.5 }); tone(500, 0.2, 'sine', 0.08, { to: 1000 }); },
    boost(stage = 1) { tone(280 + stage * 60, 0.35, 'sawtooth', 0.14, { to: 900 + stage * 150, filter: 1500, q: 1 }); noise(0.3, 0.1, { type: 'bandpass', freq: 800, to: 3000 }); },
    spark(stage) { tone([700, 900, 1200, 1500][stage] || 700, 0.08, 'square', 0.08); },
    growl() { tone(95, 0.55, 'sawtooth', 0.3, { to: 70, filter: 350, q: 2 }); tone(140, 0.4, 'sawtooth', 0.15, { to: 90, filter: 500, q: 2, delay: 0.05 }); },
    coin() { tone(988, 0.08, 'square', 0.12); tone(1319, 0.3, 'square', 0.12, { delay: 0.08 }); },
    splash() { noise(0.4, 0.3, { freq: 1400, to: 300 }); tone(220, 0.25, 'sine', 0.2, { to: 70 }); },
    land() { tone(130, 0.12, 'sine', 0.3, { to: 55 }); noise(0.08, 0.1, { freq: 500 }); },
    hop() { tone(380, 0.12, 'sine', 0.12, { to: 760 }); },
    pour() { noise(0.6, 0.15, { freq: 700, to: 300 }); },
    pop() { tone(620, 0.06, 'sine', 0.12, { to: 900 }); },
    thud() { tone(90, 0.2, 'sine', 0.3, { to: 40 }); },
    add() { tone(520, 0.07, 'triangle', 0.15, { to: 700 }); },
    whoosh() { noise(0.35, 0.15, { type: 'bandpass', freq: 300, to: 1800 }); },
    trick() { tone(600, 0.1, 'square', 0.1, { to: 1200 }); tone(900, 0.12, 'square', 0.08, { to: 1500, delay: 0.08 }); },
    happy() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, 'triangle', 0.13, { delay: i * 0.09 })); },
    sad() { [440, 415, 370].forEach((f, i) => tone(f, 0.25, 'triangle', 0.12, { delay: i * 0.18 })); },
    bell() { tone(880, 0.6, 'sine', 0.15); tone(1108, 0.6, 'sine', 0.1, { delay: 0.02 }); tone(1320, 0.8, 'sine', 0.08, { delay: 0.04 }); },
    stamp() { tone(200, 0.08, 'square', 0.15, { to: 120 }); noise(0.06, 0.15, { freq: 2000 }); },
    fanfare() { [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, 0.22, 'square', 0.1, { delay: i * 0.11 })); },
    boing() { tone(180, 0.35, 'sine', 0.28, { to: 900 }); tone(90, 0.3, 'triangle', 0.16, { to: 420, delay: 0.02 }); },
    chime() { [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, 0.35, 'sine', 0.11, { delay: i * 0.045 })); },
    plop() { tone(300, 0.1, 'sine', 0.2, { to: 620 }); noise(0.06, 0.07, { freq: 1600 }); },
    pick() { tone(720, 0.06, 'triangle', 0.12, { to: 980 }); },
    stir() { noise(0.09, 0.05, { type: 'bandpass', freq: 1100 + Math.random() * 700, q: 3 }); },
    note(i) { const sc = [523, 587, 659, 784, 880, 1047, 1175]; tone(sc[Math.min(i, sc.length - 1)], 0.16, 'triangle', 0.14); tone(sc[Math.min(i, sc.length - 1)] * 2, 0.1, 'sine', 0.05, { delay: 0.02 }); },
    sparkle() { for (let i = 0; i < 4; i++) tone(1200 + i * 380, 0.12, 'sine', 0.06, { delay: i * 0.035 }); },
    horn() { tone(392, 0.22, 'square', 0.13); tone(494, 0.22, 'square', 0.11, { delay: 0.01 }); },
    clack() { tone(240, 0.09, 'square', 0.16, { to: 150 }); noise(0.05, 0.1, { freq: 2500 }); },
  };

  // ---- continuous: engine / grind / sizzle ----
  function setEngine(on, speedFrac = 0, throttle = 0) {
    if (!ok()) return;
    if (!engine) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'square'; o2.frequency.value = 30;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 400;
      const g = ctx.createGain(); g.gain.value = 0;
      o.connect(f); o2.connect(f); f.connect(g); g.connect(sfxGain); o.start(); o2.start();
      engine = { o, o2, f, g };
    }
    const t = ctx.currentTime;
    const target = on ? 0.035 + 0.05 * throttle + 0.02 * speedFrac : 0;
    engine.g.gain.setTargetAtTime(target, t, 0.08);
    engine.o.frequency.setTargetAtTime(55 + 150 * speedFrac, t, 0.1);
    engine.o2.frequency.setTargetAtTime(27 + 75 * speedFrac, t, 0.1);
    engine.f.frequency.setTargetAtTime(350 + 1400 * speedFrac, t, 0.1);
  }
  function setGrind(on) {
    if (!ok()) return;
    if (!grind) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(sfxGain); s.start();
      grind = { g };
    }
    grind.g.gain.setTargetAtTime(on ? 0.12 : 0, ctx.currentTime, 0.05);
  }
  function setSizzle(level) {
    if (!ok()) return;
    if (!sizzleNode) {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      const g = ctx.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(sfxGain); s.start();
      sizzleNode = { g };
    }
    sizzleNode.g.gain.setTargetAtTime(0.06 * level, ctx.currentTime, 0.1);
  }

  // ---- music ----
  // scale degrees in C major pentatonic-ish; null = rest
  const SONGS = {
    kitchen: {
      bpm: 88, bass: [0, 0, 5, 5, 3, 3, 4, 4], // chord roots (C, C, A, A, F, F, G, G) as scale degrees
      melody: [4, null, 2, 4, 7, null, 4, null, 2, null, 0, 2, 4, null, null, null, 4, null, 5, 4, 2, null, 0, null, 2, 4, 2, 0, null, null, null, null],
      lead: 'triangle', hat: 0.02,
    },
    ride: {
      bpm: 132, bass: [0, 0, 4, 4, 5, 5, 3, 3],
      melody: [0, 2, 4, 7, 4, 2, 0, null, 4, 5, 7, 9, 7, 5, 4, null, 2, 4, 5, 7, 5, 4, 2, null, 7, 9, 11, 12, 11, 9, 7, null],
      lead: 'square', hat: 0.05,
    },
  };
  const SCALE = [0, 2, 4, 5, 7, 9, 11];
  const degFreq = (deg, oct = 0) => 261.63 * Math.pow(2, (SCALE[((deg % 7) + 7) % 7] + 12 * (Math.floor(deg / 7) + oct)) / 12);
  function scheduleStep(song, t, step) {
    const bar = Math.floor(step / 8) % song.bass.length;
    if (step % 4 === 0) { // bass on beats
      tone(degFreq(song.bass[bar], -2), 0.4, 'sine', 0.22, { delay: t - ctx.currentTime, dest: musicGain });
      tone(degFreq(song.bass[bar], -1), 0.3, 'triangle', 0.06, { delay: t - ctx.currentTime, dest: musicGain });
    }
    if (step % 4 === 2 && song.hat) noise(0.05, song.hat, { type: 'highpass', freq: 6000, delay: t - ctx.currentTime });
    const m = song.melody[step % song.melody.length];
    if (m !== null) tone(degFreq(m, 1), 0.28, song.lead, song.lead === 'square' ? 0.05 : 0.09, { delay: t - ctx.currentTime, dest: musicGain, attack: 0.01 });
    if (step % 8 === 4) tone(degFreq(song.bass[bar] + 2, 0), 0.5, 'sine', 0.05, { delay: t - ctx.currentTime, dest: musicGain });
  }
  function playMusic(name) {
    if (!ok()) return;
    if (music.song === name) return;
    stopMusic();
    const song = SONGS[name]; if (!song) return;
    music.song = name; music.step = 0; music.nextTime = ctx.currentTime + 0.1;
    const stepDur = 60 / song.bpm / 2;
    music.timer = setInterval(() => {
      if (!ctx) return;
      while (music.nextTime < ctx.currentTime + 0.35) { scheduleStep(song, music.nextTime, music.step); music.step++; music.nextTime += stepDur; }
    }, 100);
  }
  function stopMusic() { if (music.timer) clearInterval(music.timer); music.timer = null; music.song = null; }

  return { init, resume, setMuted, get muted() { return muted; }, sfx, setEngine, setGrind, setSizzle, playMusic, stopMusic, get ready() { return !!ctx; } };
})();
