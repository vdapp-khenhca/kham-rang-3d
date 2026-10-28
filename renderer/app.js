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
  const CATALOG = ['Trám răng', 'Điều trị tủy', 'Bọc răng sứ', 'Mão tạm', 'Nhổ răng', 'Nhổ răng khôn', 'Cấy ghép implant', 'Cầu răng sứ', 'Điều trị nha chu', 'Cạo vôi, đánh bóng', 'Chỉnh nha (niềng răng)', 'Tẩy trắng răng', 'Máng chống nghiến', 'Dán sứ veneer', 'Theo dõi định kỳ'];
  const STC = { done: 0x0e8a80, pend: 0xe0952a, risk: 0xd9483b, none: 0x7b8da0 };

  const S = {
    view: 'home', cases: [], cfg: null, hasKey: false, version: '', dataPath: '', packaged: false, upd: { state: 'idle' },
    C: null, jaws: {}, tint: true, sel: null, tab: 'tooth', mark: null,
    form: { kind: 'done', svc: '', who: '', role: 'Bác sĩ', date: todayIso(), react: 'Đang cân nhắc', text: '' }, ai: { busy: false, err: '' }, rep: { busy: false, err: '' }, models: []
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
  (function loop() { requestAnimationFrame(loop); if (!need) return; need = false; renderer.render(scene, camera); placeLabels(); })();

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
  function visBox() { const b = new THREE.Box3(); Object.values(S.jaws).forEach((J) => { if (J.mesh.visible) b.union(J.geo.boundingBox); }); if (b.isEmpty()) Object.values(S.jaws).forEach((J) => b.union(J.geo.boundingBox)); return b; }
  function fitAll() { const b = visBox(); if (b.isEmpty()) return; S.center = b.getCenter(new THREE.Vector3()); S.radius = b.getSize(new THREE.Vector3()).length() / 2 || 50; camera.near = S.radius / 100; camera.far = S.radius * 40; camera.updateProjectionMatrix(); }
  const DIRS = { front: [0, -1, 0], top: [0, -0.02, 1], bottom: [0, 0.02, -1], left: [-1, 0, 0], right: [1, 0, 0] };
  function setView(v) { if (!S.center) return; const d = new THREE.Vector3(...DIRS[v]).normalize().multiplyScalar(S.radius * 2.6); camera.up.set(0, 0, 1); camera.position.copy(S.center).add(d); controls.target.copy(S.center); controls.update(); draw(); }
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
  }
  function svcMap(f) {
    const m = new Map(), log = teethLog(f), get = (n) => { const k = norm(n); if (!m.has(k)) m.set(k, { name: n, ai: null, advice: [], done: [] }); return m.get(k); };
    let lastAi = null; log.forEach((e) => { if (e.kind === 'ai') lastAi = e; });
    if (lastAi && lastAi.ai) (lastAi.ai.services || []).forEach((s) => { if (s && s.name) get(s.name).ai = { priority: s.priority, why: s.why, date: lastAi.date }; });
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
  function paint(J) {
    const col = J.geo.getAttribute('color'), a = col.array; a.set(J.base);
    if (S.tint && J.seeds.length) {
      const colors = J.seeds.map((s) => { const st = stateOf(s.f), sel = S.sel === s.f; return { c: tmpc.clone().setHex(sel ? 0x3f6bff : STC[st] || STC.none), k: sel ? 0.8 : st === 'none' ? 0.2 : 0.55 }; });
      for (let i = 0, N = J.region.length; i < N; i++) { const r = J.region[i]; if (r < 0) continue; const q = colors[r], k = q.k; a[i * 3] = a[i * 3] * (1 - k) + q.c.r * k; a[i * 3 + 1] = a[i * 3 + 1] * (1 - k) + q.c.g * k; a[i * 3 + 2] = a[i * 3 + 2] * (1 - k) + q.c.b * k; }
    }
    col.needsUpdate = true; draw();
  }
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
      if (!s.el) return; if (!J.mesh.visible) { s.el.hidden = true; return; }
      pv.copy(s.p).addScaledVector(J.occ, 1.5).project(camera); s.el.hidden = pv.z > 1 || pv.z < -1;
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
    if (S.mark) { const f = S.mark.seq[S.mark.idx]; if (f == null) return; placeSeed(J, hit.point, f); S.mark.idx += S.mark.dir; markGuide(); return; }
    const rg = J.region[hit.face.a]; if (rg >= 0 && J.seeds[rg]) select(J.seeds[rg].f);
  });

  /* ---- marking guide ---- */
  function startMark(jn) { S.mark = { jaw: jn, seq: SEQ[jn], idx: 0, dir: 1 }; S.sel = null; Object.values(S.jaws).forEach((J) => (J.mesh.visible = J.name === jn)); fitAll(); setView(jn === 'upper' ? 'bottom' : 'top'); markGuide(); render(); draw(); }
  function stopMark() { S.mark = null; $('vU').checked = !!S.jaws.upper; $('vL').checked = !!S.jaws.lower; Object.values(S.jaws).forEach((J) => (J.mesh.visible = true)); fitAll(); setView('front'); markGuide(); repaintAll(); render(); toast('Đã lưu vị trí các răng'); }
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
  $('markU').onclick = () => startMark('upper'); $('markL').onclick = () => startMark('lower');

  function addLog(f, entry) { const log = (S.C.teeth[f] = (S.C.teeth[f] || []).slice()); entry.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5); log.push(entry); persist(); repaintAll(); render(); }
  function delLog(f, id) { S.C.teeth[f] = teethLog(f).filter((e) => e.id !== id); persist(); repaintAll(); render(); }
  function toothDirs(J, s) { const out = s.p.clone().sub(J.center); out.addScaledVector(J.n, -out.dot(J.n)); if (out.lengthSq() < 1e-6) out.copy(J.e1); out.normalize(); return { occ: J.occ.clone().normalize(), out }; }
  function select(f) {
    S.sel = f; S.tab = 'tooth'; S.form.svc = ''; syncTabs();
    const J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f);
    if (J && !S.mark) { Object.values(S.jaws).forEach((j) => (j.mesh.visible = j === J)); $('vU').checked = !!(S.jaws.upper && S.jaws.upper.mesh.visible); $('vL').checked = !!(S.jaws.lower && S.jaws.lower.mesh.visible); }
    if (s) { const d = camera.position.clone().sub(controls.target); d.setLength(Math.min(d.length(), Math.max(45, S.radius * 1.1))); controls.target.copy(s.p); camera.position.copy(s.p).add(d); controls.update(); }
    repaintAll(); render();
  }
  function lookTooth(mode) {
    const f = S.sel, J = S.jaws[jawOf(f)], s = J && J.seeds.find((x) => x.f === f); if (!s) return;
    const dirs = toothDirs(J, s), d = mode === 'occ' ? dirs.occ : mode === 'buc' ? dirs.out : dirs.out.clone().negate();
    camera.position.copy(s.p).addScaledVector(d, 34); if (mode === 'occ') camera.position.addScaledVector(dirs.out, 4); controls.target.copy(s.p); controls.update(); draw();
  }

  /* ---- offscreen renders (AI images and PDF pictures) ---- */
  const off = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); off.setClearColor(0xe6ecee, 1);
  function withOffscreen(only, fn) {
    const keep = { pos: camera.position.clone(), up: camera.up.clone(), tg: controls.target.clone(), asp: camera.aspect };
    const vis = {}; Object.values(S.jaws).forEach((j) => { vis[j.name] = j.mesh.visible; j.mesh.visible = j === only; });
    const col = only.geo.getAttribute('color'), saved = new Float32Array(col.array); col.array.set(only.base); col.needsUpdate = true;
    try { return fn(); } finally {
      col.array.set(saved); col.needsUpdate = true; Object.values(S.jaws).forEach((j) => (j.mesh.visible = vis[j.name]));
      camera.aspect = keep.asp; camera.updateProjectionMatrix(); camera.position.copy(keep.pos); camera.up.copy(keep.up); controls.target.copy(keep.tg); controls.update(); draw();
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
  async function runAi(f) {
    if (!S.hasKey) { toast('Chưa có khóa API. Vào Cài đặt để nhập khóa OpenAI.'); return; }
    S.ai = { busy: true, err: '' }; render();
    try {
      const imgs = await toothImages(f), jaw = jawOf(f) === 'upper' ? 'hàm trên' : 'hàm dưới', miss = S.C.marks.missing.filter((x) => jawOf(x) === jawOf(f)).join(', ') || 'không có';
      const prompt = 'Có 3 ảnh dựng từ file scan 3D trong miệng (có màu) của răng số ' + f + ' (ký hiệu FDI, ' + jaw + '): ảnh 1 nhìn từ mặt nhai, ảnh 2 nhìn từ phía ngoài (má/môi), ảnh 3 nhìn từ phía trong (lưỡi/vòm).\nCác răng đã đánh dấu mất ở hàm này: ' + miss + '.\n' +
        'Nhiệm vụ: nêu những gì NHÌN THẤY được (màu men răng, vết ố hoặc tối màu có thể nghi sâu, mòn mặt nhai, mẻ, miếng trám hoặc mão nếu có, vôi răng, tình trạng nướu quanh răng, răng nghiêng hoặc chen chúc). Không khẳng định chẩn đoán chắc chắn từ ảnh scan; dùng từ "có thể", "nghi ngờ". Điều gì cần X-quang hoặc khám trực tiếp thì ghi vào mục review.\n' +
        'Dịch vụ đề xuất chọn từ: ' + CATALOG.join('; ') + ' (có thể thêm tên khác ngắn gọn). Chỉ đề xuất khi có lý do nhìn thấy được; nếu răng trông ổn thì chỉ cần "Theo dõi định kỳ".\n' +
        'Trả về JSON: {"observations":["..."],"impression":"nhận định 1-2 câu, dễ hiểu","services":[{"name":"...","priority":"cao|trung bình|thấp","why":"1 câu"}],"review":["điều cần bác sĩ xác nhận"]}. Viết tiếng Việt.';
      const res = await window.api.ai.run({ prompt, images: imgs });
      const ai = { observations: (res.observations || []).slice(0, 8), impression: res.impression || '', services: (res.services || []).slice(0, 6), review: (res.review || []).slice(0, 5) };
      S.ai = { busy: false, err: '' }; addLog(f, { kind: 'ai', who: 'AI (GPT)', date: todayIso(), ai });
    } catch (e) { S.ai = { busy: false, err: cleanErr(e) }; render(); }
  }
  async function aiReport() {
    if (!S.hasKey) { toast('Chưa có khóa API. Vào Cài đặt để nhập khóa OpenAI.'); return; }
    S.rep = { busy: true, err: '' }; render();
    try {
      const rows = reportRows(), P = S.C.patient;
      const prompt = 'Soạn nội dung phiếu khám gửi cho khách hàng dựa trên dữ liệu sau (không có dữ liệu thì không bịa).\nKhách: năm sinh ' + (P.year || 'không rõ') + ', giới tính ' + (P.gender || 'không rõ') + ', tiền sử: ' + (P.history || 'không ghi') + '.\nRăng đã mất: ' + (S.C.marks.missing.join(', ') || 'không có') + '.\nDữ liệu từng răng (JSON): ' + JSON.stringify(rows.map((r) => ({ rang: r.f, nhan_xet: r.note, da_lam: r.done.map((d) => d.name), can_lam_hoac_theo_doi: r.todo.map((d) => d.name) }))) + '\n' +
        'Yêu cầu: giọng văn trung lập, dễ hiểu cho người không chuyên; không nhắc giá, không ưu đãi, không thúc ép; không dọa. Mỗi ý khuyên dặn là hành động cụ thể. Phần rủi ro nêu điều có thể xảy ra nếu không xử lý hoặc không theo dõi, dùng từ "có thể".\n' +
        'Trả về JSON: {"summary":"3-5 câu tổng quan tình trạng","advice":["3-6 lời khuyên"],"risks":["3-5 điều cần lưu ý trong tương lai"]}. Viết tiếng Việt.';
      const res = await window.api.ai.run({ prompt, images: [] });
      S.C.report.summary = String(res.summary || ''); S.C.report.advice = (res.advice || []).join('\n'); S.C.report.risks = (res.risks || []).join('\n');
      S.rep = { busy: false, err: '' }; persist(); render(); toast('Đã soạn xong. Hãy đọc lại và chỉnh trước khi xuất PDF.');
    } catch (e) { S.rep = { busy: false, err: cleanErr(e) }; render(); }
  }

  /* ================= PDF ================= */
  function reportRows() {
    const rows = [];
    Object.keys(S.C.teeth).map(Number).sort((a, b) => a - b).forEach((f) => {
      const log = teethLog(f), m = svcMap(f); if (!log.length) return;
      const ai = log.filter((e) => e.kind === 'ai').pop(), notes = log.filter((e) => e.text && (e.kind === 'note' || e.kind === 'done' || (e.kind === 'advice' && e.role === 'Bác sĩ'))).map((e) => e.text);
      const note = [ai && ai.ai && ai.ai.impression].concat(notes).filter(Boolean).join('\n');
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
    const st = stateOf(f), log = teethLog(f), m = svcMap(f), lastAi = log.filter((e) => e.kind === 'ai').pop(), hasSeed = !!(S.jaws[jawOf(f)] && S.jaws[jawOf(f)].seeds.some((s) => s.f === f));
    let h = '<div class="row sp"><div><h2>Răng ' + f + '</h2><p class="muted small">' + (jawOf(f) === 'upper' ? 'Hàm trên' : 'Hàm dưới') + (f % 10 === 8 ? ' · răng khôn' : '') + '</p></div><span class="b ' + STL[st][1] + '">' + STL[st][0] + '</span></div>';
    h += '<div class="row">' + (hasSeed ? '<button class="btn ghost sm" type="button" data-look="occ">Nhìn mặt nhai</button><button class="btn ghost sm" type="button" data-look="buc">Mặt ngoài</button><button class="btn ghost sm" type="button" data-look="lin">Mặt trong</button>' : '<span class="muted small">Răng này chưa được đánh dấu trên mô hình.</span>') + '<label class="row small muted" style="margin-left:auto"><input type="checkbox" id="miss" ' + (isMissing(f) ? 'checked' : '') + '> Đã mất răng</label></div>';
    h += '<div class="card ai"><div class="row sp"><h3>AI khám</h3>' + (hasSeed ? '<button class="btn sm" type="button" id="runai"' + (S.ai.busy ? ' disabled' : '') + '>' + (S.ai.busy ? 'Đang phân tích…' : lastAi ? 'Phân tích lại' : 'Phân tích răng này') + '</button>' : '') + '</div>';
    if (S.ai.err) h += '<p class="err">' + esc(S.ai.err) + '</p>';
    if (lastAi && lastAi.ai) {
      const a = lastAi.ai;
      h += '<p>' + esc(a.impression) + '</p>' + (a.observations.length ? '<ul class="l small">' + a.observations.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>' : '') +
        (a.services.length ? '<div class="lbl" style="margin:6px 0 0">Dịch vụ AI đề xuất</div><div class="row">' + a.services.map((s) => '<span class="b ' + (s.priority === 'cao' ? 'risk' : s.priority === 'thấp' ? 'none' : 'pend') + '">' + esc(s.name) + ' · ' + esc(s.priority) + '</span>').join('') + '</div><ul class="l small muted">' + a.services.filter((s) => s.why).map((s) => '<li><b>' + esc(s.name) + ':</b> ' + esc(s.why) + '</li>').join('') + '</ul>' : '') +
        (a.review && a.review.length ? '<div class="callout">Cần bác sĩ xác nhận: ' + a.review.map(esc).join('; ') + '</div>' : '') + '<p class="muted small">' + esc(lastAi.who) + ' · ' + fmt(lastAi.date) + '. Gợi ý từ ảnh scan, không thay thế khám lâm sàng và X-quang.</p>';
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
  function sumPanel() {
    const rows = { pend: [], done: [] }; let none = 0, total = 0;
    Object.keys(S.jaws).forEach((jn) => S.jaws[jn].seeds.forEach((s) => { total++; const m = svcMap(s.f); if (!m.size) none++; m.forEach((v) => { (v.done.length ? rows.done : rows.pend).push({ f: s.f, v }); }); }));
    const tbl = (list, done) => list.length ? '<table><thead><tr><th>Răng</th><th>Dịch vụ</th><th>' + (done ? 'Làm' : 'Tư vấn') + '</th></tr></thead><tbody>' + list.sort((a, b) => a.f - b.f).map((x) => '<tr><td><button class="btn ghost sm" type="button" data-f="' + x.f + '">' + x.f + '</button></td><td>' + esc(x.v.name) + (x.v.ai && x.v.ai.priority === 'cao' && !done ? ' <span class="b risk">nên sớm</span>' : '') + '</td><td class="small">' + (done ? x.v.done.map((e) => fmt(e.date) + ' · ' + esc(e.who || '')).join('<br>') : x.v.advice.length ? x.v.advice.map((e) => esc(e.who || '?') + ' · ' + esc(e.react || '')).join('<br>') : '<span class="muted">chưa tư vấn</span>') + '</td></tr>').join('') + '</tbody></table>' : '<p class="muted small">Chưa có.</p>';
    return '<div class="row"><span class="b done">' + rows.done.length + ' đã làm</span><span class="b pend">' + rows.pend.length + ' chưa làm</span><span class="b none">' + none + '/' + total + ' răng chưa có dữ liệu</span></div><div><div class="lbl">Chưa làm</div>' + tbl(rows.pend, false) + '</div><div><div class="lbl">Đã làm</div>' + tbl(rows.done, true) + '</div>';
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
  function carePanel() {
    const list = S.C.care.slice().sort((a, b) => (a.done - b.done) || a.due.localeCompare(b.due));
    return '<div class="row sp"><h3>Lịch chăm sóc khách</h3><button class="btn ghost sm" type="button" id="stdcare">Tạo lịch chuẩn</button></div>' +
      '<div>' + (list.length ? list.map((t) => { const [k, l] = dueBadge(t.due); return '<div class="task ' + (t.done ? 'done' : '') + '"><input type="checkbox" data-td="' + t.id + '" ' + (t.done ? 'checked' : '') + ' aria-label="Đã gọi"><div><b>' + esc(t.title) + '</b>' + (t.note ? '<div class="muted small">' + esc(t.note) + '</div>' : '') + '<label class="row small muted"><input type="checkbox" data-ts="' + t.id + '" ' + (t.show ? 'checked' : '') + '> Ghi vào phiếu của khách</label></div><div class="row"><span class="b ' + (t.done ? 'done' : k) + '">' + (t.done ? 'Đã gọi' : l) + '</span><button class="btn ghost sm" type="button" data-tx="' + t.id + '">Xóa</button></div></div>'; }).join('') : '<p class="muted small">Chưa có lịch. Bấm "Tạo lịch chuẩn" để tạo hẹn hỏi thăm sau 7 ngày, cạo vôi sau 6 tháng, tái khám sau 12 tháng.</p>') + '</div>' +
      '<div class="card"><h3>Thêm lịch</h3><div class="form"><label class="f">Nội dung<input type="text" id="ctitle" placeholder="Ví dụ: Gọi hỏi thăm sau khi bọc sứ răng 36"></label><div class="f2"><label class="f">Ngày<input type="date" id="cdue" value="' + addDays(7) + '"></label><label class="f">Ghi chú<input type="text" id="cnote"></label></div><label class="row small muted"><input type="checkbox" id="cshow"> Ghi vào phiếu của khách</label><div class="row"><button class="btn" type="button" id="cadd">Thêm</button></div></div></div>';
  }
  function syncTabs() { document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === S.tab)); }
  function render() {
    if (S.view !== 'case' || !S.C) return;
    const has = Object.keys(S.jaws).length > 0, seeds = Object.values(S.jaws).reduce((a, J) => a + J.seeds.length, 0);
    $('caseT').textContent = S.C.patient.name || S.C.key; $('caseS').textContent = 'Mã hồ sơ ' + S.C.code + ' · tự lưu trên máy này';
    $('tU').hidden = !S.jaws.upper; $('tL').hidden = !S.jaws.lower; $('markU').hidden = !S.jaws.upper || !!S.mark; $('markL').hidden = !S.jaws.lower || !!S.mark;
    $('stat').innerHTML = '<b>' + seeds + '</b> răng đã đánh dấu';
    const sb = $('sb'), top = sb.scrollTop; let h = '';
    if (S.tab === 'doc') h = docPanel();
    else if (S.tab === 'care') h = carePanel();
    else {
      h = archStrip();
      if (S.tab === 'sum') h += sumPanel();
      else if (S.sel != null) h += toothPanel(S.sel);
      else h += seeds ? '<p class="muted">Bấm vào một răng trên mô hình, hoặc số răng ở sơ đồ trên, để xem hồ sơ răng đó.</p>' : '<div class="callout ok">Bước đầu: bấm "Đánh dấu răng hàm trên" (và hàm dưới) phía trên mô hình, rồi bấm lần lượt từng răng. Chỉ làm một lần cho mỗi ca, vị trí được lưu lại.</div>';
    }
    const act = document.activeElement && document.activeElement.id; sb.innerHTML = h; sb.scrollTop = top;
    if (act && $(act) && /^f(svc|who|text|date)$/.test(act)) $(act).focus();
    $('vT').checked = S.tint;
  }

  /* ================= side panel events ================= */
  $('sb').addEventListener('click', (e) => {
    const t = e.target, f = t.closest('[data-f]'); if (f) { select(+f.dataset.f); return; }
    const look = t.closest('[data-look]'); if (look) { lookTooth(look.dataset.look); return; }
    const kind = t.closest('[data-kind]'); if (kind) { S.form.kind = kind.dataset.kind; render(); return; }
    const fill = t.closest('[data-fill]'); if (fill) { S.form.kind = 'done'; S.form.svc = fill.dataset.fill; render(); const el = $('fwho'); if (el) el.focus(); return; }
    const del = t.closest('[data-del]'); if (del) { delLog(S.sel, del.dataset.del); return; }
    const tx = t.closest('[data-tx]'); if (tx) { S.C.care = S.C.care.filter((x) => x.id !== tx.dataset.tx); persist(); render(); return; }
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
    if (id === 'miss') { const f = S.sel; S.C.marks.missing = S.C.marks.missing.filter((x) => x !== f); if (e.target.checked) S.C.marks.missing.push(f); persist(); repaintAll(); render(); }
    if (e.target.dataset.td) { const t = S.C.care.find((x) => x.id === e.target.dataset.td); if (t) { t.done = e.target.checked; persist(); render(); } }
    if (e.target.dataset.ts) { const t = S.C.care.find((x) => x.id === e.target.dataset.ts); if (t) { t.show = e.target.checked; persist(); } }
  });
  document.querySelector('#vCase .tabs').addEventListener('click', (e) => { const t = e.target.dataset.tab; if (!t) return; S.tab = t; syncTabs(); render(); });
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
    $('busy').hidden = false; await new Promise((r) => setTimeout(r, 40));
    try {
      const entries = await readEntries(files), pick = {};
      for (const e of entries) {
        const base = e.name.split(/[\\/]/).pop().replace(/\.(ply|stl)$/i, ''), m = base.match(/^(.*?)-?(upperjaw|lowerjaw)$/i); if (!m) continue;
        const jn = m[2].toLowerCase() === 'upperjaw' ? 'upper' : 'lower';
        if (!pick[jn] || (/\.ply$/i.test(e.name) && !/\.ply$/i.test(pick[jn].name))) pick[jn] = Object.assign({ patient: m[1] }, e);
      }
      if (!pick.upper && !pick.lower) { toast('Không thấy file upperjaw hoặc lowerjaw (.ply, .stl)'); return; }
      const pat = (pick.upper || pick.lower).patient.replace(/^Ca của\s*/i, '').replace(/[-_ ]+$/, ''), key = slugOf(pat);
      const ex = await window.api.cases.load(key);
      S.C = ex ? ex.data : newCase(key, pat);
      for (const jn of Object.keys(pick)) { const ext = /\.stl$/i.test(pick[jn].name) ? 'stl' : 'ply'; await window.api.cases.saveScan(key, jn, ext, pick[jn].buf); }
      await window.api.cases.save(key, S.C);
      clearJaws(); for (const jn of Object.keys(pick)) buildJaw(jn, /\.stl$/i.test(pick[jn].name) ? 'stl' : 'ply', pick[jn].buf);
      enterCase();
    } catch (err) { console.error(err); toast('Không đọc được file: ' + cleanErr(err)); } finally { $('busy').hidden = true; }
  }
  function newCase(key, name) {
    const d = new Date();
    return { key, code: 'HS' + String(d.getFullYear()).slice(2) + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(), created: todayIso(), updated: todayIso(), patient: { name, year: '', gender: '', phone: '', doctor: '', visitDate: todayIso(), history: '' }, marks: { upper: [], lower: [], missing: [] }, teeth: {}, report: { summary: '', advice: '', risks: '' }, care: [] };
  }
  async function openCase(key) {
    $('busy').hidden = false; await new Promise((r) => setTimeout(r, 30));
    try {
      const res = await window.api.cases.load(key); if (!res) { toast('Không mở được hồ sơ'); return; }
      S.C = res.data; S.C.marks = S.C.marks || { upper: [], lower: [], missing: [] }; S.C.teeth = S.C.teeth || {}; S.C.care = S.C.care || []; S.C.report = S.C.report || { summary: '', advice: '', risks: '' };
      clearJaws(); for (const jn of Object.keys(res.scans)) buildJaw(jn, res.scans[jn].ext, toAB(res.scans[jn].buf));
      enterCase();
    } catch (err) { console.error(err); toast('Không mở được hồ sơ: ' + cleanErr(err)); } finally { $('busy').hidden = true; }
  }
  function enterCase() { S.sel = null; S.mark = null; S.tab = 'tooth'; S.tint = true; syncTabs(); show('case'); resize(); fitAll(); setView('front'); $('vU').checked = true; $('vL').checked = true; Object.values(S.jaws).forEach((J) => (J.mesh.visible = true)); applyMarks(); render(); markGuide(); }

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
  $('back').onclick = async () => { await flush(); S.C = null; clearJaws(); show('home'); };
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
      if (t.id === 'saverepo') { await saveCfg({ update: { repo: $('repo').value.trim() } }); toast('Đã lưu kho cập nhật'); }
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
    if (S.view === 'case') { await flush(); S.C = null; clearJaws(); }
    show(n);
  });
  window.addEventListener('beforeunload', () => { flush(); });

  (async function init() {
    const r = await window.api.settings.get(); S.cfg = r.settings; S.hasKey = r.hasKey; S.version = r.version; S.dataPath = r.dataPath; S.packaged = r.packaged;
    $('ver').textContent = 'v' + r.version; show('home');
  })();
  window.__app = { S, importFiles, openCase, placeSeed, startMark, select, render, exportPdf, THREE, jawShot, toothImages };
})();
