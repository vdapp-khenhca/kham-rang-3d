/* CT 3D (CBCT): đọc chuỗi lát DICOM, dựng khối, mặt cắt, ảnh toàn cảnh theo cung hàm, mặt cắt vuông góc cung hàm. */
(function () {
  'use strict';
  const LO = -1000, RANGE = 7500; /* khối lưu 8 bit: giá trị = (HU + 1000) * 255 / 7500 */
  const to8 = (v) => { const u = Math.round((v - LO) * 255 / RANGE); return u < 0 ? 0 : u > 255 ? 255 : u; };
  const hu8 = (u) => u * RANGE / 255 + LO;

  async function load(files, onProg) {
    const sl = []; let i = 0;
    for (const f of files) { try { sl.push(window.DICOM.parseSlice(f.buf)); } catch (e) { if (i === 0 && files.length < 3) throw e; } i++; if (onProg && i % 10 === 0) { onProg('Đọc lát ' + i + '/' + files.length, i / files.length * 0.8); await new Promise((r) => setTimeout(r)); } }
    if (sl.length < 20) throw new Error('Cần nhiều lát DICOM (CT khối), chỉ đọc được ' + sl.length);
    const w = sl[0].w, h = sl[0].h, ok = sl.filter((s) => s.w === w && s.h === h);
    ok.sort((a, b) => (isNaN(a.z) || isNaN(b.z) ? a.inst - b.inst : b.z - a.z)); /* lát trên cùng trước */
    const n = ok.length, data = new Uint8Array(w * h * n);
    ok.forEach((s, k) => { const o = k * w * h; for (let j = 0; j < w * h; j++) data[o + j] = to8(s.s[j]); });
    const vx = ok[0].spacing || 0.2; let vz = vx; if (n > 1 && !isNaN(ok[0].z) && !isNaN(ok[1].z)) vz = Math.abs(ok[0].z - ok[1].z) || vx; else if (ok[0].thick) vz = ok[0].thick;
    return { w, h, n, vx, vz, data, meta: ok[0].meta };
  }
  async function pack(vol) { /* nén để lưu vào hồ sơ */
    const head = new TextEncoder().encode(JSON.stringify({ w: vol.w, h: vol.h, n: vol.n, vx: vol.vx, vz: vol.vz, meta: vol.meta })), pre = new Uint8Array(4); new DataView(pre.buffer).setUint32(0, head.length, true);
    const blob = new Blob([pre, head, vol.data]), cs = new Response(blob.stream().pipeThrough(new CompressionStream('gzip')));
    return await cs.arrayBuffer();
  }
  async function unpack(buf) {
    const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))), all = new Uint8Array(await ds.arrayBuffer()), hl = new DataView(all.buffer, all.byteOffset, 4).getUint32(0, true);
    const head = JSON.parse(new TextDecoder().decode(all.subarray(4, 4 + hl))); head.data = all.subarray(4 + hl); return head;
  }

  /* ---- mặt cắt chuẩn ---- */
  function slice(vol, plane, k, slab) { /* trả về {w,h,px:Uint8Array} ; slab = số lát lấy trung bình mỗi bên */
    const { w, h, n, data } = vol; slab = slab || 0; let W, Hh, out;
    if (plane === 'axial') { W = w; Hh = h; out = new Uint8Array(W * Hh); const z0 = Math.max(0, k - slab), z1 = Math.min(n - 1, k + slab), c = z1 - z0 + 1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let z = z0; z <= z1; z++) s += data[(z * h + y) * w + x]; out[y * w + x] = s / c; } }
    else if (plane === 'coronal') { W = w; Hh = n; out = new Uint8Array(W * Hh); const y0 = Math.max(0, k - slab), y1 = Math.min(h - 1, k + slab), c = y1 - y0 + 1; for (let z = 0; z < n; z++) for (let x = 0; x < w; x++) { let s = 0; for (let y = y0; y <= y1; y++) s += data[(z * h + y) * w + x]; out[z * w + x] = s / c; } }
    else { W = h; Hh = n; out = new Uint8Array(W * Hh); const x0 = Math.max(0, k - slab), x1 = Math.min(w - 1, k + slab), c = x1 - x0 + 1; for (let z = 0; z < n; z++) for (let y = 0; y < h; y++) { let s = 0; for (let x = x0; x <= x1; x++) s += data[(z * h + y) * w + x]; out[z * h + y] = s / c; } }
    return { w: W, h: Hh, px: out };
  }

  /* ---- đường cung hàm ---- */
  function catmull(P, per) { /* các điểm điều khiển => đường cong mịn (mảng điểm dày) */
    const out = []; for (let i = 0; i < P.length - 1; i++) { const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)]; for (let t = 0; t < per; t++) { const u = t / per, u2 = u * u, u3 = u2 * u; out.push({ x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * u3), y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * u3) }); } } out.push({ x: P[P.length - 1].x, y: P[P.length - 1].y }); return out;
  }
  function resample(poly, step) { /* chia đều theo chiều dài cung, kèm pháp tuyến */
    const s = [0]; for (let i = 1; i < poly.length; i++) s.push(s[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
    const L = s[s.length - 1], res = []; let j = 0; for (let d = 0; d <= L; d += step) { while (j < s.length - 2 && s[j + 1] < d) j++; const t = s[j + 1] > s[j] ? (d - s[j]) / (s[j + 1] - s[j]) : 0; res.push({ x: poly[j].x + (poly[j + 1].x - poly[j].x) * t, y: poly[j].y + (poly[j + 1].y - poly[j].y) * t }); }
    for (let i = 0; i < res.length; i++) { const a = res[Math.max(0, i - 3)], b = res[Math.min(res.length - 1, i + 3)], dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1; res[i].tx = dx / l; res[i].ty = dy / l; res[i].nx = -dy / l; res[i].ny = dx / l; }
    return res;
  }
  function polyfit(xs, ys, deg) { /* bình phương tối thiểu, x đã chuẩn hóa */
    const m = deg + 1, A = Array.from({ length: m }, () => new Float64Array(m + 1));
    for (let i = 0; i < xs.length; i++) { const p = [1]; for (let k = 1; k < 2 * m; k++) p.push(p[k - 1] * xs[i]); for (let r = 0; r < m; r++) { for (let c = 0; c < m; c++) A[r][c] += p[r + c]; A[r][m] += p[r] * ys[i]; } }
    for (let c = 0; c < m; c++) { let pv = c; for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[pv][c])) pv = r; [A[c], A[pv]] = [A[pv], A[c]]; for (let r = 0; r < m; r++) { if (r === c) continue; const f = A[r][c] / (A[c][c] || 1e-12); for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k]; } }
    return A.map((row, r) => row[m] / (row[r] || 1e-12));
  }
  const evalp = (c, x) => { let s = 0; for (let k = c.length - 1; k >= 0; k--) s = s * x + c[k]; return s; };
  function levels(vol) { /* mức lát ứng với thân răng hàm trên và hàm dưới (theo phân bố điểm rất đặc) */
    const { w, h, n, data } = vol, thr = to8(3000), cnt = new Float64Array(n); let tot = 0;
    for (let z = Math.floor(n * 0.22); z < Math.floor(n * 0.96); z++) { let c = 0; const o = z * w * h; for (let i = 0; i < w * h; i += 2) if (data[o + i] > thr) c++; cnt[z] = c; tot += c; }
    const at = (p) => { let a = 0; for (let z = 0; z < n; z++) { a += cnt[z]; if (a >= tot * p) return z; } return Math.floor(n / 2); };
    return { upper: at(0.1), lower: at(0.7) };
  }
  function autoArch(vol, z) { /* dò cung hàm trên lát z: các điểm đặc (răng, xương) rồi khớp đường bậc 4 */
    const { w, h, data } = vol, thr = to8(2300), o = z * w * h; let m = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) if (data[o + i] > thr) m[i] = 1;
    const er = (a) => { const r = new Uint8Array(a.length); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (a[i] && a[i - 1] && a[i + 1] && a[i - w] && a[i + w]) r[i] = 1; } return r; }, di = (a) => { const r = new Uint8Array(a.length); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; if (a[i] || a[i - 1] || a[i + 1] || a[i - w] || a[i + w]) r[i] = 1; } return r; };
    m = di(er(m)); const lab = new Int32Array(w * h), sizes = [0]; let nl = 0, st = []; for (let s = 0; s < w * h; s++) { if (!m[s] || lab[s]) continue; nl++; let c = 0; lab[s] = nl; st.push(s); while (st.length) { const i = st.pop(); c++; const x = i % w; if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = nl; st.push(i - 1); } if (x < w - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = nl; st.push(i + 1); } if (i >= w && m[i - w] && !lab[i - w]) { lab[i - w] = nl; st.push(i - w); } if (i < w * h - w && m[i + w] && !lab[i + w]) { lab[i + w] = nl; st.push(i + w); } } sizes.push(c); }
    let xs = [], ys = []; for (let i = 0; i < w * h; i++) if (m[i] && sizes[lab[i]] >= 25) { xs.push(i % w); ys.push((i / w) | 0); }
    if (xs.length < 500) return null; const xc = w / 2, nx = xs.map((x) => (x - xc) / (w / 2)); let c = polyfit(nx, ys, 4);
    for (let k = 0; k < 6; k++) { const r = nx.map((x, i) => Math.abs(evalp(c, x) - ys[i])), srt = r.slice().sort((a, b) => a - b), cut = srt[Math.floor(srt.length * 0.7)], X = [], Y = []; r.forEach((v, i) => { if (v <= cut) { X.push(nx[i]); Y.push(ys[i]); } }); c = polyfit(X, Y, 4); }
    let lo = Math.min(...xs), hi = Math.max(...xs); const pts = []; for (let k = 0; k < 9; k++) { const x = lo + (hi - lo) * (k / 8); pts.push({ x, y: evalp(c, (x - xc) / (w / 2)) }); }
    return pts;
  }

  /* ---- ảnh toàn cảnh và mặt cắt vuông góc cung hàm ---- */
  function pano(vol, ctrl, slabMm, mip) {
    const poly = catmull(ctrl, 12), arc = resample(poly, 1), W = arc.length, H = vol.n, K = Math.max(0, Math.round(slabMm / vol.vx / 2)), out = new Uint8Array(W * H), { w, h, data } = vol, wh = w * h;
    for (let i = 0; i < W; i++) { const a = arc[i]; for (let z = 0; z < H; z++) { let s = 0, mx = 0, c = 0; for (let o = -K; o <= K; o++) { const x = Math.round(a.x + a.nx * o), y = Math.round(a.y + a.ny * o); if (x < 0 || y < 0 || x >= w || y >= h) continue; const v = data[z * wh + y * w + x]; s += v; if (v > mx) mx = v; c++; } out[z * W + i] = c ? (mip ? mx : s / c) : 0; } }
    return { w: W, h: H, px: out, arc };
  }
  function cross(vol, arc, i, halfMm, slabMm) {
    const a = arc[Math.max(0, Math.min(arc.length - 1, i))], R = Math.round(halfMm / vol.vx), K = Math.max(0, Math.round(slabMm / vol.vx / 2)), W = 2 * R + 1, H = vol.n, out = new Uint8Array(W * H), { w, h, data } = vol, wh = w * h;
    for (let u = -R; u <= R; u++) for (let z = 0; z < H; z++) { let s = 0, c = 0; for (let o = -K; o <= K; o++) { const x = Math.round(a.x + a.nx * u + a.tx * o), y = Math.round(a.y + a.ny * u + a.ty * o); if (x < 0 || y < 0 || x >= w || y >= h) continue; s += data[z * wh + y * w + x]; c++; } out[z * W + (u + R)] = c ? s / c : 0; }
    return { w: W, h: H, px: out };
  }
  /* 8 bit => canvas có cửa sổ lo/hi (đơn vị 8 bit) */
  function toCanvas(im, lo, hi, opts) {
    opts = opts || {}; const c = document.createElement('canvas'); c.width = im.w; c.height = im.h; const g = c.getContext('2d'), d = g.createImageData(im.w, im.h), o = d.data, k = 255 / Math.max(1, hi - lo), inv = !!opts.invert;
    for (let i = 0; i < im.px.length; i++) { let v = (im.px[i] - lo) * k; v = v < 0 ? 0 : v > 255 ? 255 : v; if (inv) v = 255 - v; o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255; }
    g.putImageData(d, 0, 0); return c;
  }
  window.CT = { load, pack, unpack, slice, catmull, resample, levels, autoArch, pano, cross, toCanvas, hu8, to8 };
})();
