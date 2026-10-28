(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayIso = () => isoOf(new Date());
  const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoOf(d); };
  const diffDays = (iso) => Math.round((new Date(iso + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 864e5);
  const fmt = (iso) => (iso || '').slice(0, 10).split('-').reverse().join('/');
  const toast = (m) => { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3000); };
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const norm = (s) => String(s || '').trim().toLowerCase();
  const dueBadge = (iso) => { const d = diffDays(iso); return d < 0 ? ['risk', 'Quá hạn ' + -d + ' ngày'] : d === 0 ? ['pend', 'Hôm nay'] : d <= 7 ? ['sel', 'Còn ' + d + ' ngày'] : ['none', fmt(iso)]; };

  const SEQ = { upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38] };
  const jawOf = (f) => (f >= 11 && f <= 28 ? 'upper' : 'lower');
  const CATALOG = ['Răng sứ Cercon HT', 'Răng toàn sứ Zirconia', 'Răng toàn sứ Emax', 'Răng sứ kim loại', 'Mão sứ titan', 'Dán sứ veneer', 'Trám răng', 'Trám thẩm mỹ composite', 'Điều trị tủy', 'Mão tạm', 'Nhổ răng', 'Nhổ răng khôn', 'Cấy ghép implant', 'Cầu răng sứ', 'Điều trị nha chu', 'Cạo vôi, đánh bóng', 'Chỉnh nha (niềng răng)', 'Tẩy trắng răng', 'Máng chống nghiến', 'Theo dõi định kỳ'];
  const ORDER = SEQ.upper.concat(SEQ.lower), ordOf = (f) => ORDER.indexOf(f);
  const STC = { done: 0x0e8a80, pend: 0xe0952a, risk: 0xd9483b, none: 0x7b8da0 };

  const S = {
    view: 'home', cases: [], cfg: null, hasKey: false, version: '', dataPath: '', packaged: false, upd: { state: 'idle' },
    C: null, jaws: {}, tint: true, sel: null, tab: 'scan', mark: null, scan: { busy: false, phase: '', jaw: '', done: 0, total: 0, fail: [], err: '', cur: null, cancel: false, warn: [] }, care: { open: null, pin: null }, pano: { url: '', busy: false, err: '' },
    form: { kind: 'done', svc: '', who: '', role: 'Bác sĩ', date: todayIso(), react: 'Đang cân nhắc', text: '' }, ai: { busy: false, err: '' }, rep: { busy: false, err: '' }, all: { busy: false, done: 0, total: 0, fail: [], err: '' }, models: []
  };
  try { S.form.who = localStorage.getItem('kr_who') || ''; S.form.role = localStorage.getItem('kr_role') || 'Bác sĩ'; } catch (e) {}

  /* ================= persistence (files on this computer, through the main process) ================= */
  let saveTimer = null;
  function persist() {
    if (!S.C) return; S.C.updated = todayIso(); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { window.api.cases.save(S.C.key, S.C).catch((e) => toast('Không lưu được: ' + cleanErr(e))); }, 350);
  }
  const flush = () => { if (saveTimer && S.C) { clearTimeout(saveTimer); saveTimer = null; return window.api.cases.save(S.C.key, S.C); } return Promise.resolve(); };
  const teethLog = (f) => (S.C && S.C.teeth[f]) || [];

  /* ================= 3D scene ================= */
  const canvas = $('cv'), stage = $('stage');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 3000); camera.up.set(0, 0, 1); scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x556070, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.6); keyLight.position.set(0.4, 0.6, 1); camera.add(keyLight);
  const controls = new THREE.OrbitControls(camera, canvas); controls.screenSpacePanning = true;
  let need = true; const draw = () => { need = true; }; controls.addEventListener('change', draw);
  function resize() { const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); draw(); }
  new ResizeObserver(resize).observe(stage);
  const EXPLODE = 16, ZERO = new THREE.Vector3(); let offsetLock = false;
  const fxGroup = new THREE.Group(); scene.add(fxGroup);
  const FX = { glow: new Map(), hover: new Set(), pin: new Set(), color: 0x14e0c8, sweep: null, rings: new Map(), tween: null, last: 0 };
  const HL = { done: 0x14e0c8, todo: 0xffb020, scan: 0x35d8ff, ok: 0x3dff9a };
  const fxActive = () => FX.glow.size || FX.hover.size || FX.pin.size || FX.sweep || FX.rings.size || FX.tween;
  (function loop() {
    requestAnimationFrame(loop);
    const now = performance.now();
    if (fxActive() && now - FX.last > 30) { FX.last = now; fxStep(now); }
    layout(); if (!need) return; need = false; renderer.render(scene, camera); placeLabels();
  })();

  function eig3(c) {
    const a = c.map((r) => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let it = 0; it < 40; it++) {
      let p = 0, q = 1, m = Math.abs(a[0][1]);
      if (Math.abs(a[0][2]) > m) { p = 0; q = 2; m = Math.abs(a[0][2]); }
      if (Math.abs(a[1][2]) > m) { p = 1; q = 2; m = Math.abs(a[1][2]); }
      if (m < 1e-12) break;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = cs * x - sn * y; a[k][q] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = cs * x - sn * y; a[q][k] = sn * x + cs * y; }
      for (let k = 0; k < 3; k++) { const x = v[k][p], y = v[k][q]; v[k][p] = cs * x - sn * y; v[k][q] = sn * x + cs * y; }
    }
    return [0, 1, 2].map((j) => ({ val: a[j][j], vec: new THREE.Vector3(v[0][j], v[1][j], v[2][j]) })).sort((x, y) => y.val - x.val);
  }
  const toAB = (b) => (b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));

  function clearJaws() { Object.values(S.jaws).forEach((J) => { scene.remove(J.mesh); J.geo.dispose(); }); S.jaws = {}; $('labs').textContent = ''; }
  function buildJaw(name, ext, buf) {
    const isPly = ext === 'ply';
    const g = isPly ? new THREE.PLYLoader().parse(buf) : new THREE.STLLoader().parse(buf);
    g.computeVertexNormals(); g.computeBoundingBox();
    const pos = g.getAttribute('position'), n = pos.count; let col = g.getAttribute('color');
    if (!col) { g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.85), 3)); col = g.getAttribute('color'); }
    const base = new Float32Array(col.array);
    const mesh = new THREE.Mesh(g, new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: 25, specular: 0x222222 }));
    scene.add(mesh);
    const P = pos.array, c = new THREE.Vector3();
    for (let i = 0; i < n; i++) { c.x += P[i * 3]; c.y += P[i * 3 + 1]; c.z += P[i * 3 + 2]; } c.multiplyScalar(1 / n);
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < n; i += 3) { const d = [P[i * 3] - c.x, P[i * 3 + 1] - c.y, P[i * 3 + 2] - c.z]; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[a][b] += d[a] * d[b]; }
    const ev = eig3(cov), e1 = ev[0].vec, e2 = ev[1].vec, nrm = ev[2].vec;
    let crown = new Uint8Array(n); const U = new Float32Array(n), V = new Float32Array(n), Hh = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const r = base[i * 3], gg = base[i * 3 + 1], b = base[i * 3 + 2];
      crown[i] = isPly ? (gg / Math.max(r, 0.004) > 0.76 && Math.max(r, gg, b) > 0.48 ? 1 : 0) : 1;
      const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
      U[i] = x * e1.x + y * e1.y + z * e1.z; V[i] = x * e2.x + y * e2.y + z * e2.z; Hh[i] = x * nrm.x + y * nrm.y + z * nrm.z;
    }
    if (isPly && g.index) {
      const idx = g.index.array, ncount = new Float32Array(n), deg = new Float32Array(n);
      for (let pass = 0; pass < 2; pass++) {
        ncount.fill(0); deg.fill(0);
        for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b2 = idx[t + 1], c2 = idx[t + 2]; ncount[a] += crown[b2] + crown[c2]; ncount[b2] += crown[a] + crown[c2]; ncount[c2] += crown[a] + crown[b2]; deg[a] += 2; deg[b2] += 2; deg[c2] += 2; }
        const nc = new Uint8Array(n); for (let i = 0; i < n; i++) nc[i] = deg[i] && ncount[i] / deg[i] > 0.5 ? 1 : 0; crown = nc;
      }
      const step = (grow) => { const nx = Uint8Array.from(crown); for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b2 = idx[t + 1], c2 = idx[t + 2];
        if (grow) { if (crown[a] || crown[b2] || crown[c2]) nx[a] = nx[b2] = nx[c2] = 1; } else if (!(crown[a] && crown[b2] && crown[c2])) nx[a] = nx[b2] = nx[c2] = 0; } crown = nx; };
      for (let k = 0; k < 6; k++) step(true); for (let k = 0; k < 6; k++) step(false);
    }
    let sh = 0, sc = 0, allH = 0; for (let i = 0; i < n; i += 2) { allH += Hh[i]; if (crown[i]) { sh += Hh[i]; sc++; } } allH /= Math.ceil(n / 2);
    const occ = nrm.clone().multiplyScalar(sc && sh / sc - allH < 0 ? -1 : 1);
    S.jaws[name] = { name, mesh, base, crown, U, V, H: Hh, n: nrm, e1, e2, center: c, seeds: [], region: new Int16Array(n).fill(-1), occ, geo: g };
  }
  function layout() {
    const U = S.jaws.upper, L = S.jaws.lower, both = !!(U && L && U.mesh.visible && L.mesh.visible && !S.mark && !offsetLock);
    Object.values(S.jaws).forEach((J) => { const want = both ? J.occ.clone().multiplyScalar(-EXPLODE) : ZERO; J.off = J.off || new THREE.Vector3(); if (!J.off.equals(want)) { J.off.copy(want); J.mesh.position.copy(J.off); J.mesh.updateMatrixWorld(true); draw(); } });
  }
  const offOf = (J) => J.off || ZERO;
  function visBox() { layout(); const b = new THREE.Box3(); Object.values(S.jaws).forEach((J) => { if (J.mesh.visible) b.union(J.geo.boundingBox.clone().translate(offOf(J))); }); if (b.isEmpty()) Object.values(S.jaws).forEach((J) => b.union(J.geo.boundingBox.clone().translate(offOf(J)))); return b; }
  function fitAll() { const b = visBox(); if (b.isEmpty()) return; S.center = b.getCenter(new THREE.Vector3()); S.radius = b.getSize(new THREE.Vector3()).length() / 2 || 50; camera.near = S.radius / 100; camera.far = S.radius * 40; camera.updateProjectionMatrix(); }
  const DIRS = { front: [0, -1, 0], top: [0, -0.02, 1], bottom: [0, 0.02, -1], left: [-1, 0, 0], right: [1, 0, 0] };
  function setView(v) { if (!S.center) return; const d = new THREE.Vector3(...DIRS[v]).normalize().multiplyScalar(S.radius * 2.6); layout(); camera.up.set(0, 0, 1); camera.position.copy(S.center).add(d); controls.target.copy(S.center); controls.update(); draw(); }
  $('views').addEventListener('click', (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) setView(v); });

  /* ---- tooth regions ---- */
  function recompute(J) {
    const { U, V, H, crown, region, seeds, n, occ } = J, N = region.length, sg = occ.dot(n) >= 0 ? 1 : -1;
    seeds.forEach((s) => { s.u = s.p.x * J.e1.x + s.p.y * J.e1.y + s.p.z * J.e1.z; s.v = s.p.x * J.e2.x + s.p.y * J.e2.y + s.p.z * J.e2.z; });
    for (let i = 0; i < N; i++) {
      region[i] = -1; if (!crown[i] || !seeds.length) continue;
      let best = -1, bd = 64;
      for (let k = 0; k < seeds.length; k++) { const du = U[i] - seeds[k].u, dv = V[i] - seeds[k].v, d = du * du + dv * dv, s = (H[i] - seeds[k].h) * sg; if (d < bd && s > -10 && s < 4.5) { bd = d; best = k; } }
      region[i] = best;
    }
    J.vidx = seeds.map(() => []); for (let i = 0; i < N; i++) { const r = region[i]; if (r >= 0) J.vidx[r].push(i); }
    seeds.forEach((s, k) => { const L = J.vidx[k]; if (J.sweep && L.length) { let a = 0; for (const i of L) a += J.sweep[i]; s.t = a / L.length; } else { const q = SEQ[J.name].indexOf(s.f); s.t = q < 0 ? 0.5 : q / 15; } });
  }
  function aiLatest(f) { const by = {}; teethLog(f).forEach((e) => { if (e.kind === 'ai') by[e.src || 'scan'] = e; }); return Object.keys(by).sort().map((k) => by[k]); }
  function svcMap(f) {
    const m = new Map(), log = teethLog(f), get = (n) => { const k = norm(n); if (!m.has(k)) m.set(k, { name: n, ai: null, advice: [], done: [] }); return m.get(k); };
    aiLatest(f).forEach((lastAi) => { if (lastAi && lastAi.ai) (lastAi.ai.services || []).forEach((s) => { if (s && s.name) { const o = get(s.name); if (!o.ai || (s.priority === 'cao' && o.ai.priority !== 'cao')) o.ai = { priority: s.priority, why: s.why, date: lastAi.date, src: lastAi.src || '' }; } }); });
    log.forEach((e) => { if (e.kind === 'advice' && e.svc) get(e.svc).advice.push(e); if (e.kind === 'done' && e.svc) get(e.svc).done.push(e); });
    return m;
  }
  const isMissing = (f) => S.C && S.C.marks.missing.indexOf(f) >= 0;
  function stateOf(f) {
    if (isMissing(f)) return 'missing';
    const m = svcMap(f); if (!m.size) return 'none';
    let pend = false, risk = false;
    m.forEach((s) => { if (!s.done.length) { pend = true; if (s.ai && s.ai.priority === 'cao') risk = true; } });
    return risk ? 'risk' : pend ? 'pend' : 'done';
  }
  const tmpc = new THREE.Color();
  const mixc = new THREE.Color();
  function paint(J) {
    const col = J.geo.getAttribute('color'), a = col.array; a.set(J.base);
    const now = performance.now(), pulse = 0.5 + 0.5 * Math.sin(now / 170);
    if (S.tint && J.seeds.length && J.vidx) {
      J.seeds.forEach((s, k) => {
        const st = stateOf(s.f), sel = S.sel === s.f, c = tmpc.setHex(sel ? 0x3f6bff : STC[st] || STC.none), kk = sel ? 0.8 : st === 'none' ? 0.2 : 0.55, L = J.vidx[k];
        for (let n = 0; n < L.length; n++) { const i = L[n]; a[i * 3] = a[i * 3] * (1 - kk) + c.r * kk; a[i * 3 + 1] = a[i * 3 + 1] * (1 - kk) + c.g * kk; a[i * 3 + 2] = a[i * 3 + 2] * (1 - kk) + c.b * kk; }
      });
    }
    if (J.vidx) J.seeds.forEach((s, k) => {
      let kk = 0, hex = 0;
      const g = FX.glow.get(s.f); if (g) { hex = HL[g.color] || HL.scan; kk = g.kind === 'flash' ? Math.max(0, 1 - (now - g.t0) / g.dur) * 0.9 : 0.5 + 0.35 * pulse; }
      if (FX.hover.has(s.f) || FX.pin.has(s.f)) { hex = FX.color; kk = Math.max(kk, 0.6 + 0.3 * pulse); }
      if (kk <= 0) return; const c = mixc.setHex(hex), L = J.vidx[k];
      for (let n = 0; n < L.length; n++) { const i = L[n]; a[i * 3] = a[i * 3] * (1 - kk) + c.r * kk; a[i * 3 + 1] = a[i * 3 + 1] * (1 - kk) + c.g * kk; a[i * 3 + 2] = a[i * 3 + 2] * (1 - kk) + c.b * kk; }
    });
    if (FX.sweep && FX.sweep.jaw === J.name && J.sweep) {
      const t = Math.min(1, (now - FX.sweep.t0) / FX.sweep.dur) * 1.16 - 0.08, c = mixc.setHex(HL.scan), sw = J.sweep, N = sw.length;
      for (let i = 0; i < N; i++) { const d = Math.abs(sw[i] - t); if (d > 0.07) continue; const kk = (1 - d / 0.07) * 0.85; a[i * 3] = a[i * 3] * (1 - kk) + c.r * kk; a[i * 3 + 1] = a[i * 3 + 1] * (1 - kk) + c.g * kk; a[i * 3 + 2] = a[i * 3 + 2] * (1 - kk) + c.b * kk; }
    }
    col.needsUpdate = true; draw();
  }
  function fxStep(now) {
    if (FX.tween) { const T = FX.tween, k = Math.min(1, (now - T.t0) / T.ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; camera.position.lerpVectors(T.p0, T.p1, e); controls.target.lerpVectors(T.t0v, T.t1v, e); controls.update(); if (k >= 1) FX.tween = null; }
    FX.rings.forEach((r) => { const ph = ((now - r.t0) % 1500) / 1500, tri = ph < 0.5 ? ph * 2 : 2 - ph * 2; r.grp.position.copy(r.s.p).add(offOf(r.J)).addScaledVector(r.occ, -5 + 9 * tri); r.ring.material.opacity = 0.55 + 0.4 * Math.sin(Math.PI * tri); });
    FX.glow.forEach((g, f) => { if (g.kind === 'flash' && now - g.t0 > g.dur) FX.glow.delete(f); });
    if (FX.sweep) { const J = S.jaws[FX.sweep.jaw], t = Math.min(1, (now - FX.sweep.t0) / FX.sweep.dur) * 1.16 - 0.08; if (J) J.seeds.forEach((s) => { if (s.show === false && s.t <= t + 0.02) { s.show = true; FX.glow.set(s.f, { kind: 'flash', t0: now, dur: 800, color: 'scan' }); } }); }
    Object.values(S.jaws).forEach((J) => { if (J.mesh.visible) paint(J); }); draw();
  }
  function flyTo(target, dir, dist, ms) {
    const p1 = target.clone().addScaledVector(dir.clone().normalize(), dist);
    FX.tween = { p0: camera.position.clone(), p1, t0v: controls.target.clone(), t1v: target.clone(), t0: performance.now(), ms: ms || 700 }; camera.up.set(0, 0, 1);
  }
  function addRing(f) {
    if (FX.rings.has(f)) return; const J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f); if (!s) return;
    const grp = new THREE.Group(), ring = new THREE.Mesh(new THREE.RingGeometry(2.7, 3.7, 56), new THREE.MeshBasicMaterial({ color: HL.scan, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3.7, 56), new THREE.MeshBasicMaterial({ color: HL.scan, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthTest: false }));
    grp.add(ring); grp.add(disc); const occ = J.occ.clone().normalize(); grp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), occ); grp.renderOrder = 10; fxGroup.add(grp);
    FX.rings.set(f, { grp, ring, s, J, occ, t0: performance.now() });
  }
  function dropRing(f) { const r = FX.rings.get(f); if (!r) return; fxGroup.remove(r.grp); r.grp.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); FX.rings.delete(f); }
  function fxClear() { FX.glow.clear(); FX.hover.clear(); FX.pin.clear(); FX.sweep = null; [...FX.rings.keys()].forEach(dropRing); FX.tween = null; }
  function repaintAll() { Object.values(S.jaws).forEach(paint); buildLabels(); }
  function applyMarks() {
    ['upper', 'lower'].forEach((n) => { const J = S.jaws[n]; if (!J) return; J.seeds = ((S.C.marks[n]) || []).map((s) => ({ f: s.f, p: new THREE.Vector3(s.x, s.y, s.z), h: s.h })); recompute(J); });
    repaintAll();
  }
  function saveMarks() {
    ['upper', 'lower'].forEach((n) => { const J = S.jaws[n]; if (J) S.C.marks[n] = J.seeds.map((s) => ({ f: s.f, x: +s.p.x.toFixed(3), y: +s.p.y.toFixed(3), z: +s.p.z.toFixed(3), h: +s.h.toFixed(3) })); });
    persist();
  }
  function snapSeed(J, hit) {
    const P = J.geo.getAttribute('position').array, n = J.n, r2 = 3.5 * 3.5; let sx = 0, sy = 0, sz = 0, sh = 0, c = 0;
    for (let i = 0, N = J.crown.length; i < N; i++) { if (!J.crown[i]) continue; const dx = P[i * 3] - hit.x, dy = P[i * 3 + 1] - hit.y, dz = P[i * 3 + 2] - hit.z; if (dx * dx + dy * dy + dz * dz < r2) { sx += P[i * 3]; sy += P[i * 3 + 1]; sz += P[i * 3 + 2]; sh += J.H[i]; c++; } }
    if (!c) return { p: hit.clone(), h: hit.x * n.x + hit.y * n.y + hit.z * n.z };
    return { p: new THREE.Vector3(sx / c, sy / c, sz / c), h: sh / c };
  }
  function placeSeed(J, hitPoint, f) {
    const sn = snapSeed(J, hitPoint), old = J.seeds.findIndex((s) => s.f === f), s = { f, p: sn.p, h: sn.h };
    if (old >= 0) J.seeds[old] = s; else J.seeds.push(s);
    S.C.marks.missing = S.C.marks.missing.filter((x) => x !== f);
    recompute(J); repaintAll(); saveMarks();
  }

  /* ---- labels and picking ---- */
  function buildLabels() {
    const box = $('labs'); box.textContent = '';
    Object.values(S.jaws).forEach((J) => J.seeds.forEach((s) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'lab ' + stateOf(s.f); b.textContent = s.f; b.dataset.f = s.f; b.setAttribute('aria-label', 'Răng ' + s.f); b.setAttribute('aria-pressed', S.sel === s.f); s.el = b; box.appendChild(b); }));
    draw();
  }
  const pv = new THREE.Vector3();
  function placeLabels() {
    const w = stage.clientWidth, h = stage.clientHeight;
    Object.values(S.jaws).forEach((J) => J.seeds.forEach((s) => {
      if (!s.el) return; if (!J.mesh.visible || s.show === false) { s.el.hidden = true; return; }
      pv.copy(s.p).add(offOf(J)).addScaledVector(J.occ, 1.5).project(camera); s.el.hidden = pv.z > 1 || pv.z < -1;
      s.el.style.left = ((pv.x + 1) / 2) * w + 'px'; s.el.style.top = ((1 - pv.y) / 2) * h + 'px';
    }));
  }
  $('labs').addEventListener('click', (e) => { const b = e.target.closest('.lab'); if (b) select(+b.dataset.f); });
  const ray = new THREE.Raycaster(), mp = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect(); mp.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mp, camera);
    const meshes = Object.values(S.jaws).filter((J) => J.mesh.visible && (!S.mark || J.name === S.mark.jaw)).map((J) => J.mesh);
    const hit = ray.intersectObjects(meshes, false)[0]; if (!hit) return;
    const J = Object.values(S.jaws).find((j) => j.mesh === hit.object);
    if (S.mark) { const f = S.mark.seq[S.mark.idx]; if (f == null) return; placeSeed(J, hit.point.clone().sub(offOf(J)), f); S.mark.idx += S.mark.dir; if (S.mark.single) { stopMark(); select(f); return; } markGuide(); return; }
    const rg = J.region[hit.face.a]; if (rg >= 0 && J.seeds[rg]) select(J.seeds[rg].f);
  });

  /* ---- marking guide ---- */
  function startMark(jn, only) { offsetLock = true; S.mark = { jaw: jn, seq: only ? [only] : SEQ[jn], idx: 0, dir: 1, single: !!only }; S.sel = null; Object.values(S.jaws).forEach((J) => (J.mesh.visible = J.name === jn)); fitAll(); setView(jn === 'upper' ? 'bottom' : 'top'); markGuide(); render(); draw(); }
  function stopMark() { offsetLock = false; S.mark = null; $('vU').checked = !!S.jaws.upper; $('vL').checked = !!S.jaws.lower; Object.values(S.jaws).forEach((J) => (J.mesh.visible = true)); fitAll(); setView('front'); markGuide(); repaintAll(); render(); toast('Đã lưu vị trí các răng'); }
  function markGuide() {
    const g = $('guide'); if (!S.mark) { g.hidden = true; return; } const m = S.mark, f = m.seq[m.idx];
    g.hidden = false;
    g.innerHTML = '<div class="row"><span class="muted small">' + (m.jaw === 'upper' ? 'Hàm trên' : 'Hàm dưới') + ' · bấm vào răng số</span><b class="n">' + (f == null ? '—' : f) + '</b><select id="gsel" aria-label="Răng kế tiếp">' + m.seq.map((x, i) => '<option value="' + i + '"' + (i === m.idx ? ' selected' : '') + '>' + x + '</option>').join('') + '</select></div>' +
      '<div class="row"><button class="btn ghost sm" type="button" data-g="skip">Răng này đã mất, bỏ qua</button><button class="btn ghost sm" type="button" data-g="back">Lùi 1 răng</button><button class="btn ghost sm" type="button" data-g="flip">Đổi chiều</button><button class="btn sm" type="button" data-g="done">Xong</button></div>' +
      '<p class="muted small">Bấm lần lượt dọc cung hàm, mỗi răng một lần, số tự nhảy tiếp. Đánh sai thì chọn lại số rồi bấm lại.</p>';
  }
  $('guide').addEventListener('click', (e) => {
    const k = e.target.dataset && e.target.dataset.g; if (!k || !S.mark) return; const m = S.mark;
    if (k === 'skip') { const f = m.seq[m.idx]; if (f != null) { if (S.C.marks.missing.indexOf(f) < 0) S.C.marks.missing.push(f); const J = S.jaws[m.jaw]; J.seeds = J.seeds.filter((s) => s.f !== f); recompute(J); saveMarks(); } m.idx += m.dir; repaintAll(); markGuide(); }
    if (k === 'back') { m.idx = Math.max(0, m.idx - m.dir); markGuide(); }
    if (k === 'flip') { m.dir = -m.dir; markGuide(); }
    if (k === 'done') stopMark();
  });
  $('guide').addEventListener('change', (e) => { if (e.target.id === 'gsel' && S.mark) { S.mark.idx = +e.target.value; markGuide(); } });
  $('aiAll').onclick = () => runScan({});
  $('markU').onclick = () => startMark('upper'); $('markL').onclick = () => startMark('lower');

  function addLog(f, entry) { const log = (S.C.teeth[f] = (S.C.teeth[f] || []).slice()); entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); log.push(entry); persist(); repaintAll(); render(); }
  function delLog(f, id) { S.C.teeth[f] = teethLog(f).filter((e) => e.id !== id); persist(); repaintAll(); render(); }
  function toothDirs(J, s) { const out = s.p.clone().sub(J.center); out.addScaledVector(J.n, -out.dot(J.n)); if (out.lengthSq() < 1e-6) out.copy(J.e1); out.normalize(); return { occ: J.occ.clone().normalize(), out }; }
  function select(f) {
    S.sel = f; if (['scan', 'care', 'todo'].indexOf(S.tab) < 0) S.tab = 'exam'; S.form.svc = ''; syncTabs();
    const J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f);
    if (J && !S.mark && S.tab === 'exam') { Object.values(S.jaws).forEach((j) => (j.mesh.visible = j === J)); $('vU').checked = !!(S.jaws.upper && S.jaws.upper.mesh.visible); $('vL').checked = !!(S.jaws.lower && S.jaws.lower.mesh.visible); }
    if (s) { const d = camera.position.clone().sub(controls.target); d.setLength(Math.min(d.length(), Math.max(45, S.radius * 1.1))); const J2 = S.jaws[jawOf(f)]; if (J2 && !J2.mesh.visible) { J2.mesh.visible = true; $('vU').checked = !!(S.jaws.upper && S.jaws.upper.mesh.visible); $('vL').checked = !!(S.jaws.lower && S.jaws.lower.mesh.visible); } flyTo(s.p.clone().add(offOf(J2 || J)), d, d.length(), 600); }
    repaintAll(); render();
  }
  function lookTooth(mode) {
    const f = S.sel, J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f); if (!s) return;
    const dirs = toothDirs(J, s), d = mode === 'occ' ? dirs.occ : mode === 'buc' ? dirs.out : dirs.out.clone().negate();
    const tp = s.p.clone().add(offOf(J)); camera.position.copy(tp).addScaledVector(d, 34); if (mode === 'occ') camera.position.addScaledVector(dirs.out, 4); controls.target.copy(tp); controls.update(); draw();
  }

  /* ---- offscreen renders (AI images and PDF pictures) ---- */
  const off = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); off.setClearColor(0xe6ecee, 1);
  function withOffscreen(only, fn) {
    const fxv = fxGroup.visible; fxGroup.visible = false; const offKeep = Object.values(S.jaws).map((J) => [J, (J.off || ZERO).clone()]); offKeep.forEach(([J]) => { J.mesh.position.set(0, 0, 0); J.mesh.updateMatrixWorld(true); });
    const keep = { pos: camera.position.clone(), up: camera.up.clone(), tg: controls.target.clone(), asp: camera.aspect };
    const vis = {}; Object.values(S.jaws).forEach((j) => { vis[j.name] = j.mesh.visible; j.mesh.visible = j === only; });
    const col = only.geo.getAttribute('color'), saved = new Float32Array(col.array); col.array.set(only.base); col.needsUpdate = true;
    try { return fn(); } finally {
      col.array.set(saved); col.needsUpdate = true; Object.values(S.jaws).forEach((j) => (j.mesh.visible = vis[j.name]));
      camera.aspect = keep.asp; camera.updateProjectionMatrix(); camera.position.copy(keep.pos); camera.up.copy(keep.up); controls.target.copy(keep.tg); controls.update(); fxGroup.visible = fxv; offKeep.forEach(([J, o]) => { J.mesh.position.copy(o); J.mesh.updateMatrixWorld(true); }); draw();
    }
  }
  const blobToDataUrl = (b) => new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
  async function toothImages(f) {
    const J = S.jaws[jawOf(f)], s = J.seeds.find((x) => x.f === f), dirs = toothDirs(J, s), out = [];
    off.setSize(560, 560, false);
    for (const v of ['occ', 'buc', 'lin']) {
      const url = withOffscreen(J, () => {
        const d = v === 'occ' ? dirs.occ : v === 'buc' ? dirs.out : dirs.out.clone().negate();
        camera.aspect = 1; camera.updateProjectionMatrix(); camera.up.set(0, 0, 1); camera.position.copy(s.p).addScaledVector(d, 30); if (v !== 'occ') camera.position.addScaledVector(dirs.occ, 3);
        camera.lookAt(s.p); camera.updateMatrixWorld(); off.render(scene, camera); return off.domElement.toDataURL('image/jpeg', 0.88);
      });
      out.push(url);
    }
    return out;
  }
  function jawShot(jn) {
    const J = S.jaws[jn]; if (!J) return '';
    const W = 1100, H = 760; off.setSize(W, H, false);
    return withOffscreen(J, () => {
      const front = J.seeds.filter((s) => [11, 21, 31, 41].indexOf(s.f) >= 0), cen = J.geo.boundingBox.getCenter(new THREE.Vector3());
      let up = front.length ? front.reduce((a, s) => a.add(s.p), new THREE.Vector3()).multiplyScalar(1 / front.length).sub(J.center) : J.e2.clone();
      up.addScaledVector(J.occ, -up.dot(J.occ)); if (up.lengthSq() < 1e-6) up = J.e2.clone(); up.normalize();
      const r = J.geo.boundingBox.getSize(new THREE.Vector3()).length() / 2;
      camera.aspect = W / H; camera.updateProjectionMatrix(); camera.up.copy(up); camera.position.copy(cen).addScaledVector(J.occ, r * 2.4); camera.lookAt(cen); camera.updateMatrixWorld();
      off.render(scene, camera);
      const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; const g = c2.getContext('2d'); g.drawImage(off.domElement, 0, 0);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 30px sans-serif';
      J.seeds.forEach((s) => { const v = s.p.clone().addScaledVector(J.occ, 1.5).project(camera), x = ((v.x + 1) / 2) * W, y = ((1 - v.y) / 2) * H; g.beginPath(); g.arc(x, y, 24, 0, 6.2832); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 3.5; g.strokeStyle = '#1d3646'; g.stroke(); g.fillStyle = '#1d3646'; g.fillText(String(s.f), x, y + 1); });
      return c2.toDataURL('image/jpeg', 0.9);
    });
  }

  /* ================= AI (GPT through the main process; the key never reaches this page) ================= */
  async function aiTooth(f) {
    const imgs = await toothImages(f), jaw = jawOf(f) === 'upper' ? 'hàm trên' : 'hàm dưới', miss = S.C.marks.missing.filter((x) => jawOf(x) === jawOf(f)).join(', ') || 'không có';
    const prompt = 'Có 3 ảnh dựng từ file scan 3D trong miệng (có màu) của răng số ' + f + ' (ký hiệu FDI, ' + jaw + '): ảnh 1 nhìn từ mặt nhai, ảnh 2 nhìn từ phía ngoài (má/môi), ảnh 3 nhìn từ phía trong (lưỡi/vòm).\nCác răng đã đánh dấu mất ở hàm này: ' + miss + '.\n' +
      'Nhiệm vụ: nêu những gì NHÌN THẤY được (màu men răng, vết ố hoặc tối màu có thể nghi sâu, mòn mặt nhai, mẻ, miếng trám hoặc mão nếu có, vôi răng, tình trạng nướu quanh răng, răng nghiêng hoặc chen chúc). Không khẳng định chẩn đoán chắc chắn từ ảnh scan; dùng từ "có thể", "nghi ngờ". Điều gì cần X-quang hoặc khám trực tiếp thì ghi vào mục review.\n' +
      'Dịch vụ đề xuất chọn từ: ' + CATALOG.join('; ') + ' (có thể thêm tên khác ngắn gọn). Chỉ đề xuất khi có lý do nhìn thấy được; nếu răng trông ổn thì chỉ cần "Theo dõi định kỳ".\n' +
      'Trả về JSON: {"observations":["..."],"impression":"nhận định 1-2 câu, dễ hiểu","services":[{"name":"...","priority":"cao|trung bình|thấp","why":"1 câu"}],"review":["điều cần bác sĩ xác nhận"]}. Viết tiếng Việt.';
    const res = await window.api.ai.run({ prompt, images: imgs });
    return { observations: (res.observations || []).slice(0, 8), impression: res.impression || '', services: (res.services || []).slice(0, 6), review: (res.review || []).slice(0, 5) };
  }
  async function runAi(f) {
    if (!S.hasKey) { toast('Chưa có khóa API. Vào Cài đặt để nhập khóa OpenAI.'); return; }
    S.ai = { busy: true, err: '' }; render(); FX.glow.set(f, { kind: 'scan', color: 'scan' }); addRing(f);
    try {
      const ai = await aiTooth(f);
      S.ai = { busy: false, err: '' }; FX.glow.set(f, { kind: 'flash', t0: performance.now(), dur: 900, color: 'ok' }); addLog(f, { kind: 'ai', who: 'AI (GPT)', date: todayIso(), ai });
    } catch (e) { S.ai = { busy: false, err: cleanErr(e) }; FX.glow.delete(f); render(); } finally { dropRing(f); }
  }

  /* ===== Quét tự động: nhận diện răng, rồi AI khám từng răng với hiệu ứng quét ===== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function viewJawOnly(jn) {
    Object.values(S.jaws).forEach((J) => (J.mesh.visible = J.name === jn)); $('vU').checked = !!(S.jaws.upper && S.jaws.upper.mesh.visible); $('vL').checked = !!(S.jaws.lower && S.jaws.lower.mesh.visible);
    fitAll(); setView(jn === 'upper' ? 'bottom' : 'top');
  }
  function showBothJaws() { Object.values(S.jaws).forEach((J) => (J.mesh.visible = true)); $('vU').checked = !!S.jaws.upper; $('vL').checked = !!S.jaws.lower; fitAll(); setView('front'); }
  function renderHud() {
    const h = $('hud'), sc = S.scan; if (!sc.busy) { h.hidden = true; return; } h.hidden = false;
    const jn = sc.jaw === 'upper' ? 'Hàm trên' : sc.jaw === 'lower' ? 'Hàm dưới' : '';
    const title = sc.phase === 'detect' ? 'Đang nhận diện răng · ' + jn : sc.phase === 'ai' ? 'AI đang quét · ' + jn : sc.phase === 'pano' ? 'AI đang đọc ảnh X-quang' : 'Đang soạn nhận định tổng quan';
    const sub = sc.phase === 'ai' ? 'Răng ' + (sc.cur || '…') + ' · ' + sc.done + '/' + sc.total : sc.phase === 'detect' ? 'Tìm ranh giới và số thứ tự từng răng' : 'Gần xong';
    const pct = sc.phase === 'ai' && sc.total ? Math.round((100 * sc.done) / sc.total) : sc.phase === 'detect' ? 8 : 96;
    h.innerHTML = '<div class="hrow"><b>' + esc(title) + '</b><button class="btn ghost sm" type="button" data-hud="stop">Dừng</button></div><div class="hsub">' + esc(sub) + '</div><div class="pb"><i style="width:' + pct + '%"></i></div>';
  }
  $('hud').addEventListener('click', (e) => { if (e.target.dataset.hud === 'stop') { S.scan.cancel = true; e.target.disabled = true; e.target.textContent = 'Đang dừng…'; } });
  async function detectJaw(jn) {
    const J = S.jaws[jn]; S.scan.phase = 'detect'; S.scan.jaw = jn; renderHud(); viewJawOnly(jn); J.sweep = null; J.seeds = []; recompute(J); buildLabels(); await sleep(350);
    const r = window.detectTeeth(J, jn, THREE);
    if (!r || r.seeds.length < 4) { S.scan.warn.push('Không nhận diện được ' + (jn === 'upper' ? 'hàm trên' : 'hàm dưới') + ', hãy bấm "Đánh dấu thủ công" cho hàm này.'); return false; }
    J.sweep = r.sweep; J.seeds = r.seeds.map((q) => ({ f: q.f, p: q.p, h: q.h, show: false }));
    S.C.marks.missing = S.C.marks.missing.filter((x) => jawOf(x) !== jn).concat(r.missing);
    recompute(J); saveMarks(); S.C.detect = S.C.detect || {}; S.C.detect[jn] = { auto: true, date: todayIso(), flipped: !!r.flipped, scale: r.scale }; persist();
    buildLabels(); render(); const dur = 2600; FX.sweep = { jaw: jn, t0: performance.now(), dur }; await sleep(dur + 250); FX.sweep = null; J.seeds.forEach((q) => (q.show = true)); repaintAll(); render();
    return true;
  }
  function followTooth(f) {
    const J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f); if (!s) return; const d = toothDirs(J, s), dir = d.occ.clone().addScaledVector(d.out, 0.3);
    flyTo(s.p.clone().add(offOf(J)), dir, 70, 650);
  }
  async function scanOne(f) {
    const sc = S.scan; FX.glow.set(f, { kind: 'scan', color: 'scan' }); addRing(f); sc.cur = f; followTooth(f); renderHud();
    try {
      const ai = await aiTooth(f); if (!S.C) return;
      FX.glow.set(f, { kind: 'flash', t0: performance.now(), dur: 1000, color: 'ok' }); addLog(f, { kind: 'ai', who: 'AI (GPT)', date: todayIso(), ai });
    } catch (e) { sc.fail.push(f); if (!sc.err) sc.err = cleanErr(e); if (/401|429|api key|quota|billing|incorrect|insufficient/i.test(sc.err)) sc.cancel = true; FX.glow.delete(f); }
    finally { dropRing(f); sc.done++; renderHud(); if (S.view === 'case') render(); }
  }
  async function runScan(opts) {
    opts = opts || {};
    if (S.scan.busy || !S.C || !Object.keys(S.jaws).length) return;
    if (S.mark) stopMark();
    S.scan = { busy: true, phase: 'detect', jaw: '', done: 0, total: 0, fail: [], err: '', cur: null, cancel: false, warn: [] }; const sc = S.scan;
    S.tab = 'scan'; S.sel = null; syncTabs(); fxClear(); render(); renderHud();
    try {
      for (const jn of ['upper', 'lower']) { if (!S.jaws[jn] || sc.cancel || !S.C) continue; if (opts.redetect || opts.only === jn || !S.jaws[jn].seeds.length) { if (!opts.only || opts.only === jn) await detectJaw(jn); } }
      if (!S.hasKey) { sc.warn.push('Chưa có khóa OpenAI nên AI chưa khám. Vào Cài đặt nhập khóa rồi bấm "Quét AI".'); }
      else if (!sc.cancel && S.C) {
        const plan = {}; let total = 0;
        for (const jn of ['upper', 'lower']) { const J = S.jaws[jn]; if (!J || !J.seeds.length) { plan[jn] = []; continue; } let list = J.seeds.map((q) => q.f).filter((f) => !isMissing(f)).sort((a, b) => ordOf(a) - ordOf(b)); if (!opts.all) list = list.filter((f) => !teethLog(f).some((e) => e.kind === 'ai' && !e.src)); plan[jn] = list; total += list.length; }
        sc.total = total;
        for (const jn of ['upper', 'lower']) {
          const list = plan[jn]; if (!list || !list.length || sc.cancel || !S.C) continue; sc.phase = 'ai'; sc.jaw = jn; viewJawOnly(jn); renderHud(); await sleep(300);
          let i = 0; const worker = async () => { while (i < list.length && !sc.cancel && S.C) { const f = list[i++]; await scanOne(f); await sleep(120); } };
          await Promise.all([worker(), worker(), worker()]);
        }
        if (!sc.cancel && S.C && S.C.pano && S.pano.url && !S.C.pano.result) { sc.phase = 'pano'; renderHud(); await runPano(true); }
        if (!sc.cancel && S.C && !sc.fail.length && (opts.all || !S.C.report.summary) && Object.keys(S.C.teeth).length) { sc.phase = 'report'; renderHud(); await aiReport(true); }
      }
    } catch (e) { console.error(e); sc.err = cleanErr(e); }
    const bad = sc.fail.length, cancelled = sc.cancel; sc.busy = false; sc.phase = ''; fxClear(); renderHud();
    if (S.C) { showBothJaws(); S.sel = null; repaintAll(); render(); }
    toast(cancelled ? 'Đã dừng quét' : bad ? 'Quét xong, ' + bad + ' răng lỗi (' + sc.err + '). Bấm "Quét AI" để quét nốt.' : sc.warn.length ? sc.warn[0] : 'Đã quét xong. Bác sĩ xem lại kết quả từng răng.');
  }
  async function runPano(quiet) {
    if (!S.hasKey) { toast('Chưa có khóa API. Vào Cài đặt để nhập khóa OpenAI.'); return; }
    if (!S.pano.url) { toast('Chưa có ảnh X-quang. Hãy thêm ảnh panorama hoặc phim răng.'); return; }
    S.pano.busy = true; S.pano.err = ''; if (!quiet) render();
    try {
      const prompt = 'Đây là ảnh X-quang răng (toàn cảnh panorama hoặc phim cận chóp) của khách. Hãy nêu những gì NHÌN THẤY, theo ký hiệu răng FDI: răng sâu lớn hoặc tổn thương quanh chóp nghi ngờ, răng đã điều trị tủy, mão hoặc cầu, implant, răng khôn ngầm hoặc lệch, tiêu xương quanh răng, răng mất, xoang hàm hoặc cấu trúc bất thường. Chỉ nói điều thấy rõ, dùng từ "có thể", "nghi ngờ", không khẳng định chẩn đoán. Nếu ảnh không phải X-quang răng thì trả summary nói rõ và để findings rỗng.\n' +
        'Dịch vụ đề xuất chọn từ: ' + CATALOG.join('; ') + ' (có thể thêm tên khác ngắn gọn).\nTrả về JSON: {"summary":"2-4 câu tổng quan","findings":[{"f":36,"text":"nhận định ngắn cho răng này","services":[{"name":"...","priority":"cao|trung bình|thấp","why":"1 câu"}]}],"general":["điều chung cần lưu ý, ví dụ tiêu xương, xoang"],"review":["điều cần bác sĩ xác nhận"]}. Viết tiếng Việt.';
      const res = await window.api.ai.run({ prompt, images: [S.pano.url] });
      const finds = (res.findings || []).filter((x) => ORDER.indexOf(+x.f) >= 0).slice(0, 32), date = todayIso();
      S.C.pano = Object.assign({}, S.C.pano, { result: { summary: String(res.summary || ''), general: (res.general || []).slice(0, 8), review: (res.review || []).slice(0, 6), count: finds.length, date } });
      finds.forEach((x) => { const f = +x.f, log = (S.C.teeth[f] = (S.C.teeth[f] || []).filter((e) => !(e.kind === 'ai' && e.src === 'pano'))); log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'ai', src: 'pano', who: 'AI (GPT) · X-quang', date, ai: { observations: [String(x.text || '')].filter(Boolean), impression: String(x.text || ''), services: (x.services || []).slice(0, 5), review: [] } }); });
      persist(); repaintAll(); if (!quiet) toast('Đã đọc xong ảnh X-quang');
    } catch (e) { S.pano.err = cleanErr(e); } finally { S.pano.busy = false; if (!quiet) render(); }
  }
  async function aiReport(quiet) {
    if (!S.hasKey) { toast('Chưa có khóa API. Vào Cài đặt để nhập khóa OpenAI.'); return; }
    S.rep = { busy: true, err: '' }; if (!quiet) render();
    try {
      const rows = reportRows(), P = S.C.patient;
      const prompt = 'Soạn nội dung phiếu khám gửi cho khách hàng dựa trên dữ liệu sau (không có dữ liệu thì không bịa).\nKhách: năm sinh ' + (P.year || 'không rõ') + ', giới tính ' + (P.gender || 'không rõ') + ', tiền sử: ' + (P.history || 'không ghi') + '.\nRăng đã mất: ' + (S.C.marks.missing.join(', ') || 'không có') + '.\nDữ liệu từng răng (JSON): ' + JSON.stringify(rows.map((r) => ({ rang: r.f, nhan_xet: r.note, da_lam: r.done.map((d) => d.name), can_lam_hoac_theo_doi: r.todo.map((d) => d.name) }))) + '\n' +
        'Yêu cầu: giọng văn trung lập, dễ hiểu cho người không chuyên; không nhắc giá, không ưu đãi, không thúc ép; không dọa. Mỗi ý khuyên dặn là hành động cụ thể. Phần rủi ro nêu điều có thể xảy ra nếu không xử lý hoặc không theo dõi, dùng từ "có thể".\n' +
        'Trả về JSON: {"summary":"3-5 câu tổng quan tình trạng","advice":["3-6 lời khuyên"],"risks":["3-5 điều cần lưu ý trong tương lai"]}. Viết tiếng Việt.';
      const res = await window.api.ai.run({ prompt, images: [] });
      S.C.report.summary = String(res.summary || ''); S.C.report.advice = (res.advice || []).join('\n'); S.C.report.risks = (res.risks || []).join('\n');
      S.rep = { busy: false, err: '' }; persist(); render(); if (!quiet) toast('Đã soạn xong. Hãy đọc lại và chỉnh trước khi xuất PDF.');
    } catch (e) { S.rep = { busy: false, err: cleanErr(e) }; render(); }
  }

  /* ================= PDF ================= */
  function reportRows() {
    const rows = [];
    Object.keys(S.C.teeth).map(Number).sort((a, b) => a - b).forEach((f) => {
      const log = teethLog(f), m = svcMap(f); if (!log.length) return;
      const aiNotes = aiLatest(f).map((e) => e.ai && e.ai.impression).filter(Boolean), notes = log.filter((e) => e.text && (e.kind === 'note' || e.kind === 'done' || (e.kind === 'advice' && e.role === 'Bác sĩ'))).map((e) => e.text);
      const note = aiNotes.concat(notes).filter(Boolean).join('\n');
      const done = [], todo = []; m.forEach((s) => { if (s.done.length) s.done.forEach((d) => done.push({ name: s.name, date: d.date, who: d.who })); else todo.push({ name: s.name, note: s.ai && s.ai.why }); });
      rows.push({ f, note, done, todo });
    });
    return rows;
  }
  async function exportPdf() {
    const C = S.C; if (!Object.keys(S.jaws).length) { toast('Chưa mở scan'); return; }
    S.rep.busy = true; $('busy').hidden = false; await new Promise((r) => setTimeout(r, 40));
    try {
      const rows = reportRows(), states = {}; SEQ.upper.concat(SEQ.lower).forEach((f) => { states[f] = stateOf(f); });
      const done = rows.reduce((a, r) => a + r.done.length, 0), todo = rows.reduce((a, r) => a + r.todo.length, 0);
      const ctx = {
        clinic: S.cfg.clinic, patient: C.patient, code: C.code, summary: C.report.summary,
        advice: C.report.advice.split('\n').map((x) => x.trim()).filter(Boolean), risks: C.report.risks.split('\n').map((x) => x.trim()).filter(Boolean),
        shots: { upper: jawShot('upper'), lower: jawShot('lower') }, states, teethRows: rows,
        counts: { examined: Object.keys(C.teeth).filter((f) => teethLog(f).length).length, done, todo, missing: C.marks.missing.length },
        care: C.care.filter((t) => t.show && !t.done).sort((a, b) => a.due.localeCompare(b.due))
      };
      const name = 'PhieuKham_' + (C.patient.name || C.key).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').replace(/[^A-Za-z0-9]+/g, '_') + '_' + todayIso() + '.pdf';
      const r = await window.api.makePdf({ html: window.buildReport(ctx), name, footerLeft: (S.cfg.clinic.name || '') + ' · Phiếu khám ' + C.code });
      if (r && r.path) toast('Đã lưu PDF');
    } catch (e) { toast('Không xuất được PDF: ' + cleanErr(e)); } finally { S.rep.busy = false; $('busy').hidden = true; }
  }

  /* ================= side panel ================= */
  const STL = { done: ['Đã làm', 'done'], pend: ['Chưa làm', 'pend'], risk: ['Chưa làm, nên sớm', 'risk'], none: ['Chưa có dữ liệu', 'none'], missing: ['Đã mất răng', 'none'] };
  function archStrip() {
    const cell = (f, i) => { const st = stateOf(f), J = S.jaws[jawOf(f)], has = J && J.seeds.some((s) => s.f === f); return '<button type="button" class="t ' + st + (has || st === 'missing' ? '' : ' off') + (i === 8 ? ' g' : '') + '" data-f="' + f + '" aria-pressed="' + (S.sel === f) + '" aria-label="Răng ' + f + '"><i>' + ({ done: '✓', pend: '●', risk: '!', missing: '×', none: '' }[st]) + '</i>' + f + '</button>'; };
    return '<div><div class="arch">' + SEQ.upper.map(cell).join('') + '</div><div class="arch" style="margin-top:3px">' + SEQ.lower.map(cell).join('') + '</div><div class="lg"><span style="--c:var(--done)">Đã làm</span><span style="--c:var(--pend)">Chưa làm</span><span style="--c:var(--risk)">Chưa làm, nên sớm</span><span style="--c:var(--none)">Chưa có dữ liệu</span></div></div>';
  }
  function toothPanel(f) {
    const st = stateOf(f), log = teethLog(f), m = svcMap(f), lastAi = aiLatest(f).length ? aiLatest(f)[0] : null, hasSeed = !!(S.jaws[jawOf(f)] && S.jaws[jawOf(f)].seeds.some((s) => s.f === f));
    let h = '<div class="row sp"><div><h2>Răng ' + f + '</h2><p class="muted small">' + (jawOf(f) === 'upper' ? 'Hàm trên' : 'Hàm dưới') + (f % 10 === 8 ? ' · răng khôn' : '') + '</p></div><span class="b ' + STL[st][1] + '">' + STL[st][0] + '</span></div>';
    h += '<div class="row">' + (hasSeed ? '<button class="btn ghost sm" type="button" data-look="occ">Nhìn mặt nhai</button><button class="btn ghost sm" type="button" data-look="buc">Mặt ngoài</button><button class="btn ghost sm" type="button" data-look="lin">Mặt trong</button>' : '<span class="muted small">Răng này chưa có vị trí trên mô hình.</span><button class="btn ghost sm" type="button" data-act="place">Chỉ vị trí răng này</button>') + (hasSeed ? '<button class="btn ghost sm" type="button" data-act="place">Chỉnh lại vị trí</button>' : '') + '<label class="row small muted" style="margin-left:auto"><input type="checkbox" id="miss" ' + (isMissing(f) ? 'checked' : '') + '> Đã mất răng</label></div>';
    h += '<div class="card ai"><div class="row sp"><h3>AI khám</h3>' + (hasSeed ? '<button class="btn sm" type="button" id="runai"' + (S.ai.busy ? ' disabled' : '') + '>' + (S.ai.busy ? 'Đang phân tích…' : lastAi ? 'Phân tích lại' : 'Phân tích răng này') + '</button>' : '') + '</div>';
    if (S.ai.err) h += '<p class="err">' + esc(S.ai.err) + '</p>';
    if (lastAi) {
      aiLatest(f).forEach((la) => {
        const a = la.ai || {}; a.observations = a.observations || []; a.services = a.services || [];
        h += '<div class="aisrc"><div class="lbl">' + (la.src === 'pano' ? 'Từ ảnh X-quang' : 'Từ scan 3D') + '</div><p>' + esc(a.impression) + '</p>' + (a.observations.length > 1 || (a.observations.length === 1 && a.observations[0] !== a.impression) ? '<ul class="l small">' + a.observations.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '') +
          (a.services.length ? '<div class="row">' + a.services.map((x) => '<span class="b ' + (x.priority === 'cao' ? 'risk' : x.priority === 'thấp' ? 'none' : 'pend') + '">' + esc(x.name) + ' · ' + esc(x.priority) + '</span>').join('') + '</div><ul class="l small muted">' + a.services.filter((x) => x.why).map((x) => '<li><b>' + esc(x.name) + ':</b> ' + esc(x.why) + '</li>').join('') + '</ul>' : '') +
          (a.review && a.review.length ? '<div class="callout">Cần bác sĩ xác nhận: ' + a.review.map(esc).join('; ') + '</div>' : '') + '<p class="muted small">' + esc(la.who) + ' · ' + fmt(la.date) + '. Gợi ý từ hình ảnh, không thay thế khám lâm sàng.</p></div>';
      });
    } else if (!S.ai.busy) h += '<p class="muted small">Chưa có kết quả AI cho răng này.</p>';
    h += '</div><div><div class="lbl">Dịch vụ của răng này</div>';
    if (!m.size) h += '<p class="muted small">Chưa có dịch vụ nào được đề xuất, tư vấn hoặc thực hiện.</p>';
    else {
      h += '<table><thead><tr><th>Dịch vụ</th><th>Tư vấn</th><th>Làm</th></tr></thead><tbody>';
      m.forEach((s) => {
        const adv = s.advice.length ? s.advice.map((e) => '<div class="cell"><b>' + esc(e.who || '?') + '</b><span>' + fmt(e.date) + ' · ' + esc(e.react || '') + '</span></div>').join('') : '<span class="muted small">' + (s.ai ? 'AI đề xuất, chưa ai tư vấn' : '—') + '</span>';
        const dn = s.done.length ? s.done.map((e) => '<div class="cell"><b>' + fmt(e.date) + '</b><span>' + esc(e.who || '') + '</span></div>').join('') : '<span class="b ' + (s.ai && s.ai.priority === 'cao' ? 'risk' : 'pend') + '">Chưa làm</span> <button class="btn ghost sm" type="button" data-fill="' + esc(s.name) + '">Ghi đã làm</button>';
        h += '<tr><td><b>' + esc(s.name) + '</b>' + (s.ai ? '<div class="small muted">AI: ' + esc(s.ai.priority || '') + '</div>' : '') + '</td><td>' + adv + '</td><td>' + dn + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '</div>';
    const F = S.form, opts = CATALOG.map((c) => '<option value="' + esc(c) + '">').join('');
    h += '<div class="card"><h3>Ghi nhận cho răng ' + f + '</h3><div class="seg" role="group">' + [['advice', 'Đã tư vấn'], ['done', 'Đã làm'], ['note', 'Ghi chú']].map((k) => '<button type="button" data-kind="' + k[0] + '" aria-pressed="' + (F.kind === k[0]) + '">' + k[1] + '</button>').join('') + '</div><div class="form">' +
      (F.kind !== 'note' ? '<label class="f">Dịch vụ<input type="text" id="fsvc" list="cat" value="' + esc(F.svc) + '" placeholder="Chọn hoặc gõ tên dịch vụ"><datalist id="cat">' + opts + '</datalist></label>' : '') +
      '<div class="f2"><label class="f">Người ' + (F.kind === 'advice' ? 'tư vấn' : F.kind === 'done' ? 'thực hiện' : 'ghi') + '<input type="text" id="fwho" value="' + esc(F.who) + '" placeholder="Tên"></label><label class="f">Vai trò<select id="frole">' + ['Bác sĩ', 'Sale', 'Lễ tân', 'Trợ thủ'].map((r) => '<option' + (r === F.role ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></label></div>' +
      '<div class="f2"><label class="f">Ngày<input type="date" id="fdate" value="' + F.date + '"></label>' + (F.kind === 'advice' ? '<label class="f">Khách phản hồi<select id="freact">' + ['Đang cân nhắc', 'Đồng ý', 'Từ chối', 'Hẹn lại'].map((r) => '<option' + (r === F.react ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></label>' : '<span></span>') + '</div>' +
      '<label class="f">Ghi chú<textarea id="ftext" placeholder="Chi tiết: vật liệu, lý do, dặn dò…">' + esc(F.text) + '</textarea></label><div class="row"><button class="btn" type="button" id="save">Lưu vào răng ' + f + '</button></div></div></div>';
    h += '<div><div class="lbl">Lịch sử răng ' + f + '</div><div>' + (log.length ? log.slice().reverse().map((e) => {
      const k = { ai: 'AI khám', advice: 'Tư vấn', done: 'Đã làm', note: 'Ghi chú' }[e.kind], body = e.kind === 'ai' ? esc((e.ai && e.ai.impression) || '') : '<b>' + esc(e.svc || '') + '</b>' + (e.react ? ' · ' + esc(e.react) : '') + (e.text ? '<q>' + esc(e.text) + '</q>' : '');
      return '<div class="ev"><time>' + fmt(e.date) + '</time><div><span class="b ' + (e.kind === 'done' ? 'done' : e.kind === 'ai' ? 'sel' : 'none') + '">' + k + '</span> <span class="muted small">' + esc(e.who || '') + (e.role ? ' (' + esc(e.role) + ')' : '') + '</span><div>' + body + '</div>' + (e.kind !== 'ai' ? '<button class="btn ghost sm" type="button" data-del="' + e.id + '" style="margin-top:4px">Xóa</button>' : '') + '</div></div>';
    }).join('') : '<p class="muted small">Chưa có lịch sử.</p>') + '</div></div>';
    return h;
  }
  const jawName = (jn) => (jn === 'upper' ? 'hàm trên' : 'hàm dưới');
  const allSeeds = () => { const o = []; Object.values(S.jaws).forEach((J) => J.seeds.forEach((q) => o.push(q.f))); return o.sort((a, b) => ordOf(a) - ordOf(b)); };
  function scanPanel() {
    const sc = S.scan, seeds = allSeeds(), nAi = seeds.filter((f) => teethLog(f).some((e) => e.kind === 'ai' && !e.src)).length, det = S.C.detect || {};
    let h = '<div class="card ai"><div class="row sp"><h3>Quét AI</h3><button class="btn sm" type="button" id="scanall"' + (sc.busy ? ' disabled' : '') + '>' + (sc.busy ? 'Đang quét…' : seeds.length ? (nAi >= seeds.length ? 'Quét lại toàn bộ' : 'Quét AI') : 'Nhận diện và quét') + '</button></div>';
    h += '<p class="small">' + (seeds.length ? 'Đã nhận diện <b>' + seeds.length + '</b> răng, AI đã khám <b>' + nAi + '/' + seeds.length + '</b> răng.' : 'Chưa nhận diện răng nào trên mô hình.') + '</p>';
    if (!S.hasKey) h += '<div class="callout">Chưa có khóa OpenAI. Vào <b>Cài đặt</b> nhập khóa để AI phân tích từng răng.</div>';
    sc.warn.forEach((w) => { h += '<div class="callout">' + esc(w) + '</div>'; });
    if (sc.err && !sc.busy) h += '<p class="err">' + esc(sc.err) + '</p>';
    h += '</div>';
    h += '<div class="card"><h3>Kiểm tra số răng</h3><p class="small muted">Máy tự đoán vị trí và số thứ tự răng từ scan, nên bác sĩ hãy nhìn lướt các số trên mô hình. Nếu thấy nhầm, sửa ngay tại đây:</p><div class="row">';
    ['upper', 'lower'].forEach((jn) => { if (!S.jaws[jn]) return; h += '<button class="btn ghost sm" type="button" data-act="redetect" data-jaw="' + jn + '"' + (sc.busy ? ' disabled' : '') + '>Nhận diện lại ' + jawName(jn) + '</button><button class="btn ghost sm" type="button" data-act="flip" data-jaw="' + jn + '"' + (sc.busy ? ' disabled' : '') + '>Đảo trái/phải ' + jawName(jn) + '</button>'; });
    h += '</div><p class="small muted">Một răng sai vị trí: vào tab "Thăm khám của bác sĩ", chọn răng đó rồi bấm "Chỉnh lại vị trí". Muốn tự bấm cả hàm: nút "Đánh dấu thủ công" phía trên mô hình.' + (det.upper || det.lower ? '' : '') + '</p></div>';
    h += '<div class="card"><div class="row sp"><h3>X-quang / Panorama</h3><label class="btn ghost sm" style="cursor:pointer">' + (S.pano.url ? 'Đổi ảnh' : 'Thêm ảnh') + '<input type="file" id="panoFile" accept="image/png,image/jpeg,image/webp" hidden></label></div>';
    if (S.pano.url) {
      h += '<img class="pano" src="' + S.pano.url + '" alt="Ảnh X-quang của khách"><div class="row"><button class="btn sm" type="button" id="runpano"' + (S.pano.busy ? ' disabled' : '') + '>' + (S.pano.busy ? 'Đang đọc ảnh…' : S.C.pano && S.C.pano.result ? 'Đọc lại ảnh' : 'AI đọc ảnh X-quang') + '</button></div>';
      if (S.pano.err) h += '<p class="err">' + esc(S.pano.err) + '</p>';
      const r = S.C.pano && S.C.pano.result; if (r) h += '<p>' + esc(r.summary) + '</p>' + (r.general.length ? '<ul class="l small">' + r.general.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') + (r.review.length ? '<div class="callout">Cần bác sĩ xác nhận: ' + r.review.map(esc).join('; ') + '</div>' : '') + '<p class="muted small">' + r.count + ' răng có ghi nhận từ X-quang (xem trong hồ sơ từng răng). ' + fmt(r.date) + '</p>';
    } else h += '<p class="small muted">Thêm ảnh X-quang toàn cảnh (JPG, PNG) để AI đọc cùng với scan 3D. CT dạng DICOM chưa đọc trực tiếp được, hãy xuất ảnh lát cắt hoặc ảnh toàn cảnh.</p>';
    h += '</div>';
    if (seeds.length) {
      h += '<div><div class="lbl">Kết quả từng răng</div><div class="slist">' + seeds.map((f) => {
        const st = stateOf(f), la = aiLatest(f), a = la.length ? la[0].ai : null, running = FX.rings.has(f);
        const sv = a ? (a.services || []).slice(0, 3).map((x) => '<span class="b ' + (x.priority === 'cao' ? 'risk' : x.priority === 'thấp' ? 'none' : 'pend') + '">' + esc(x.name) + '</span>').join('') : '';
        return '<button type="button" class="srow' + (S.sel === f ? ' on' : '') + '" data-f="' + f + '"><span class="tn ' + st + '">' + f + '</span><span class="sb2"><span class="small">' + (running ? 'Đang quét…' : a ? esc(a.impression || 'Đã quét') : '<i class="muted">Chưa quét</i>') + '</span>' + (sv ? '<span class="row">' + sv + '</span>' : '') + '</span></button>';
      }).join('') + '</div></div>';
    }
    return h;
  }
  /* ---- Chăm sóc (đã làm) và Chưa làm: bảng dịch vụ, tick răng, sáng răng trên mô hình ---- */
  function allServices() { const m = new Map(); CATALOG.concat(S.C.services || []).forEach((n) => m.set(norm(n), n)); Object.keys(S.C.teeth).forEach((f) => teethLog(+f).forEach((e) => { if (e.svc && (e.kind === 'advice' || e.kind === 'done') && !m.has(norm(e.svc))) m.set(norm(e.svc), e.svc); })); return Array.from(m.values()); }
  function teethOfSvc(name, mode) {
    const k = norm(name), out = [];
    ORDER.forEach((f) => { const o = svcMap(f).get(k); if (!o) return; if (mode === 'done' ? o.done.length : (!o.done.length && (o.ai || o.advice.length))) out.push(f); });
    return out;
  }
  const hasSeed = (f) => !!(S.jaws[jawOf(f)] && S.jaws[jawOf(f)].seeds.some((q) => q.f === f));
  function ckGrid(name, mode) {
    const k = norm(name), cell = (f, i) => {
      const o = svcMap(f).get(k), done = !!(o && o.done.length), viaCare = done && o.done.every((e) => e.via === 'care'), off = !hasSeed(f) || isMissing(f), dis = off || (done && !viaCare);
      return '<label class="ck' + (off ? ' off' : '') + (i === 8 ? ' g' : '') + '" title="' + (done && !viaCare ? 'Đã ghi ở tab Thăm khám, sửa ở đó' : off ? 'Răng chưa có trên mô hình' : '') + '"><input type="checkbox" data-ck="' + esc(name) + '|' + f + '"' + (done ? ' checked' : '') + (dis ? ' disabled' : '') + '><span>' + f + '</span></label>';
    };
    return '<div class="ckg"><div class="arch">' + SEQ.upper.map(cell).join('') + '</div><div class="arch">' + SEQ.lower.map(cell).join('') + '</div></div>';
  }
  function svcPanel(mode) {
    const list = allServices().map((n) => ({ n, t: teethOfSvc(n, mode) })).sort((a, b) => (b.t.length > 0) - (a.t.length > 0) || b.t.length - a.t.length);
    const shown = mode === 'todo' ? list.filter((x) => x.t.length) : list;
    let h = mode === 'done' ? '<div><div class="lbl">Dịch vụ đã làm</div><p class="small muted">Bấm vào một dịch vụ để mở bảng răng và tick những răng đã làm. Rê chuột hoặc bấm vào dịch vụ, các răng đã làm dịch vụ đó sẽ sáng lên trên mô hình 3D.</p></div>' : '<div><div class="lbl">Dịch vụ chưa làm</div><p class="small muted">Những dịch vụ AI hoặc nhân viên đã đề xuất nhưng chưa làm. Rê chuột hoặc bấm vào dịch vụ để xem răng nào trên mô hình. Tick vào răng khi đã làm xong, dịch vụ sẽ chuyển sang tab Chăm sóc.</p></div>';
    if (!shown.length) h += '<p class="muted small">' + (mode === 'todo' ? 'Chưa có dịch vụ nào đang chờ làm.' : 'Chưa có dịch vụ.') + '</p>';
    h += '<div class="svcs">' + shown.map(({ n, t }) => {
      const open = S.care.open === mode + '|' + norm(n), risk = mode === 'todo' && t.some((f) => { const o = svcMap(f).get(norm(n)); return o && o.ai && o.ai.priority === 'cao'; });
      let body = '';
      if (open) {
        if (mode === 'done') body = ckGrid(n, mode) + '<p class="small muted">Tick = răng đã làm hôm nay (ghi tên người thực hiện ở tab Thăm khám nếu cần chi tiết).</p>';
        else body = '<div class="trows">' + t.map((f) => { const o = svcMap(f).get(norm(n)), adv = o.advice.map((e) => esc(e.who || '?') + ' tư vấn ' + fmt(e.date) + (e.react ? ' · ' + esc(e.react) : '')).join('; '); return '<div class="trow"><button class="btn ghost sm" type="button" data-f="' + f + '">' + f + '</button><span class="small">' + (o.ai ? 'AI đề xuất (' + esc(o.ai.priority || '') + ')' + (o.ai.why ? ': ' + esc(o.ai.why) : '') : '') + (o.ai && adv ? '<br>' : '') + (adv || (o.ai ? '' : '—')) + '</span><label class="ck1"><input type="checkbox" data-ck="' + esc(n) + '|' + f + '"> Đã làm</label></div>'; }).join('') + '</div>'; 
      }
      return '<div class="svc' + (open ? ' open' : '') + '" data-svc="' + esc(n) + '" data-mode="' + mode + '"><button type="button" class="sh2" data-svc-h="1"><span>' + esc(n) + '</span><span class="row">' + (risk ? '<span class="b risk">nên sớm</span>' : '') + '<span class="b ' + (t.length ? (mode === 'done' ? 'done' : 'pend') : 'none') + '">' + (t.length ? t.length + ' răng' : 'chưa có') + '</span></span></button>' + (open ? '<div class="svb">' + body + '</div>' : '') + '</div>';
    }).join('') + '</div>';
    if (mode === 'done') h += '<div class="row"><input type="text" id="newsvc" placeholder="Thêm dịch vụ khác, ví dụ Mão sứ Katana" style="flex:1"><button class="btn ghost sm" type="button" id="addsvc">Thêm</button></div>';
    return h;
  }
  function docPanel() {
    const P = S.C.patient, R = S.C.report;
    return '<div class="card"><h3>Thông tin khách</h3><div class="form"><label class="f">Họ và tên<input type="text" data-p="name" value="' + esc(P.name) + '"></label>' +
      '<div class="f3"><label class="f">Năm sinh<input type="text" data-p="year" value="' + esc(P.year) + '"></label><label class="f">Giới tính<select data-p="gender">' + ['', 'Nam', 'Nữ'].map((g) => '<option' + (g === P.gender ? ' selected' : '') + '>' + g + '</option>').join('') + '</select></label><label class="f">Điện thoại<input type="text" data-p="phone" value="' + esc(P.phone) + '"></label></div>' +
      '<div class="f2"><label class="f">Bác sĩ khám<input type="text" data-p="doctor" value="' + esc(P.doctor) + '" placeholder="' + esc(S.cfg.clinic.doctor) + '"></label><label class="f">Ngày khám<input type="date" data-p="visitDate" value="' + esc(P.visitDate) + '"></label></div>' +
      '<label class="f">Tiền sử, lưu ý (dị ứng, bệnh nền, thuốc đang dùng)<textarea data-p="history">' + esc(P.history) + '</textarea></label></div></div>' +
      '<div class="card"><div class="row sp"><h3>Nội dung phiếu gửi khách</h3><button class="btn sm" type="button" id="airep"' + (S.rep.busy ? ' disabled' : '') + '>' + (S.rep.busy ? 'Đang soạn…' : 'AI soạn nội dung') + '</button></div>' +
      (S.rep.err ? '<p class="err">' + esc(S.rep.err) + '</p>' : '') +
      '<label class="f">Nhận định tổng quan<textarea data-r="summary" style="min-height:110px">' + esc(R.summary) + '</textarea></label>' +
      '<label class="f">Lời khuyên (mỗi dòng một ý)<textarea data-r="advice" style="min-height:100px">' + esc(R.advice) + '</textarea></label>' +
      '<label class="f">Những điều cần lưu ý trong tương lai (mỗi dòng một ý)<textarea data-r="risks" style="min-height:100px">' + esc(R.risks) + '</textarea></label>' +
      '<p class="muted small">AI soạn xong, bác sĩ đọc và sửa lại trước khi gửi cho khách. Phiếu không có giá hay nội dung bán hàng.</p></div>' +
      '<div class="row"><button class="btn" type="button" id="pdf">Xuất phiếu khám PDF</button><span class="muted small">Gồm ảnh scan 2 hàm, sơ đồ răng, chi tiết từng răng, lời khuyên, lịch tái khám.</span></div>';
  }
  function callPanel() {
    const list = S.C.care.slice().sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
    return '<div class="row sp"><h3>Lịch gọi chăm sóc khách</h3><button class="btn ghost sm" type="button" id="stdcare">Tạo lịch chuẩn</button></div>' +
      '<div>' + (list.length ? list.map((t) => { const [k, l] = dueBadge(t.due); return '<div class="task ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-td="' + t.id + '" ' + (t.done ? 'checked' : '') + ' aria-label="Đã gọi"><div><b>' + esc(t.title) + '</b>' + (t.note ? '<div class="muted small">' + esc(t.note) + '</div>' : '') + '<label class="row small muted"><input type="checkbox" data-ts="' + t.id + '" ' + (t.show ? 'checked' : '') + '> Ghi vào phiếu của khách</label></div><div class="row"><span class="b ' + (t.done ? 'done' : k) + '">' + (t.done ? 'Đã gọi' : l) + '</span><button class="btn ghost sm" type="button" data-tx="' + t.id + '">Xóa</button></div></div>'; }).join('') : '<p class="muted small">Chưa có lịch. Bấm "Tạo lịch chuẩn" để tạo hẹn hỏi thăm sau 7 ngày, cạo vôi sau 6 tháng, tái khám sau 12 tháng.</p>') + '</div>' +
      '<div class="card"><h3>Thêm lịch</h3><div class="form"><label class="f">Nội dung<input type="text" id="ctitle" placeholder="Ví dụ: Gọi hỏi thăm sau khi bọc sứ răng 36"></label><div class="f2"><label class="f">Ngày<input type="date" id="cdue" value="' + addDays(7) + '"></label><label class="f">Ghi chú<input type="text" id="cnote"></label></div><label class="row small muted"><input type="checkbox" id="cshow"> Ghi vào phiếu của khách</label><div class="row"><button class="btn" type="button" id="cadd">Thêm</button></div></div></div>';
  }
  function syncTabs() { document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab)); }
  function render() {
    if (S.view !== 'case' || !S.C) return;
    const has = Object.keys(S.jaws).length > 0, seeds = Object.values(S.jaws).reduce((a, J) => a + J.seeds.length, 0);
    $('caseT').textContent = S.C.patient.name || S.C.key; $('caseS').textContent = 'Mã hồ sơ ' + S.C.code + ' · tự lưu trên máy này';
    $('tU').hidden = !S.jaws.upper; $('tL').hidden = !S.jaws.lower; $('markU').hidden = !S.jaws.upper || !!S.mark; $('markL').hidden = !S.jaws.lower || !!S.mark;
    const aa = $('aiAll'); aa.hidden = false; aa.disabled = S.scan.busy; aa.textContent = S.scan.busy ? 'Đang quét…' : 'Quét AI';
    $('stat').innerHTML = '<b>' + seeds + '</b> răng đã đánh dấu';
    const sb = $('sb'), top = sb.scrollTop; let h = '';
    if (S.tab === 'doc') h = docPanel();
    else if (S.tab === 'care') h = svcPanel('done') + '<div style="margin-top:6px">' + callPanel() + '</div>';
    else if (S.tab === 'todo') h = svcPanel('todo');
    else if (S.tab === 'scan') h = scanPanel();
    else {
      h = archStrip();
      if (S.sel != null) h += toothPanel(S.sel);
      else h += seeds ? '<p class="muted">Bấm vào một răng trên mô hình, hoặc số răng ở sơ đồ trên, để ghi nhận thăm khám của bác sĩ cho răng đó: đã tư vấn gì, đã làm gì, ghi chú.</p>' : '<div class="callout">Chưa có răng nào trên mô hình. Sang tab "Quét AI" để máy nhận diện răng.</div>';
    }
    const act = document.activeElement && document.activeElement.id; sb.innerHTML = h; sb.scrollTop = top;
    if (act && $(act) && /^f(svc|who|text|date)$/.test(act)) $(act).focus();
    $('vT').checked = S.tint;
  }

  /* ---- tô sáng răng theo dịch vụ, tick răng, đảo số, đặt lại vị trí ---- */
  function teethSet(name, mode) { return new Set(name ? teethOfSvc(name, mode) : []); }
  function revealTeeth(set) {
    let ch = false; set.forEach((f) => { const J = S.jaws[jawOf(f)]; if (J && !J.mesh.visible) { J.mesh.visible = true; ch = true; } });
    if (ch) { $('vU').checked = !!(S.jaws.upper && S.jaws.upper.mesh.visible); $('vL').checked = !!(S.jaws.lower && S.jaws.lower.mesh.visible); }
  }
  function setHover(name, mode) { const set = teethSet(name, mode); FX.color = mode === 'done' ? HL.done : HL.todo; FX.hover = set; revealTeeth(set); draw(); }
  function setPin(name, mode) {
    S.care.pin = name ? { name, mode } : null; const set = teethSet(name, mode); FX.color = mode === 'done' ? HL.done : HL.todo; FX.pin = set;
    focusSet(set);
  }
  function focusSet(set) { if (!set.size) return; const jaws = new Set(Array.from(set).map(jawOf)); if (jaws.size === 1) viewJawOnly(Array.from(jaws)[0]); else showBothJaws(); }
  function refreshPin() { if (S.care.pin) { const had = FX.pin.size; FX.pin = teethSet(S.care.pin.name, S.care.pin.mode); if (!had && FX.pin.size) focusSet(FX.pin); } }
  function toggleDone(name, f, on) {
    const k = norm(name), log = teethLog(f).slice();
    if (on) { log.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), kind: 'done', who: S.form.who || S.cfg.clinic.doctor || '', role: S.form.role, svc: name, date: todayIso(), react: '', text: '', via: 'care' }); S.C.teeth[f] = log; }
    else S.C.teeth[f] = log.filter((e) => !(e.kind === 'done' && norm(e.svc) === k && e.via === 'care'));
    persist(); refreshPin(); repaintAll(); render();
  }
  function flipJaw(jn) {
    const J = S.jaws[jn]; if (!J) return; const m = (f) => ((f >= 11 && f <= 18) || (f >= 31 && f <= 38) ? f + 10 : f - 10);
    J.seeds.forEach((q) => (q.f = m(q.f))); S.C.marks.missing = S.C.marks.missing.map((f) => (jawOf(f) === jn ? m(f) : f));
    const nt = {}; Object.keys(S.C.teeth).forEach((k) => { const f = +k; nt[jawOf(f) === jn ? m(f) : f] = S.C.teeth[k]; }); S.C.teeth = nt;
    recompute(J); saveMarks(); persist(); repaintAll(); render(); toast('Đã đảo số răng trái/phải của ' + jawName(jn));
  }
  async function bytesOf(f) { return f.buf ? toAB(f.buf) : await f.arrayBuffer(); }
  async function attachPano(file) {
    const bytes = await bytesOf(file), bmp = await createImageBitmap(new Blob([bytes])), k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height)), c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.88), bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    await window.api.cases.saveScan(S.C.key, 'pano', 'jpg', arr.buffer); S.C.pano = { ext: 'jpg', date: todayIso(), result: null }; S.pano.url = url; S.pano.err = ''; persist();
  }

  /* ================= side panel events ================= */
  $('sb').addEventListener('click', (e) => {
    const t = e.target, f = t.closest('[data-f]'); if (f) { select(+f.dataset.f); return; }
    const look = t.closest('[data-look]'); if (look) { lookTooth(look.dataset.look); return; }
    const kind = t.closest('[data-kind]'); if (kind) { S.form.kind = kind.dataset.kind; render(); return; }
    const fill = t.closest('[data-fill]'); if (fill) { S.form.kind = 'done'; S.form.svc = fill.dataset.fill; render(); const el = $('fwho'); if (el) el.focus(); return; }
    const del = t.closest('[data-del]'); if (del) { delLog(S.sel, del.dataset.del); return; }
    const tx = t.closest('[data-tx]'); if (tx) { S.C.care = S.C.care.filter((x) => x.id !== tx.dataset.tx); persist(); render(); return; }
    const act = t.closest('[data-act]');
    if (act) {
      const a = act.dataset.act, jn = act.dataset.jaw;
      if (a === 'redetect' && window.confirm('Nhận diện lại sẽ đặt lại vị trí và số răng của ' + jawName(jn) + '. Hồ sơ đã ghi cho từng răng vẫn giữ nguyên. Tiếp tục?')) runScan({ redetect: true, only: jn });
      if (a === 'flip' && window.confirm('Đảo số răng trái/phải của ' + jawName(jn) + '? Hồ sơ đã ghi cũng được đảo theo.')) flipJaw(jn);
      if (a === 'place' && S.sel != null) startMark(jawOf(S.sel), S.sel);
      return;
    }
    const sh = t.closest('[data-svc-h]');
    if (sh) { const row = sh.closest('[data-svc]'), key = row.dataset.mode + '|' + norm(row.dataset.svc), opening = S.care.open !== key; S.care.open = opening ? key : null; if (opening) setPin(row.dataset.svc, row.dataset.mode); else { S.care.pin = null; FX.pin = new Set(); } render(); return; }
    if (t.id === 'scanall') runScan({ all: false });
    if (t.id === 'runpano') runPano(false);
    if (t.id === 'addsvc') { const v = $('newsvc').value.trim(); if (!v) return; S.C.services = S.C.services || []; if (!allServices().some((x) => norm(x) === norm(v))) S.C.services.push(v); persist(); S.care.open = 'done|' + norm(v); setPin(v, 'done'); render(); return; }
    if (t.id === 'runai') runAi(S.sel);
    if (t.id === 'airep') aiReport();
    if (t.id === 'pdf') exportPdf();
    if (t.id === 'stdcare') { [['Gọi hỏi thăm sau buổi khám / điều trị', 7, false], ['Nhắc cạo vôi, kiểm tra định kỳ', 180, true], ['Tái khám tổng quát', 365, true]].forEach((x) => S.C.care.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), title: x[0], due: addDays(x[1]), done: false, show: x[2], note: '' })); persist(); render(); }
    if (t.id === 'cadd') { const title = $('ctitle').value.trim(); if (!title) { toast('Nhập nội dung lịch'); return; } S.C.care.push({ id: Date.now().toString(36), title, due: $('cdue').value || addDays(7), done: false, show: $('cshow').checked, note: $('cnote').value.trim() }); persist(); render(); }
    if (t.id === 'save') {
      const F = S.form; if (F.kind !== 'note' && !F.svc.trim()) { toast('Nhập tên dịch vụ'); return; } if (F.kind === 'note' && !F.text.trim()) { toast('Nhập nội dung ghi chú'); return; } if (!F.who.trim()) { toast('Nhập tên người thực hiện hoặc tư vấn'); return; }
      try { localStorage.setItem('kr_who', F.who); localStorage.setItem('kr_role', F.role); } catch (er) {}
      addLog(S.sel, { kind: F.kind, who: F.who.trim(), role: F.role, svc: F.svc.trim(), date: F.date || todayIso(), react: F.kind === 'advice' ? F.react : '', text: F.text.trim() });
      S.form.svc = ''; S.form.text = ''; render(); toast('Đã lưu vào răng ' + S.sel);
    }
  });
  $('sb').addEventListener('input', (e) => {
    const m = { fsvc: 'svc', fwho: 'who', ftext: 'text', fdate: 'date' }[e.target.id]; if (m) S.form[m] = e.target.value;
    if (e.target.dataset.p) { S.C.patient[e.target.dataset.p] = e.target.value; persist(); if (e.target.dataset.p === 'name') $('caseT').textContent = e.target.value; }
    if (e.target.dataset.r) { S.C.report[e.target.dataset.r] = e.target.value; persist(); }
  });
  $('sb').addEventListener('change', (e) => {
    const id = e.target.id; if (id === 'frole') S.form.role = e.target.value; if (id === 'freact') S.form.react = e.target.value;
    if (e.target.dataset.p === 'gender') { S.C.patient.gender = e.target.value; persist(); }
    if (id === 'miss') { const f = S.sel; S.C.marks.missing = S.C.marks.missing.filter((x) => x !== f); if (e.target.checked) { S.C.marks.missing.push(f); const J = S.jaws[jawOf(f)]; if (J) { J.seeds = J.seeds.filter((q) => q.f !== f); recompute(J); saveMarks(); } } persist(); repaintAll(); render(); }
    if (e.target.dataset.ck) { const v = e.target.dataset.ck, i = v.lastIndexOf('|'); toggleDone(v.slice(0, i), +v.slice(i + 1), e.target.checked); }
    if (id === 'panoFile' && e.target.files[0]) { const fl = e.target.files[0]; attachPano(fl).then(() => { render(); toast('Đã thêm ảnh X-quang'); }).catch((er) => toast('Không đọc được ảnh: ' + cleanErr(er))); }
    if (e.target.dataset.td) { const t = S.C.care.find((x) => x.id === e.target.dataset.td); if (t) { t.done = e.target.checked; persist(); render(); } }
    if (e.target.dataset.ts) { const t = S.C.care.find((x) => x.id === e.target.dataset.ts); if (t) { t.show = e.target.checked; persist(); } }
  });
  let hoverKey = '';
  $('sb').addEventListener('mouseover', (e) => { const r = e.target.closest('[data-svc]'); const key = r ? r.dataset.mode + '|' + r.dataset.svc : ''; if (key === hoverKey) return; hoverKey = key; if (r) setHover(r.dataset.svc, r.dataset.mode); else { FX.hover = new Set(); draw(); } });
  $('sb').addEventListener('mouseleave', () => { hoverKey = ''; FX.hover = new Set(); draw(); });
  document.querySelector('#vCase .tabs').addEventListener('click', (e) => {
    const t = e.target.dataset.tab; if (!t) return; S.tab = t; syncTabs(); FX.hover = new Set(); FX.pin = new Set(); S.care.pin = null; hoverKey = '';
    if (t !== 'exam' && !S.scan.busy && !S.mark) { const hid = Object.values(S.jaws).some((J) => !J.mesh.visible); if (hid) showBothJaws(); }
    render();
  });
  $('vU').onchange = (e) => { if (S.jaws.upper) { S.jaws.upper.mesh.visible = e.target.checked; draw(); } };
  $('vL').onchange = (e) => { if (S.jaws.lower) { S.jaws.lower.mesh.visible = e.target.checked; draw(); } };
  $('vT').onchange = (e) => { S.tint = e.target.checked; repaintAll(); };

  /* ================= opening and creating cases ================= */
  const slugOf = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'khach';
  async function readEntries(files) {
    const out = [];
    for (const f of files) {
      if (/\.zip$/i.test(f.name)) {
        const buf = f.buf || (await f.arrayBuffer()), z = await JSZip.loadAsync(toAB(buf));
        for (const n of Object.keys(z.files)) if (!z.files[n].dir && /\.(ply|stl)$/i.test(n) && !/__MACOSX/.test(n)) out.push({ name: n, buf: await z.files[n].async('arraybuffer') });
      } else if (/\.(ply|stl)$/i.test(f.name)) out.push({ name: f.name, buf: toAB(f.buf || (await f.arrayBuffer())) });
    }
    return out;
  }
  async function importFiles(files) {
    const imgs = files.filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name)), rest = files.filter((f) => imgs.indexOf(f) < 0);
    if (!rest.length && imgs.length) {
      if (S.view === 'case' && S.C) { try { await attachPano(imgs[0]); S.tab = 'scan'; syncTabs(); render(); toast('Đã thêm ảnh X-quang. Bấm "AI đọc ảnh X-quang" để phân tích.'); } catch (er) { toast('Không đọc được ảnh: ' + cleanErr(er)); } }
      else toast('Hãy mở scan của khách trước, rồi thêm ảnh X-quang.');
      return;
    }
    $('busy').hidden = false; await new Promise((r) => setTimeout(r, 40)); let fresh = false;
    try {
      const entries = await readEntries(rest), pick = {};
      for (const e of entries) {
        const base = e.name.split(/[\\/]/).pop().replace(/\.(ply|stl)$/i, ''), m = base.match(/^(.*?)-?(upperjaw|lowerjaw)$/i); if (!m) continue;
        const jn = m[2].toLowerCase() === 'upperjaw' ? 'upper' : 'lower';
        if (!pick[jn] || (/\.ply$/i.test(e.name) && !/\.ply$/i.test(pick[jn].name))) pick[jn] = Object.assign({ patient: m[1] }, e);
      }
      if (!pick.upper && !pick.lower) { toast('Không thấy file upperjaw hoặc lowerjaw (.ply, .stl)'); return; }
      const pat = (pick.upper || pick.lower).patient.replace(/^Ca\s+c(ủa|#U1ee7a)\s*/i, '').replace(/[-_ ]+$/, ''), key = slugOf(pat);
      const ex = await window.api.cases.load(key);
      S.C = ex ? ex.data : newCase(key, pat); S.C.marks = S.C.marks || { upper: [], lower: [], missing: [] }; S.C.teeth = S.C.teeth || {}; S.C.care = S.C.care || []; S.C.report = S.C.report || { summary: '', advice: '', risks: '' };
      for (const jn of Object.keys(pick)) { const ext = /\.stl$/i.test(pick[jn].name) ? 'stl' : 'ply'; await window.api.cases.saveScan(key, jn, ext, pick[jn].buf); }
      S.pano = { url: '', busy: false, err: '' }; if (ex && ex.scans.pano) S.pano.url = URL.createObjectURL(new Blob([toAB(ex.scans.pano.buf)], { type: 'image/jpeg' }));
      if (imgs.length) await attachPano(imgs[0]);
      await window.api.cases.save(key, S.C);
      clearJaws(); for (const jn of Object.keys(pick)) buildJaw(jn, /\.stl$/i.test(pick[jn].name) ? 'stl' : 'ply', pick[jn].buf);
      fresh = !((S.C.marks.upper || []).length || (S.C.marks.lower || []).length);
      enterCase();
    } catch (err) { console.error(err); toast('Không đọc được file: ' + cleanErr(err)); } finally { $('busy').hidden = true; }
    if (fresh && S.C) runScan({});
  }
  function newCase(key, name) {
    const d = new Date();
    return { key, code: 'HS' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(), created: todayIso(), updated: todayIso(), patient: { name, year: '', gender: '', phone: '', doctor: '', visitDate: todayIso(), history: '' }, marks: { upper: [], lower: [], missing: [] }, teeth: {}, report: { summary: '', advice: '', risks: '' }, care: [], services: [], detect: {}, pano: null };
  }
  async function openCase(key) {
    $('busy').hidden = false; await new Promise((r) => setTimeout(r, 30));
    try {
      const res = await window.api.cases.load(key); if (!res) { toast('Không mở được hồ sơ'); return; }
      S.C = res.data; S.C.marks = S.C.marks || { upper: [], lower: [], missing: [] }; S.C.teeth = S.C.teeth || {}; S.C.care = S.C.care || []; S.C.report = S.C.report || { summary: '', advice: '', risks: '' };
      S.pano = { url: '', busy: false, err: '' }; if (res.scans.pano) S.pano.url = URL.createObjectURL(new Blob([toAB(res.scans.pano.buf)], { type: 'image/' + (res.scans.pano.ext === 'jpg' ? 'jpeg' : res.scans.pano.ext) }));
      clearJaws(); for (const jn of ['upper', 'lower']) if (res.scans[jn]) buildJaw(jn, res.scans[jn].ext, toAB(res.scans[jn].buf));
      enterCase();
    } catch (err) { console.error(err); toast('Không mở được hồ sơ: ' + cleanErr(err)); } finally { $('busy').hidden = true; }
  }
  function enterCase() { fxClear(); S.sel = null; S.mark = null; S.tab = 'scan'; S.care = { open: null, pin: null }; S.scan = { busy: false, phase: '', jaw: '', done: 0, total: 0, fail: [], err: '', cur: null, cancel: false, warn: [] }; $('hud').hidden = true; S.tint = true; syncTabs(); show('case'); resize(); fitAll(); setView('front'); $('vU').checked = true; $('vL').checked = true; Object.values(S.jaws).forEach((J) => (J.mesh.visible = true)); applyMarks(); render(); markGuide(); }

  /* ================= home ================= */
  function pendingOf(C) { let n = 0; Object.keys(C.teeth || {}).forEach((f) => { const m = new Map(); (C.teeth[f] || []).forEach((e) => { if (!e.svc) return; const k = norm(e.svc); const o = m.get(k) || { done: false }; if (e.kind === 'done') o.done = true; if (e.kind === 'advice' || e.kind === 'done') m.set(k, o); }); m.forEach((o) => { if (!o.done) n++; }); }); return n; }
  async function loadHome() {
    S.cases = await window.api.cases.list(); const q = norm($('q').value);
    const list = S.cases.filter((c) => !q || norm(c.patient.name).includes(q)).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''));
    const tbl = $('caseTbl');
    tbl.innerHTML = list.length ? '<thead><tr><th>Khách hàng</th><th>Cập nhật</th><th>Răng đã đánh dấu</th><th>Chưa làm</th><th>Lịch gọi tới</th><th></th></tr></thead><tbody>' + list.map((c) => {
      const marked = ['upper', 'lower'].reduce((a, j) => a + ((c.marks && c.marks[j]) || []).length, 0), nxt = (c.care || []).filter((t) => !t.done).sort((a, b) => a.due.localeCompare(b.due))[0], pn = pendingOf(c);
      return '<tr class="click" data-open="' + esc(c.key) + '"><td><b>' + esc(c.patient.name) + '</b><div class="muted small">' + esc(c.code) + '</div></td><td>' + fmt(c.updated) + '</td><td>' + marked + '</td><td>' + (pn ? '<span class="b pend">' + pn + ' hạng mục</span>' : '<span class="muted">—</span>') + '</td><td>' + (nxt ? '<span class="b ' + dueBadge(nxt.due)[0] + '">' + dueBadge(nxt.due)[1] + '</span>' : '<span class="muted">—</span>') + '</td><td><button class="btn danger sm" type="button" data-rm="' + esc(c.key) + '">Xóa</button></td></tr>';
    }).join('') + '</tbody>' : '<tbody><tr><td class="empty">Chưa có khách nào. Bấm "Mở scan khách mới" để bắt đầu.</td></tr></tbody>';
    const due = []; S.cases.forEach((c) => (c.care || []).filter((t) => !t.done && diffDays(t.due) <= 7).forEach((t) => due.push({ c, t }))); due.sort((a, b) => a.t.due.localeCompare(b.t.due));
    $('dueList').innerHTML = due.length ? due.map((x) => '<div class="due"><b>' + esc(x.c.patient.name) + '</b><span class="b ' + dueBadge(x.t.due)[0] + '">' + dueBadge(x.t.due)[1] + '</span><span class="muted small" style="grid-column:1/-1">' + esc(x.t.title) + '</span></div>').join('') : '<p class="muted small">Không có lịch gọi trong 7 ngày tới.</p>';
  }
  $('q').addEventListener('input', loadHome);
  $('caseTbl').addEventListener('click', async (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) { if (rm.dataset.sure !== '1') { rm.dataset.sure = '1'; rm.textContent = 'Bấm lần nữa để xóa'; setTimeout(() => { rm.dataset.sure = ''; rm.textContent = 'Xóa'; }, 3000); return; } await window.api.cases.remove(rm.dataset.rm); loadHome(); return; }
    const tr = e.target.closest('[data-open]'); if (tr) openCase(tr.dataset.open);
  });
  $('newCase').onclick = async () => { const files = await window.api.pickFiles(); if (files.length) importFiles(files); };
  $('back').onclick = async () => { S.scan.cancel = true; fxClear(); await flush(); S.C = null; clearJaws(); show('home'); };
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length && S.view !== 'settings') importFiles([...e.dataTransfer.files]); });

  /* ================= settings and updates ================= */
  const UPD_TXT = { idle: '', checking: 'Đang kiểm tra bản mới…', none: 'Bạn đang dùng bản mới nhất.', dev: 'Chỉ cập nhật được khi dùng bản đã cài đặt.', norepo: 'Chưa nhập kho cập nhật (tên-github/tên-repo).', ready: 'Đã tải xong, sẵn sàng cài đặt.' };
  function updText() { const u = S.upd; if (u.state === 'available') return 'Có bản mới ' + u.version + '.'; if (u.state === 'downloading') return 'Đang tải bản mới… ' + (u.percent || 0) + '%'; if (u.state === 'error') return 'Không cập nhật được: ' + (u.message || ''); if (u.state === 'ready') return 'Đã tải xong bản ' + (u.version || '') + '. Khởi động lại để cài.'; return UPD_TXT[u.state] || ''; }
  function renderUpd() {
    const u = S.upd, box = $('upd');
    if (u.state === 'available') { box.hidden = false; box.innerHTML = 'Có bản mới ' + esc(u.version) + '<button class="btn sm" type="button" data-u="download">Cập nhật ngay</button>'; }
    else if (u.state === 'downloading') { box.hidden = false; box.textContent = 'Đang tải bản mới… ' + (u.percent || 0) + '%'; }
    else if (u.state === 'ready') { box.hidden = false; box.innerHTML = 'Đã tải xong<button class="btn sm" type="button" data-u="install">Khởi động lại để cài</button>'; }
    else box.hidden = true;
    const st = $('updStatus'); if (st) st.textContent = updText();
    const act = $('updAct'); if (act) { act.innerHTML = u.state === 'available' ? '<button class="btn" type="button" data-u="download">Cập nhật ngay</button>' : u.state === 'ready' ? '<button class="btn" type="button" data-u="install">Khởi động lại để cài</button>' : '<button class="btn ghost" type="button" data-u="check"' + (u.state === 'checking' || u.state === 'downloading' ? ' disabled' : '') + '>Kiểm tra cập nhật</button>'; }
  }
  $('upd').addEventListener('click', (e) => updAct(e));
  function updAct(e) { const a = e.target.dataset && e.target.dataset.u; if (!a) return; if (a === 'check') window.api.update.check(); if (a === 'download') window.api.update.download(); if (a === 'install') window.api.update.install(); }
  window.api.update.onStatus((s) => { S.upd = s; renderUpd(); if (s.state === 'none' && S.view === 'settings') toast('Bạn đang dùng bản mới nhất'); });

  function renderSettings() {
    const c = S.cfg.clinic, a = S.cfg.ai;
    $('setBody').innerHTML = '<h1>Cài đặt</h1>' +
      '<div class="panel"><h3>Thông tin phòng khám (hiện trên phiếu khám PDF)</h3><label class="f">Tên phòng khám<input type="text" data-c="name" value="' + esc(c.name) + '"></label><label class="f">Địa chỉ<input type="text" data-c="address" value="' + esc(c.address) + '"></label><div class="f2"><label class="f">Điện thoại<input type="text" data-c="phone" value="' + esc(c.phone) + '"></label><label class="f">Bác sĩ khám mặc định<input type="text" data-c="doctor" value="' + esc(c.doctor) + '"></label></div><label class="f">Số chứng chỉ hành nghề (không bắt buộc)<input type="text" data-c="license" value="' + esc(c.license) + '"></label><label class="f">Ghi chú cuối phiếu (để trống dùng câu mặc định)<textarea data-c="note">' + esc(c.note) + '</textarea></label>' +
      '<div class="row">' + (c.logo ? '<img src="' + c.logo + '" alt="" style="height:40px;max-width:140px;object-fit:contain;border:1px solid var(--line);padding:4px;border-radius:6px">' : '') + '<label class="btn ghost sm" style="cursor:pointer">Chọn logo<input type="file" id="logo" accept="image/png,image/jpeg" hidden></label>' + (c.logo ? '<button class="btn ghost sm" type="button" id="nologo">Bỏ logo</button>' : '') + '</div></div>' +
      '<div class="panel"><h3>AI (OpenAI GPT)</h3><p class="muted small">Khóa API được mã hóa và chỉ lưu trên máy này. Ảnh scan của từng răng được gửi tới OpenAI khi bạn bấm phân tích, nên hãy xin khách đồng ý và xem chính sách dữ liệu của OpenAI.</p>' +
      '<div class="row"><input type="password" id="key" placeholder="' + (S.hasKey ? 'Đã lưu khóa. Nhập khóa mới để thay thế' : 'sk-...') + '" style="flex:1;min-width:220px"><button class="btn" type="button" id="savekey">Lưu khóa</button>' + (S.hasKey ? '<button class="btn danger sm" type="button" id="delkey">Xóa khóa</button>' : '') + '</div>' +
      '<label class="f">Mô hình<div class="row"><select id="model" style="flex:1">' + [a.model].concat(S.models.filter((m) => m !== a.model)).map((m) => '<option' + (m === a.model ? ' selected' : '') + '>' + esc(m) + '</option>').join('') + '</select><button class="btn ghost sm" type="button" id="models">Tải danh sách từ OpenAI</button></div></label>' +
      '<label class="f">Quy tắc phòng khám (dạy AI cách làm việc, áp dụng cho mọi khách)<textarea id="rules" style="min-height:170px">' + esc(a.rules) + '</textarea></label><div class="row"><button class="btn" type="button" id="saverules">Lưu mô hình và quy tắc</button></div></div>' +
      '<div class="panel"><h3>Cập nhật phần mềm</h3><p class="muted small">Phiên bản hiện tại: <b>' + esc(S.version) + '</b>. Khi có bản mới, nút "Cập nhật ngay" hiện ở thanh trên cùng.</p><label class="f">Kho cập nhật trên GitHub (dạng tên-github/tên-repo)<div class="row"><input type="text" id="repo" value="' + esc(S.cfg.update.repo) + '" placeholder="vi-du/kham-rang-3d" style="flex:1"><button class="btn ghost sm" type="button" id="saverepo">Lưu</button></div></label><div class="row"><div id="updAct"></div><span class="muted small" id="updStatus"></span></div></div>' +
      '<div class="panel"><h3>Dữ liệu</h3><p class="muted small">Hồ sơ khách và file scan lưu tại: <b>' + esc(S.dataPath) + '</b>. Hãy sao lưu thư mục này định kỳ.</p><div class="row"><button class="btn ghost sm" type="button" id="opendata">Mở thư mục dữ liệu</button></div></div>';
    renderUpd();
  }
  async function saveCfg(patch) { await window.api.settings.set(patch); S.cfg = (await window.api.settings.get()).settings; }
  $('setBody').addEventListener('input', (e) => { if (e.target.dataset.c) { S.cfg.clinic[e.target.dataset.c] = e.target.value; clearTimeout(renderSettings.t); renderSettings.t = setTimeout(() => window.api.settings.set({ clinic: S.cfg.clinic }), 400); } });
  $('setBody').addEventListener('change', async (e) => {
    if (e.target.id === 'logo' && e.target.files[0]) {
      const url = await blobToDataUrl(e.target.files[0]), img = new Image(); img.onload = async () => { const k = Math.min(1, 420 / img.width), c = document.createElement('canvas'); c.width = img.width * k; c.height = img.height * k; c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); S.cfg.clinic.logo = c.toDataURL('image/png'); await saveCfg({ clinic: { logo: S.cfg.clinic.logo } }); renderSettings(); }; img.src = url;
    }
  });
  $('setBody').addEventListener('click', async (e) => {
    const t = e.target; updAct(e);
    try {
      if (t.id === 'nologo') { await saveCfg({ clinic: { logo: '' } }); renderSettings(); }
      if (t.id === 'savekey') { const v = $('key').value.trim(); if (!v) { toast('Nhập khóa API'); return; } const r = await window.api.settings.setKey(v); S.hasKey = r.hasKey; toast('Đã lưu khóa'); renderSettings(); }
      if (t.id === 'delkey') { await window.api.settings.setKey(''); S.hasKey = false; renderSettings(); }
      if (t.id === 'models') { t.disabled = true; try { S.models = await window.api.ai.models(); toast('Đã tải ' + S.models.length + ' mô hình'); } catch (er) { toast(cleanErr(er)); } renderSettings(); }
      if (t.id === 'saverules') { await saveCfg({ ai: { model: $('model').value, rules: $('rules').value } }); toast('Đã lưu'); }
      if (t.id === 'saverepo') { const rp = $('repo').value.trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/(\.git)?\/*$/i, ''); $('repo').value = rp; await saveCfg({ update: { repo: rp } }); toast('Đã lưu kho cập nhật'); }
      if (t.id === 'opendata') window.api.openDataFolder();
    } catch (er) { toast(cleanErr(er)); }
  });

  /* ================= navigation ================= */
  function show(v) {
    S.view = v; $('vHome').hidden = v !== 'home'; $('vCase').hidden = v !== 'case'; $('vSettings').hidden = v !== 'settings';
    document.querySelectorAll('.appbar nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.nav === (v === 'settings' ? 'settings' : 'home')));
    if (v === 'home') loadHome(); if (v === 'settings') renderSettings(); if (v === 'case') resize();
  }
  document.querySelector('.appbar nav').addEventListener('click', async (e) => {
    const n = e.target.dataset.nav; if (!n) return;
    if (S.view === 'case') { S.scan.cancel = true; fxClear(); await flush(); S.C = null; clearJaws(); }
    show(n);
  });
  window.addEventListener('beforeunload', () => { flush(); });

  (async function init() {
    const r = await window.api.settings.get(); S.cfg = r.settings; S.hasKey = r.hasKey; S.version = r.version; S.dataPath = r.dataPath; S.packaged = r.packaged;
    $('ver').textContent = 'v' + r.version; show('home');
  })();
  window.__app = { runScan, FX, flyTo, flipJaw, setHover, setPin, toggleDone, recompute, repaintAll, buildLabels, setView, fitAll, camera, controls, S, importFiles, openCase, placeSeed, startMark, select, render, exportPdf, THREE, jawShot, toothImages };
})();
