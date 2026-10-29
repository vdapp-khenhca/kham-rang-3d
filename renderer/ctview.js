/* Trình xem CT: 3 mặt cắt liên kết, ảnh toàn cảnh theo cung hàm, mặt cắt vuông góc cung hàm, đo mm thật. */
(function () {
  'use strict';
  const PRESET = { bone: [-300, 3500], tooth: [1200, 5200], soft: [-400, 1800] };
  const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h) e.innerHTML = h; return e; };

  function keyImages(vol, st) { /* ảnh chọn lọc gửi AI: toàn cảnh, 2 lát ngang, dải mặt cắt vuông góc */
    const [lo, hi] = [CT.to8(PRESET.bone[0]), CT.to8(PRESET.bone[1])], out = [], P = CT.pano(vol, st.curve, 8, false), cv = CT.toCanvas(P, lo, hi);
    out.push(window.DICOM.enhance(cv, [0, 0, 1, 1], 1700).toDataURL('image/jpeg', 0.9));
    const lv = st.levels || CT.levels(vol);
    [lv.upper, lv.lower].forEach((z) => out.push(CT.toCanvas(CT.slice(vol, 'axial', z, 2), lo, hi).toDataURL('image/jpeg', 0.9)));
    const tiles = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9].map((f) => CT.cross(vol, P.arc, Math.round(P.arc.length * f), 20, 2)), tw = tiles[0].w, c = document.createElement('canvas'); c.width = tw * tiles.length; c.height = vol.n; const g = c.getContext('2d');
    tiles.forEach((t, i) => g.drawImage(CT.toCanvas(t, lo, hi), i * tw, 0)); out.push(c.toDataURL('image/jpeg', 0.88));
    return out;
  }

  function toothCrop(vol, P, st, i, jaw, f) { /* ảnh CT riêng cho một răng: toàn cảnh quanh răng + mặt cắt vuông góc cung hàm */
    const [lo, hi] = [CT.to8(PRESET.bone[0]), CT.to8(PRESET.bone[1])], zo = P.zo || Math.round(vol.n * 0.5), n = vol.n, hp = Math.round(12 / vol.vx), S = 3;
    const up = jaw === 'upper', z0 = Math.max(0, up ? zo - 190 : zo - 70), z1 = Math.min(n - 1, up ? zo + 70 : zo + 190), H = z1 - z0 + 1;
    const x0 = Math.max(0, Math.min(P.w - 2 * hp, i - hp)), sub = { w: 2 * hp, h: H, px: new Uint8Array(2 * hp * H) };
    for (let z = 0; z < H; z++) for (let x = 0; x < 2 * hp; x++) sub.px[z * 2 * hp + x] = P.px[(z0 + z) * P.w + x0 + x];
    const A = CT.toCanvas(sub, lo, hi), R = Math.round(16 / vol.vx), cr = CT.cross(vol, P.arc, i, 16, 2), cs = { w: cr.w, h: H, px: new Uint8Array(cr.w * H) };
    for (let z = 0; z < H; z++) for (let x = 0; x < cr.w; x++) cs.px[z * cr.w + x] = cr.px[(z0 + z) * cr.w + x];
    const B = CT.toCanvas(cs, lo, hi), gap = 12, c = document.createElement('canvas'); c.width = (A.width + B.width) * S + gap; c.height = H * S + 22; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = true; g.drawImage(A, 0, 22, A.width * S, H * S); g.drawImage(B, A.width * S + gap, 22, B.width * S, H * S);
    g.strokeStyle = 'rgba(0,255,255,.8)'; g.lineWidth = 1.5; g.setLineDash([6, 5]); g.beginPath(); const cx = (i - x0) * S; g.moveTo(cx, 22); g.lineTo(cx, c.height); g.stroke(); const cx2 = A.width * S + gap + R * S; g.beginPath(); g.moveTo(cx2, 22); g.lineTo(cx2, c.height); g.stroke(); g.setLineDash([]);
    const mm = 10 / vol.vx * S; g.strokeStyle = '#ff0'; g.fillStyle = '#ff0'; g.lineWidth = 3; g.beginPath(); g.moveTo(8, c.height - 10); g.lineTo(8 + mm, c.height - 10); g.stroke(); g.font = '12px sans-serif'; g.fillText('10 mm', 12 + mm, c.height - 6);
    g.fillStyle = '#fff'; g.font = '700 14px sans-serif'; g.fillText('Răng ' + f + ' (dự kiến tại đường nét đứt) · trái: toàn cảnh · phải: mặt cắt ngang qua răng', 6, 15);
    return c.toDataURL('image/jpeg', 0.9);
  }

  function open(vol, st, hooks) {
    const old = document.getElementById('ctv'); if (old) old.remove();
    const root = el('div', 'cv'); root.id = 'ctv';
    root.innerHTML = '<div class="cvb"><b>CT 3D</b><span class="cvg"><button type="button" data-a="bone" class="on">Xương</button><button type="button" data-a="tooth">Răng</button><button type="button" data-a="soft">Mô mềm</button></span>' +
      '<label>Sáng <input type="range" id="cvL" min="0" max="255" value="30"></label><label>Tương phản <input type="range" id="cvW" min="5" max="255" value="140"></label><label>Dày lát <select id="cvS"><option value="0">1 lát</option><option value="5">2 mm</option><option value="12">5 mm</option><option value="25">10 mm</option></select></label>' +
      '<button type="button" class="btn ghost sm" data-a="inv">Đảo màu</button><button type="button" class="btn ghost sm" data-a="ruler">Thước đo</button><button type="button" class="btn ghost sm" data-a="clr">Xóa đo</button>' +
      '<span class="cvg"><button type="button" class="btn ghost sm" data-a="up">Mức hàm trên</button><button type="button" class="btn ghost sm" data-a="low">Mức hàm dưới</button><button type="button" class="btn ghost sm" data-a="auto">Dò cung hàm</button></span><label>Toàn cảnh <select id="cvP"><option value="4">4 mm</option><option value="8" selected>8 mm</option><option value="14">14 mm</option></select></label><label><input type="checkbox" id="cvM"> MIP</label>' +
      '<span class="muted small" id="cvT">Cuộn chuột: đổi lát · Ctrl+cuộn: phóng to · Chuột phải kéo: di chuyển · Kéo điểm xanh trên lát ngang để chỉnh cung hàm</span><span style="flex:1"></span><button type="button" class="btn sm" data-a="x">Đóng</button></div>' +
      '<div class="cvgrid"><div class="cvp" data-k="axial"><canvas></canvas><i>Mặt cắt ngang</i></div><div class="cvp wide" data-k="pano"><canvas></canvas><i>Toàn cảnh dựng từ CT</i></div><div class="cvp" data-k="coronal"><canvas></canvas><i>Mặt cắt đứng</i></div><div class="cvp" data-k="sagittal"><canvas></canvas><i>Mặt cắt bên</i></div><div class="cvp" data-k="cross"><canvas></canvas><i>Cắt vuông góc cung hàm</i></div></div>';
    document.body.appendChild(root);
    const S = { lo: 30, hi: 170, slab: 0, inv: false, ruler: false, x: Math.floor(vol.w / 2), y: Math.floor(vol.h / 2), z: Math.floor(vol.n * 0.45), s: 0, pslab: 8, mip: false, curve: st.curve && st.curve.length >= 3 ? st.curve.map((p) => ({ x: p.x, y: p.y })) : null, levels: st.levels || CT.levels(vol), P: null, meas: {} };
    if (!S.curve) { S.z = S.levels.upper; S.curve = CT.autoArch(vol, S.levels.upper) || [{ x: 100, y: 300 }, { x: 200, y: 160 }, { x: 275, y: 130 }, { x: 350, y: 160 }, { x: 450, y: 300 }]; } else if (st.z != null) S.z = st.z;
    const V = {}; root.querySelectorAll('.cvp').forEach((d) => { const k = d.dataset.k; V[k] = { k, d, c: d.querySelector('canvas'), zoom: 1, px: 0, py: 0, img: null, dirty: true }; });
    const save = () => hooks && hooks.onChange && hooks.onChange({ curve: S.curve.map((p) => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1) })), z: S.z, levels: S.levels });
    const dxy = { axial: [vol.vx, vol.vx], pano: [vol.vx, vol.vz], coronal: [vol.vx, vol.vz], sagittal: [vol.vx, vol.vz], cross: [vol.vx, vol.vz] };
    function buildPano() { S.P = CT.pano(vol, S.curve, S.pslab, S.mip); S.s = Math.min(S.P.arc.length - 1, Math.max(0, S.s)); V.pano.img = null; V.cross.img = null; }
    function sync() { const a = S.P.arc[S.s]; if (a) { /* giữ x,y theo vị trí trên cung hàm khi chọn trên ảnh toàn cảnh */ } }
    function img(k) {
      const lo = S.lo, hi = Math.max(S.lo + 1, S.hi), o = { invert: S.inv }, sl = S.slab;
      if (k === 'axial') return CT.toCanvas(CT.slice(vol, 'axial', S.z, sl), lo, hi, o);
      if (k === 'coronal') return CT.toCanvas(CT.slice(vol, 'coronal', S.y, sl), lo, hi, o);
      if (k === 'sagittal') return CT.toCanvas(CT.slice(vol, 'sagittal', S.x, sl), lo, hi, o);
      if (k === 'pano') return CT.toCanvas(S.P, lo, hi, o);
      return CT.toCanvas(CT.cross(vol, S.P.arc, S.s, 25, 2.5), lo, hi, o);
    }
    function fitV(v) { const r = v.d.getBoundingClientRect(); v.c.width = Math.max(50, Math.round(r.width)); v.c.height = Math.max(50, Math.round(r.height)); }
    function geom(v) { const im = v.img, W = v.c.width, H = v.c.height, sx = dxy[v.k][0], sy = dxy[v.k][1], iw = im.width * sx / vol.vx, ih = im.height * sy / vol.vx, f = Math.min(W / iw, H / ih) * v.zoom; return { f, sy: sy / vol.vx, ox: (W - iw * f) / 2 + v.px, oy: (H - ih * f) / 2 + v.py }; }
    const toImg = (v, ex, ey) => { const g = geom(v); return { x: (ex - g.ox) / g.f, y: (ey - g.oy) / (g.f * g.sy) }; };
    const toScr = (v, x, y) => { const g = geom(v); return { x: g.ox + x * g.f, y: g.oy + y * g.f * g.sy }; };
    function draw(v) {
      if (!v.img) v.img = img(v.k); fitV(v); const g = v.c.getContext('2d'), ge = geom(v); g.fillStyle = '#000'; g.fillRect(0, 0, v.c.width, v.c.height); g.imageSmoothingEnabled = true;
      g.drawImage(v.img, ge.ox, ge.oy, v.img.width * ge.f, v.img.height * ge.f * ge.sy);
      const line = (a, b, col, w) => { g.strokeStyle = col; g.lineWidth = w || 1; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke(); }, ptn = (p, r, col) => { g.fillStyle = col; g.beginPath(); g.arc(p.x, p.y, r, 0, 6.3); g.fill(); };
      const cx = (x, y, col) => { const p = toScr(v, x, y); line({ x: p.x, y: 0 }, { x: p.x, y: v.c.height }, col, 1); line({ x: 0, y: p.y }, { x: v.c.width, y: p.y }, col, 1); };
      if (v.k === 'axial') {
        cx(S.x, S.y, 'rgba(255,200,40,.55)');
        const dense = CT.catmull(S.curve, 10).map((p) => toScr(v, p.x, p.y)); g.strokeStyle = '#14e0c8'; g.lineWidth = 1.5; g.beginPath(); dense.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.stroke();
        S.curve.forEach((p) => ptn(toScr(v, p.x, p.y), 5, '#14e0c8')); const a = S.P && S.P.arc[S.s]; if (a) ptn(toScr(v, a.x, a.y), 6, '#ff5a3c');
      } else if (v.k === 'coronal') cx(S.x, S.z * vol.vz / vol.vz, 'rgba(255,200,40,.55)');
      else if (v.k === 'sagittal') cx(S.y, S.z, 'rgba(255,200,40,.55)');
      else if (v.k === 'pano') { const p = toScr(v, S.s, S.z); line({ x: p.x, y: 0 }, { x: p.x, y: v.c.height }, 'rgba(255,90,60,.8)', 1.2); line({ x: 0, y: p.y }, { x: v.c.width, y: p.y }, 'rgba(255,200,40,.35)', 1); }
      else if (v.k === 'cross') { const p = toScr(v, (v.img.width - 1) / 2, S.z); line({ x: 0, y: p.y }, { x: v.c.width, y: p.y }, 'rgba(255,200,40,.45)', 1); line({ x: toScr(v, (v.img.width - 1) / 2, 0).x, y: 0 }, { x: toScr(v, (v.img.width - 1) / 2, 0).x, y: v.c.height }, 'rgba(255,90,60,.5)', 1); }
      const m = S.meas[v.k]; if (m) { m.forEach((q) => { const a = toScr(v, q.a.x, q.a.y), b = q.b ? toScr(v, q.b.x, q.b.y) : null; ptn(a, 4, '#ffe14d'); if (b) { line(a, b, '#ffe14d', 1.5); ptn(b, 4, '#ffe14d'); const mm = Math.hypot((q.a.x - q.b.x) * dxy[v.k][0], (q.a.y - q.b.y) * dxy[v.k][1]); g.font = 'bold 13px sans-serif'; g.fillStyle = '#ffe14d'; g.strokeStyle = '#000'; g.lineWidth = 3; const t = mm.toFixed(1) + ' mm'; g.strokeText(t, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6); g.fillText(t, (a.x + b.x) / 2 + 6, (a.y + b.y) / 2 - 6); } }); }
      g.font = '12px sans-serif'; g.fillStyle = 'rgba(255,255,255,.8)'; const lab = v.k === 'axial' ? 'z ' + (S.z * vol.vz).toFixed(1) + ' mm' : v.k === 'coronal' ? 'y ' + (S.y * vol.vx).toFixed(1) + ' mm' : v.k === 'sagittal' ? 'x ' + (S.x * vol.vx).toFixed(1) + ' mm' : v.k === 'pano' ? 'vị trí ' + (S.s * vol.vx).toFixed(0) + ' mm trên cung' : ''; g.fillText(lab, 8, v.c.height - 8);
    }
    function redraw(keys) { (keys || Object.keys(V)).forEach((k) => { V[k].dirty = true; }); if (!redraw.q) { redraw.q = requestAnimationFrame(() => { redraw.q = 0; Object.values(V).forEach((v) => { if (v.dirty) { v.dirty = false; if (v.img === null || v.stale) { v.img = null; } draw(v); } }); }); } }
    const stale = (keys) => keys.forEach((k) => { V[k].img = null; });
    const setPos = (o) => { Object.assign(S, o); S.x = Math.max(0, Math.min(vol.w - 1, Math.round(S.x))); S.y = Math.max(0, Math.min(vol.h - 1, Math.round(S.y))); S.z = Math.max(0, Math.min(vol.n - 1, Math.round(S.z))); stale(['axial', 'coronal', 'sagittal', 'cross']); redraw(); };
    function nearestArc(x, y) { let b = 0, bd = 1e9; S.P.arc.forEach((a, i) => { const d = (a.x - x) ** 2 + (a.y - y) ** 2; if (d < bd) { bd = d; b = i; } }); return b; }
    buildPano(); { const mid = S.P.arc[Math.round(S.P.arc.length * 0.5)]; S.s = Math.round(S.P.arc.length * 0.5); if (mid && !(st.curve && st.curve.length >= 3 && st.x != null)) { S.x = Math.round(mid.x); S.y = Math.round(mid.y); } } resizeAll(); function resizeAll() { Object.values(V).forEach(fitV); redraw(); } const ro = new ResizeObserver(() => resizeAll()); ro.observe(root.querySelector('.cvgrid'));
    /* thao tác chuột */
    let drag = null, hold = null;
    Object.values(V).forEach((v) => {
      v.c.addEventListener('contextmenu', (e) => e.preventDefault());
      v.c.addEventListener('wheel', (e) => {
        e.preventDefault(); const zoomIt = e.ctrlKey || v.k === 'pano' || v.k === 'cross';
        if (zoomIt) { const r = v.c.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, before = toImg(v, mx, my), k = e.deltaY < 0 ? 1.15 : 1 / 1.15; v.zoom = Math.max(0.4, Math.min(10, v.zoom * k)); const g = geom(v), nx = g.ox + before.x * g.f, ny = g.oy + before.y * g.f * g.sy; v.px += mx - nx; v.py += my - ny; redraw([v.k]); return; }
        const d = (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 5 : 1); if (v.k === 'axial') setPos({ z: S.z + d }); else if (v.k === 'coronal') setPos({ y: S.y + d }); else setPos({ x: S.x + d });
      }, { passive: false });
      v.c.addEventListener('mousedown', (e) => {
        const r = v.c.getBoundingClientRect(), ex = e.clientX - r.left, ey = e.clientY - r.top;
        if (e.button === 2 || e.button === 1) { drag = { v, x: e.clientX, y: e.clientY, px: v.px, py: v.py }; return; }
        const p = toImg(v, ex, ey);
        if (S.ruler) { const arr = (S.meas[v.k] = S.meas[v.k] || []), last = arr[arr.length - 1]; if (last && !last.b) last.b = p; else arr.push({ a: p }); redraw([v.k]); return; }
        if (v.k === 'axial') { const hit = S.curve.findIndex((c) => { const q = toScr(v, c.x, c.y); return Math.hypot(q.x - ex, q.y - ey) < 9; }); if (hit >= 0) { hold = { v, i: hit }; return; } hold = { v, set: true }; setPos({ x: p.x, y: p.y }); return; }
        hold = { v, set: true }; apply(v, p);
      });
    });
    function apply(v, p) { if (v.k === 'coronal') setPos({ x: p.x, z: p.y }); else if (v.k === 'sagittal') setPos({ y: p.x, z: p.y }); else if (v.k === 'pano') { const i = Math.max(0, Math.min(S.P.arc.length - 1, Math.round(p.x))), a = S.P.arc[i]; S.s = i; setPos({ x: a.x, y: a.y, z: p.y }); } else if (v.k === 'cross') setPos({ z: p.y }); }
    window.addEventListener('mousemove', mm); window.addEventListener('mouseup', mu);
    function mm(e) {
      if (drag) { drag.v.px = drag.px + e.clientX - drag.x; drag.v.py = drag.py + e.clientY - drag.y; redraw([drag.v.k]); return; }
      if (!hold) return; const v = hold.v, r = v.c.getBoundingClientRect(), p = toImg(v, e.clientX - r.left, e.clientY - r.top);
      if (hold.i != null) { S.curve[hold.i] = { x: Math.max(0, Math.min(vol.w - 1, p.x)), y: Math.max(0, Math.min(vol.h - 1, p.y)) }; redraw(['axial']); clearTimeout(mm.t); mm.t = setTimeout(() => { buildPano(); redraw(); save(); }, 220); return; }
      if (v.k === 'axial') setPos({ x: p.x, y: p.y }); else apply(v, p);
    }
    function mu() { if (hold && hold.v.k === 'axial' && hold.set) { S.s = nearestArc(S.x, S.y); stale(['cross']); redraw(); save(); } drag = null; hold = null; }
    /* thanh công cụ */
    const T = (t) => (root.querySelector('#cvT').textContent = t);
    const setWin = (lo, hi) => { S.lo = lo; S.hi = hi; root.querySelector('#cvL').value = lo; root.querySelector('#cvW').value = hi - lo; stale(Object.keys(V)); redraw(); };
    const win = (a) => setWin(CT.to8(PRESET[a][0]), CT.to8(PRESET[a][1]));
    root.addEventListener('input', (e) => { if (e.target.id === 'cvL' || e.target.id === 'cvW') { S.lo = +root.querySelector('#cvL').value; S.hi = S.lo + +root.querySelector('#cvW').value; stale(Object.keys(V)); redraw(); } });
    root.addEventListener('change', (e) => { if (e.target.id === 'cvS') { S.slab = +e.target.value; stale(['axial', 'coronal', 'sagittal']); redraw(); } else if (e.target.id === 'cvP') { S.pslab = +e.target.value; buildPano(); redraw(); } else if (e.target.id === 'cvM') { S.mip = e.target.checked; buildPano(); redraw(); } });
    function fitArch(z) { const c = CT.autoArch(vol, z); if (c) { S.curve = c; S.z = z; buildPano(); stale(['axial', 'coronal', 'sagittal']); redraw(); save(); } else T('Không dò được cung hàm ở mức này, hãy kéo các điểm xanh bằng tay.'); }
    function close() { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); document.removeEventListener('keydown', kd); ro.disconnect(); root.remove(); hooks && hooks.onClose && hooks.onClose(); }
    const kd = (e) => { if (e.key === 'Escape') close(); }; document.addEventListener('keydown', kd);
    root.addEventListener('click', (e) => {
      const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (PRESET[a]) { root.querySelectorAll('.cvg [data-a]').forEach((b) => { if (PRESET[b.dataset.a]) b.classList.toggle('on', b === e.target); }); win(a); }
      else if (a === 'inv') { S.inv = !S.inv; e.target.classList.toggle('on', S.inv); stale(Object.keys(V)); redraw(); }
      else if (a === 'ruler') { S.ruler = !S.ruler; e.target.classList.toggle('on', S.ruler); root.classList.toggle('ruling', S.ruler); T(S.ruler ? 'Bấm 2 điểm trên một mặt cắt để đo (mm thật, độ phân giải ' + vol.vx + ' mm)' : ''); }
      else if (a === 'clr') { S.meas = {}; redraw(); }
      else if (a === 'up') { fitArch(S.levels.upper); } else if (a === 'low') { fitArch(S.levels.lower); } else if (a === 'auto') fitArch(S.z);
      else if (a === 'x') close();
    });
    win('bone'); setPos({}); return { close, state: S };
  }
  window.CTView = { open, keyImages, toothCrop };
})();
