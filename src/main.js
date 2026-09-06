// Flippin' Waffles — game states, loop, HUD glue, saving
(() => {
  const U = FW.U, HUD = FW.HUD, A = FW.Audio, W = FW.World, Inp = FW.Input;
  const canvas = document.getElementById('game');
  const renderer = FW.Pixel.init(canvas);
  const worldScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FW.Pixel.fitFov(62), FW.Pixel.size.aspect, 0.1, 1500);
  // Rides with the menu camera so the wombat is always lit on the shot; off
  // during play, where the valley's own light does the work.
  const titleFill = new THREE.DirectionalLight('#ffeccb', 0);
  const { fx } = W.build(worldScene);
  worldScene.add(titleFill, titleFill.target);
  const kart = new FW.Kart(worldScene);
  const bears = new FW.Bears(worldScene, W, fx);
  const kitchen = new FW.Kitchen();
  HUD.minimapInit(W.minimap);
  const TOUCH = HUD.isTouch();
  FW.events.on('resize', (s) => {
    camera.aspect = s.aspect; camera.updateProjectionMatrix();
    kitchen.camera.aspect = s.aspect; kitchen.camera.updateProjectionMatrix();
    // re-fit the vertical fov for the new shape (portrait phones especially)
    FW.Pixel.setFov(camera, kart && kart.cam ? kart.cam.fov : 62);
    FW.Pixel.setFov(kitchen.camera, kitchen.camFov);
  });

  const SAVE_KEY = 'flippinWaffles.save.v1';
  const defaultSave = () => ({ day: 1, coins: 0, rep: 3, delivered: 0, orderIndex: 0, bestTip: 0, tricks: 0, bearsHonked: 0 });
  let save = defaultSave();
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s && s.day) save = Object.assign(defaultSave(), s); } catch (e) { /* no storage */ }
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };

  const G = { state: 'title', order: null, results: [], stolen: 0, timer: 0, timerMax: 0, cookLeft: 1, modal: false, paused: false, dayOrders: 3, dayCoins: 0, dayLog: [], hype: 0, tokens: 0, messes: 0, titleT: 0, deliverT: 0, muted: false };
  const START = { x: 0, z: 62, yaw: 0 };
  const destInfo = () => { const o = {}; for (const [id, d] of Object.entries(W.destinations)) o[id] = { name: d.name, x: d.x, z: d.z, dist: d.dist }; return o; };
  FW.Orders.seed(1000 + save.day * 7 + save.orderIndex);

  // ---------- title ----------
  function showTitle() {
    G.state = 'title'; HUD.hideAll(); HUD.title(true, save.delivered ? `Welcome back! Day ${save.day} · ${save.coins} coins · ${save.delivered} deliveries` : 'New game — cozy mode: no fail states, just waffles');
    kart.reset(START.x, START.z, START.yaw); kart.controllable = false; kart.setBoxVisible(true);
    W.setDelivery(null); W.setTimeOfDay(0.46);   // brightest stop, so the menu shot reads
    document.getElementById('game').style.cursor = 'default';
  }
  function startGame() {
    titleFill.intensity = 0;
    A.init(); A.resume();
    HUD.title(false);
    if (save.orderIndex >= G.dayOrders) { save.orderIndex = 0; save.day++; }
    nextOrder();
  }
  document.getElementById('start').addEventListener('click', (e) => { e.stopPropagation(); if (G.state === 'title') startGame(); });

  // ---------- kitchen ----------
  function nextOrder() {
    G.order = FW.Orders.makeOrder(save.day, save.orderIndex, destInfo());
    G.results = []; G.stolen = 0;
    W.setTimeOfDay([0.22, 0.5, 0.82][save.orderIndex % 3]);   // never full dusk on a delivery
    G.state = 'kitchen'; G.timer = G.timerMax = G.order.cookTime;
    HUD.touchControls(false); HUD.mess(0); HUD.data.nav = null;
    HUD.hideAll(); HUD.stats(save); HUD.ticket(G.order, { index: 0, made: [], counts: { flour: 0, sugar: 0, egg: 0, milk: 0 }, toppings: new Set() });
    kitchen.onProgress = (p) => HUD.ticket(G.order, p);
    kitchen.onDone = (made, messCount) => { G.results = made; G.messes = messCount || 0; G.cookLeft = U.clamp(G.timer / G.timerMax, 0, 1); setTimeout(startRide, 600); };
    kitchen.startOrder(G.order);
    A.playMusic('kitchen');
    document.getElementById('game').style.cursor = 'crosshair';
    HUD.popup(`New order from ${G.order.customer.name}!`, 'mint');
  }

  // ---------- ride ----------
  async function startRide() {
    await HUD.fade(1, 0.5);
    HUD.hideAll(); HUD.stats(save);
    kart.reset(START.x, START.z, START.yaw); kart.controllable = true; kart.trickPoints = 0; kart.coins = 0; kart.events.length = 0; kart.setBoxVisible(true);
    W.resetPickups();
    W.setDelivery(G.order.dest.id); W.spawnCustomer(G.order);
    G.state = 'ride'; G.timer = G.timerMax = G.order.rideTime; G.hype = 0;
    HUD.ticket(G.order, { index: G.order.waffles.length, made: G.results });
    HUD.waffles(true, G.order.waffles.length, 0);
    HUD.hint(`Deliver to <b>${HUD.esc(G.order.dest.name)}</b>! Space = hop/drift · Shift = trick in the air · H = honk at bears`);
    A.playMusic('ride');
    HUD.touchControls(TOUCH);
    document.getElementById('game').style.cursor = 'default';
    kart.updateCamera(0, camera, W);
    await HUD.fade(0, 0.5);
    setTimeout(() => HUD.hint(''), 9000);
  }
  function carrying() { return G.state === 'ride' ? Math.max(0, G.order.waffles.length - G.stolen) : 0; }
  function handleEvents() {
    for (const e of kart.events) {
      switch (e.type) {
        case 'honk': { const n = bears.honk(kart); if (n) { HUD.popup(n > 1 ? 'Bears scared off!' : 'Bear scared off!', 'mint small'); save.bearsHonked += n; } break; }
        case 'trickLand': HUD.popup(e.n > 1 ? `${e.n}x TRICK COMBO!` : 'Trick!', 'gold'); save.tricks += e.n; G.hype += e.n; break;
        case 'driftBoost': HUD.popup(['', 'Mini turbo!', 'Super turbo!', 'ULTRA TURBO!'][e.stage], e.stage === 3 ? 'gold' : 'mint'); break;
        case 'grindStart': HUD.popup('Grind!', 'mint small'); break;
        case 'grindEnd': HUD.popup(`Rail grind +${e.pts}`, 'gold'); G.hype += e.pts; break;
        case 'pad': HUD.popup('Zoom!', 'mint small'); break;
        case 'bounce': HUD.popup('BOING!', 'mint'); break;
        case 'ring': HUD.popup('Through the ring!', 'gold'); G.hype += 3; break;
        case 'token': G.tokens++; break;
        case 'bonk': HUD.popup('Bonk!', 'bad small'); break;
        case 'wipeout': HUD.popup('Ouch!', 'bad'); break;
        case 'wobble': HUD.popup('Wobbly landing', 'bad small'); break;
        case 'rescued': HUD.popup('A ranger fished you out!', 'mint'); break;
        case 'reset': HUD.popup('Back on the road', 'mint small'); break;
      }
    }
    kart.events.length = 0;
    for (const e of bears.events) {
      if (e.type === 'steal' && G.state === 'ride') { G.stolen = Math.min(G.order.waffles.length, G.stolen + 1); HUD.waffles(true, G.order.waffles.length, G.stolen); HUD.popup('A bear stole a waffle!', 'bad'); }
      else if (e.type === 'growl') HUD.popup('grrr…', 'bad small');
    }
    bears.events.length = 0;
  }
  function updateRide(dt) {
    kart.update(dt, Inp, W, fx);
    bears.update(dt, kart, carrying());
    handleEvents();
    if (G.state === 'ride' || G.state === 'home') G.timer = Math.max(0, G.timer - dt);
    const target = G.state === 'ride' ? W.destinations[G.order.dest.id] : { x: W.HOME.x, z: W.HOME.z, name: 'Waffle Shack', r: 10 };
    const dx = target.x - kart.pos.x, dz = target.z - kart.pos.z, dist = Math.hypot(dx, dz);
    const secs = dist / Math.max(6, Math.abs(kart.speed) * 0.75 + 6);
    HUD.nav(true, { angle: -Math.PI / 2 - U.angleDiff(kart.cam.yaw, Math.atan2(dx, dz)), name: target.name, dist, eta: secs < 60 ? `${Math.max(1, Math.round(secs))} sec` : `${Math.round(secs / 60)} min` });
    HUD.drift(true, Math.abs(kart.speed) * 3.6, kart.drift.active ? kart.drift.stage : 0, kart.boost > 0, '');
    HUD.data.style = kart.trickPoints; HUD.data.coins = kart.coins;
    updateMinimap(target);
    if (G.state === 'ride') HUD.timer(true, G.timer / G.timerMax, G.timer > 0 ? U.fmtTime(G.timer) : 'late… still tasty!');
    else HUD.timer(false);
    if (dist < (target.r || 7) && kart.controllable) { if (G.state === 'ride') deliver(); else arriveHome(); }
  }
  const mm = W.minimap;
  let routePts = null, routeAt = 0;
  function updateMinimap(target) {
    if (!mm) return;
    // recompute the route occasionally, like a nav app re-snapping to the road
    if (G.state === 'ride' && (!routePts || W.time - routeAt > 2.5)) {
      const r = W.route(kart.pos.x, kart.pos.z, G.order.dest.id);
      routePts = r ? r.map(([x, z]) => mm.toMap(x, z)) : null;
      routeAt = W.time;
    }
    if (G.state !== 'ride') routePts = null;
    HUD.minimap(true, {
      player: mm.toMap(kart.pos.x, kart.pos.z),
      yaw: kart.yaw,
      home: mm.toMap(W.HOME.x, W.HOME.z),
      dest: G.state === 'ride' ? mm.toMap(target.x, target.z) : null,
      route: routePts,
      bears: bears.list.filter((b) => !b.cub && Math.hypot(b.x - kart.pos.x, b.z - kart.pos.z) < 110).map((b) => mm.toMap(b.x, b.z)),
      cars: W.traffic.map((c) => mm.toMap(c.x, c.z)),
      tokens: W.tokens.filter((t) => !t.taken && Math.hypot(t.x - kart.pos.x, t.z - kart.pos.z) < 120).map((t) => mm.toMap(t.x, t.z)),
    });
  }
  function deliver() {
    G.state = 'delivering'; kart.controllable = false; G.deliverT = 0;
    A.sfx.ding(); const d = W.destinations[G.order.dest.id];
    fx.burst(d.x + 3, d.y + 1.5, d.z + 3, 14, { color: ['#ff8fa3', '#ff5c8a'], speed: 1, up: 2.5, life: 1.6, size: 0.2, extra: { gravity: -0.6, shrink: false } });
    HUD.hint('');
    setTimeout(showReceipt, 1300);
  }
  function showReceipt() {
    const stolen = G.stolen;
    const pay = FW.Orders.payout(G.order, G.results, G.timer / G.timerMax, stolen, kart.trickPoints);
    const cookTip = Math.round(3 * G.cookLeft); pay.coins += cookTip; pay.lines.push({ label: 'Fresh & fast cooking', value: cookTip });
    if (kart.coins) { pay.coins += kart.coins; pay.lines.push({ label: `Syrup tokens (${kart.coins})`, value: kart.coins }); }
    const tidy = G.messes === 0 ? 5 : G.messes <= 2 ? 2 : -Math.min(6, G.messes - 2);
    pay.coins += tidy;
    pay.lines.push({ label: G.messes === 0 ? 'Spotless kitchen' : `Kitchen mess (${G.messes})`, value: tidy });
    save.coins += pay.coins; save.delivered++; G.dayCoins += pay.coins; save.bestTip = Math.max(save.bestTip, pay.coins);
    save.rep = U.clamp(save.rep + (pay.happiness - 0.55) * 0.6, 1, 5);
    G.dayLog.push({ name: G.order.customer.name, dest: G.order.dest.name, coins: pay.coins, happiness: pay.happiness });
    persist(); HUD.stats(save);
    const c = G.order.customer; const quote = pay.happiness > 0.7 ? c.quotes[0] : pay.happiness > 0.4 ? c.quotes[1] : 'Hmm… thanks, I guess.';
    if (pay.happiness > 0.7) A.sfx.fanfare(); else if (pay.happiness > 0.4) A.sfx.happy(); else A.sfx.sad();
    const face = pay.happiness > 0.7 ? '😊' : pay.happiness > 0.4 ? '🙂' : '😕';
    let rows = pay.lines.map((l) => `<tr><td>${HUD.esc(l.label)}${l.quality !== undefined ? ` <span class="stars">${HUD.stars(l.quality * 5)}</span>` : ''}</td><td class="coins">${l.value < 0 ? '' : '+'}${l.value}</td></tr>`).join('');
    HUD.panel(`<h2>Delivered! ${face}</h2><div class="quote">“${HUD.esc(quote)}” — ${HUD.esc(c.name)}</div><table>${rows}</table><div class="big">Total: 🪙 ${pay.coins}</div>${stolen ? `<div class="quote">${stolen} waffle${stolen > 1 ? 's were' : ' was'} eaten by bears. Honk (H) to scare them next time!</div>` : ''}`,
      [{ label: 'Ride home', onClick: () => { HUD.closePanel(); G.modal = false; rideHome(); } }]);
    G.modal = true;
  }
  function rideHome() {
    G.state = 'home'; kart.controllable = true; kart.setBoxVisible(false); kart.trickPoints = 0; kart.coins = 0;
    W.setDelivery(null); W.clearCustomer(); HUD.waffles(false); HUD.ticket(null);
    HUD.hint('Ride back <b>home</b> to the waffle shack. Tricks on the way home earn <b>hype</b> tips!');
    setTimeout(() => { if (G.state === 'home') HUD.hint(''); }, 7000);
  }
  async function arriveHome() {
    kart.controllable = false; G.state = 'arriving';
    const hype = Math.floor(kart.trickPoints / 4) + kart.coins;
    if (hype > 0) { save.coins += hype; HUD.popup(`Hype tips: +${hype} coins!`, 'gold'); A.sfx.coin(); }
    save.orderIndex++; persist();
    await HUD.fade(1, 0.6);
    HUD.compass(false); HUD.drift(false); HUD.minimap(false); routePts = null;
    if (save.orderIndex >= G.dayOrders) daySummary(); else { nextOrder(); }
    await HUD.fade(0, 0.6);
  }
  function daySummary() {
    G.state = 'summary'; G.modal = true; HUD.hideAll(); HUD.stats(save);
    W.setTimeOfDay(1); kart.reset(START.x, START.z, START.yaw); kart.controllable = false;
    const rows = G.dayLog.map((l) => `<tr><td>${HUD.esc(l.name)} · ${HUD.esc(l.dest)}</td><td class="coins">+${l.coins}</td></tr>`).join('');
    HUD.panel(`<h2>Day ${save.day} complete!</h2><table>${rows}</table><div class="big">Earned today: 🪙 ${G.dayCoins}</div><div>Reputation: <span class="stars">${HUD.stars(save.rep)}</span> · Total coins: ${save.coins} · Deliveries: ${save.delivered}</div><div class="quote">The bears are asleep. Time for cocoa. 🌙</div>`,
      [{ label: 'Next day', onClick: () => { HUD.closePanel(); G.modal = false; save.day++; save.orderIndex = 0; G.dayCoins = 0; G.dayLog = []; persist(); FW.Orders.seed(1000 + save.day * 7); nextOrder(); } }]);
    A.playMusic('kitchen'); A.sfx.fanfare();
  }

  // ---------- pause / global keys ----------
  function togglePause() {
    if (G.state === 'title') return;
    G.paused = !G.paused;
    if (G.paused) {
      HUD.panel(`<h2>Paused</h2><div>Day ${save.day} · ${save.coins} coins</div><div class="quote">Kitchen: walk with WASD or tap a spot · Space uses what you are next to · fridge for ingredients, bowl to stir then pour, lift the waffle when the iron's lamp goes green, then a topping and the box<br>Scooter: WASD/arrows · Space hop &amp; drift · Shift trick · H honk · R rescue</div>`,
        [{ label: 'Resume', onClick: togglePause }, { label: A.muted ? 'Unmute' : 'Mute', cls: 'alt', onClick: () => { A.setMuted(!A.muted); togglePause(); togglePause(); } }, { label: 'Reset save', cls: 'ghost', onClick: () => { if (confirm('Start over from Day 1?')) { save = defaultSave(); persist(); location.reload(); } } }]);
    } else HUD.closePanel();
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape') togglePause();
    if (e.code === 'KeyM') { A.init(); A.setMuted(!A.muted); HUD.popup(A.muted ? 'Muted' : 'Sound on', 'small'); }
    if (e.code === 'Enter' && G.state === 'title') startGame();
  });
  // On touch the canvas swallows synthetic mouse events, so wake the audio
  // context from a real touch too — otherwise a phone plays the game silently.
  const wakeAudio = () => { if (G.state === 'title') return; A.init(); A.resume(); };
  window.addEventListener('mousedown', wakeAudio);
  window.addEventListener('touchstart', wakeAudio, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden && !G.paused && G.state !== 'title') togglePause(); });

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    let dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!G.paused && !G.modal) update(dt);
    render();
    Inp.endFrame();
  }
  function update(dt) {
    const p = kart.pos;
    switch (G.state) {
      case 'title': {
        // The menu shows the wombat actually driving: it cruises Northside
        // Drive on autopilot while the camera holds a slow cinematic chase.
        G.titleT += dt;
        const s = 340 + G.titleT * 7.5;                      // metres along the road
        const A = W.roadPoint('northside', s), B = W.roadPoint('northside', s + 6);
        kart.pos.set(A.x, W.groundY(A.x, A.z) + 0.06, A.z);
        kart.yaw = Math.atan2(B.x - A.x, B.z - A.z);
        kart.speed = 12;
        kart.leanZ.set(Math.sin(G.titleT * 0.8) * 0.10);
        W.update(dt, kart.pos, camera); bears.update(dt, kart, 0);
        kart.updateVisual(dt, 0, W);
        // orbit a little around the rider so both the wombat and the valley read
        // swing round to a three-quarter view so the rider reads, not its back
        const orb = 1.20 + Math.sin(G.titleT * 0.19) * 0.38;    // road side: no guardrail across the shot
        const cy = Math.cos(kart.yaw + orb), cx = Math.sin(kart.yaw + orb);
        camera.position.set(kart.pos.x - cx * 5.0, kart.pos.y + 1.95 + Math.sin(G.titleT * 0.5) * 0.14, kart.pos.z - cy * 5.0);
        camera.lookAt(kart.pos.x, kart.pos.y + 1.05, kart.pos.z);
        titleFill.intensity = 1.5;
        titleFill.position.copy(camera.position).add(new THREE.Vector3(0, 2.2, 0));
        titleFill.target.position.set(kart.pos.x, kart.pos.y + 0.9, kart.pos.z);
        FW.Pixel.setFov(camera, 42);
        if (s > 720) G.titleT = 0;                            // loop the drive
        break; }
      case 'kitchen': {
        kitchen.update(dt, Inp);
        G.timer = Math.max(0, G.timer - dt); HUD.timer(true, G.timer / G.timerMax, G.timer > 0 ? U.fmtTime(G.timer) : 'take your time~');
        W.update(dt * 0.2, p, null);
        break; }
      case 'ride': case 'home': {
        const steps = dt > 1 / 40 ? 2 : 1;
        for (let i = 0; i < steps; i++) updateRide(dt / steps);
        W.update(dt, p, camera); kart.updateCamera(dt, camera, W);
        break; }
      case 'delivering': case 'arriving': {
        G.deliverT += dt; kart.speed = U.damp(kart.speed, 0, 4, dt); kart.update(dt, { axis: () => 0, throttle: () => 0, held: () => false, pressed: () => false }, W, fx);
        kart.events.length = 0; bears.update(dt, kart, 0); bears.events.length = 0; W.update(dt, p, camera); kart.updateCamera(dt, camera, W);
        break; }
      case 'summary': { W.update(dt, p, camera); kart.updateVisual(dt, 0, W); const a = W.time * 0.1, hy = W.groundY(0, 66); camera.position.set(Math.sin(a) * 32, hy + 18, 66 + Math.cos(a) * 32); camera.lookAt(0, hy + 4, 64); break; }
    }
    if (G.state !== 'ride' && G.state !== 'home' && G.state !== 'delivering') A.setEngine(false);
  }
  function render() {
    if (G.state === 'kitchen') kitchen.render(); else FW.Pixel.render(worldScene, camera);
  }
  showTitle();
  requestAnimationFrame(frame);

  // debug / automation hooks
  FW.game = { G, kart, bears, kitchen, camera, get save() { return save; }, startGame, nextOrder, startRide, deliver, rideHome, showTitle, W, renderer, worldScene };
})();
