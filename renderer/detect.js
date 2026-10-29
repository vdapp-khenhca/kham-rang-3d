/* Nhận diện răng tự động (v2): tách từng răng theo hình dạng thật trên scan, rồi mới đánh số.
   1) Lấy các điểm thân răng (theo màu) nhìn từ mặt nhai, giữ phần cao (bỏ nướu/vòm).
   2) Làm sạch ảnh nhị phân, tính khoảng cách tới mép, chia "lưu vực" (watershed) => mỗi cụm là một răng.
   3) Xếp các cụm theo cung hàm, tìm đường giữa, rồi gán số FDI bằng quy hoạch động
      (so diện tích, vị trí trên cung hàm với răng chuẩn; chỗ trống = răng mất; cụm quá to = 2 răng dính nhau). */
(function () {
  'use strict';
  const WIDTH = { upper: [8.6, 6.6, 7.6, 7.0, 6.6, 10.2, 9.4, 8.4], lower: [5.4, 5.9, 6.9, 7.1, 7.3, 11.0, 10.4, 9.6] };
  const AREA = { upper: [60, 43, 61, 63, 59, 112, 103, 88], lower: [32, 37, 54, 55, 60, 115, 104, 91] };
  const MISS = [1.5, 1.5, 1.4, 1.2, 1.2, 1.4, 0.9, 0.3]; // chi phí coi răng thứ i (1..8) là mất
  const R = 0.25; // mm / ô

  function dilate(m, W, H) { const o = new Uint8Array(m.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] || (x > 0 && m[i - 1]) || (x < W - 1 && m[i + 1]) || (y > 0 && m[i - W]) || (y < H - 1 && m[i + W])) o[i] = 1; } return o; }
  function erode(m, W, H) { const o = new Uint8Array(m.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = y * W + x; if (m[i] && x > 0 && m[i - 1] && x < W - 1 && m[i + 1] && y > 0 && m[i - W] && y < H - 1 && m[i + W]) o[i] = 1; } return o; }
  function fillHoles(m, W, H) { const out = new Uint8Array(m.length).fill(1), st = []; const push = (i) => { if (!m[i] && out[i]) { out[i] = 0; st.push(i); } }; for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); } while (st.length) { const i = st.pop(), x = i % W, y = (i / W) | 0; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W); } for (let i = 0; i < m.length; i++) if (m[i]) out[i] = 1; return out; }
  function components(m, W, H) { const lab = new Int32Array(m.length), sizes = [0]; let n = 0; const st = []; for (let s = 0; s < m.length; s++) { if (!m[s] || lab[s]) continue; n++; let c = 0; lab[s] = n; st.push(s); while (st.length) { const i = st.pop(); c++; const x = i % W, y = (i / W) | 0; if (x > 0 && m[i - 1] && !lab[i - 1]) { lab[i - 1] = n; st.push(i - 1); } if (x < W - 1 && m[i + 1] && !lab[i + 1]) { lab[i + 1] = n; st.push(i + 1); } if (y > 0 && m[i - W] && !lab[i - W]) { lab[i - W] = n; st.push(i - W); } if (y < H - 1 && m[i + W] && !lab[i + W]) { lab[i + W] = n; st.push(i + W); } } sizes.push(c); } return { lab, sizes, n }; }
  function edt(m, W, H) { // khoảng cách Euclid tới ô nền gần nhất (Felzenszwalb)
    const INF = 1e12, f = new Float64Array(m.length); for (let i = 0; i < m.length; i++) f[i] = m[i] ? INF : 0;
    const pass = (n, get, set) => { const v = new Int32Array(n), z = new Float64Array(n + 1), d = new Float64Array(n); let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF; for (let q = 1; q < n; q++) { let s; for (;;) { const p = v[k]; s = ((get(q) + q * q) - (get(p) + p * p)) / (2 * q - 2 * p); if (s <= z[k] && k > 0) k--; else break; } k++; v[k] = q; z[k] = s; z[k + 1] = INF; } k = 0; for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + get(p); } for (let q = 0; q < n; q++) set(q, d[q]); };
    for (let x = 0; x < W; x++) pass(H, (y) => f[y * W + x], (y, val) => (f[y * W + x] = val));
    for (let y = 0; y < H; y++) pass(W, (x) => f[y * W + x], (x, val) => (f[y * W + x] = val));
    const o = new Float32Array(m.length); for (let i = 0; i < m.length; i++) o[i] = Math.sqrt(f[i]); return o;
  }
  function gauss(a, W, H, sg) {
    const rad = Math.ceil(sg * 3), k = []; let ks = 0; for (let i = -rad; i <= rad; i++) { const v = Math.exp(-(i * i) / (2 * sg * sg)); k.push(v); ks += v; } for (let i = 0; i < k.length; i++) k[i] /= ks;
    const t = new Float32Array(a.length), o = new Float32Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -rad; j <= rad; j++) { const xx = Math.min(W - 1, Math.max(0, x + j)); s += a[y * W + xx] * k[j + rad]; } t[y * W + x] = s; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let s = 0; for (let j = -rad; j <= rad; j++) { const yy = Math.min(H - 1, Math.max(0, y + j)); s += t[yy * W + x] * k[j + rad]; } o[y * W + x] = s; }
    return o;
  }
  /* Chia lưu vực theo "độ bền" đỉnh (tương đương h-maxima + watershed) */
  function basins(val, m, W, H, hh) {
    const idx = []; for (let i = 0; i < m.length; i++) if (m[i]) idx.push(i); idx.sort((a, b) => val[b] - val[a]);
    const par = new Int32Array(m.length).fill(-1), peak = new Float32Array(m.length), done = new Uint8Array(m.length);
    const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    for (const c of idx) {
      const v = val[c], x = c % W, y = (c / W) | 0, rs = [];
      const nb = (j) => { if (done[j]) { const r = find(j); if (rs.indexOf(r) < 0) rs.push(r); } };
      if (x > 0) nb(c - 1); if (x < W - 1) nb(c + 1); if (y > 0) nb(c - W); if (y < H - 1) nb(c + W);
      if (!rs.length) { par[c] = c; peak[c] = v; } else { rs.sort((a, b) => peak[b] - peak[a]); const base = rs[0]; par[c] = base; for (let k = 1; k < rs.length; k++) if (peak[rs[k]] - v < hh) par[rs[k]] = base; }
      done[c] = 1;
    }
    const lab = new Int32Array(m.length), map = new Map(); let n = 0;
    for (const c of idx) { const r = find(c); if (!map.has(r)) map.set(r, ++n); lab[c] = map.get(r); }
    return { lab, n };
  }


  function meshSegment(J, cell, cellF, W, Hh) {
    const geo = J.geo, N = J.crown.length, idx = geo.index ? geo.index.array : null, P = geo.getAttribute('position').array, NR = geo.getAttribute('normal') ? geo.getAttribute('normal').array : null, crown = J.crown;
    if (!idx || !NR) return null;
    /* lõi: ăn mòn nhãn 4 lần */
    let cur = new Int8Array(cellF), G = cellF.length;
    for (let it = 0; it < 4; it++) { const nx = new Int8Array(G); for (let y = 1; y < Hh - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x, f = cur[i]; if (f && cur[i - 1] === f && cur[i + 1] === f && cur[i - W] === f && cur[i + W] === f) nx[i] = f; } cur = nx; }
    const has = new Set(); for (let i = 0; i < G; i++) if (cur[i]) has.add(cur[i]);
    for (let i = 0; i < G; i++) if (!cur[i] && cellF[i] && !has.has(cellF[i])) cur[i] = cellF[i]; /* răng nhỏ: giữ nguyên nhãn */
    /* kề cận */
    const deg = new Int32Array(N + 1); for (let t = 0; t < idx.length; t += 3) { deg[idx[t]] += 2; deg[idx[t + 1]] += 2; deg[idx[t + 2]] += 2; }
    const st = new Int32Array(N + 1); for (let i = 0; i < N; i++) st[i + 1] = st[i] + deg[i]; const fill = st.slice(0, N), adj = new Int32Array(st[N]);
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
    const dist = new Float64Array(N).fill(1e18), lab = new Int8Array(N), heap = []; /* [d, v] */
    const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (let i = 0; i < N; i++) { if (!crown[i]) continue; const c = cell[i]; if (c >= 0 && cur[c]) { dist[i] = 0; lab[i] = cur[c]; push(0, i); } }
    while (heap.length) {
      const [d, v] = pop(); if (d > dist[v]) continue;
      for (let k = st[v]; k < st[v + 1]; k++) { const u = adj[k]; if (!crown[u]) continue; const dx = P[u * 3] - P[v * 3], dy = P[u * 3 + 1] - P[v * 3 + 1], dz = P[u * 3 + 2] - P[v * 3 + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz), dot = NR[u * 3] * NR[v * 3] + NR[u * 3 + 1] * NR[v * 3 + 1] + NR[u * 3 + 2] * NR[v * 3 + 2], nd = d + len * (1 + 14 * Math.max(0, 1 - dot)); if (nd < dist[u]) { dist[u] = nd; lab[u] = lab[v]; push(nd, u); } }
    }
    return lab;
  }

  /* Phân vùng 3D theo cung hàm: mỗi răng = một đoạn của cung, ranh giới đặt đúng tại rãnh lõm giữa hai răng (khe kẽ) */
  function archSegment(J, seeds, jaw) {
    const geo = J.geo, N = J.crown.length, idx = geo.index ? geo.index.array : null, P = geo.getAttribute('position').array, NR = geo.getAttribute('normal') ? geo.getAttribute('normal').array : null, crown = J.crown, U = J.U, V = J.V;
    if (!idx || !NR) return null;
    const ord = jaw === 'upper' ? [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] : [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
    const arr = []; ord.forEach((f) => { const q = seeds.find((x) => x.f === f); if (q) arr.push({ f, u: q.p.x * J.e1.x + q.p.y * J.e1.y + q.p.z * J.e1.z, v: q.p.x * J.e2.x + q.p.y * J.e2.y + q.p.z * J.e2.z }); });
    if (arr.length < 4) return null;
    const pts = arr.map((a) => [a.u, a.v]), ext = (a, b) => { const dx = a[0] - b[0], dy = a[1] - b[1], L = Math.hypot(dx, dy) || 1; return [a[0] + dx / L * 8, a[1] + dy / L * 8]; };
    pts.unshift(ext(pts[0], pts[1])); pts.push(ext(pts[pts.length - 1], pts[pts.length - 2]));
    const cum = [0]; for (let k = 1; k < pts.length; k++) cum.push(cum[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
    const seedS = arr.map((a, k) => cum[k + 1]);
    /* toạ độ dọc cung của từng đỉnh thân răng */
    const sArr = new Float32Array(N).fill(-1e9), off = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      if (!crown[i]) continue; let bd = 1e18, bs = 0;
      for (let k = 1; k < pts.length; k++) { const ax = pts[k - 1][0], ay = pts[k - 1][1], bx = pts[k][0], by = pts[k][1], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1; let t = ((U[i] - ax) * dx + (V[i] - ay) * dy) / L2; t = Math.max(0, Math.min(1, t)); const px = ax + t * dx, py = ay + t * dy, d = (U[i] - px) * (U[i] - px) + (V[i] - py) * (V[i] - py); if (d < bd) { bd = d; bs = cum[k - 1] + t * Math.sqrt(L2); } }
      sArr[i] = bs; off[i] = Math.sqrt(bd);
    }
    /* độ lõm từng đỉnh (dương = lõm) */
    const deg = new Int32Array(N + 1); for (let t = 0; t < idx.length; t += 3) { deg[idx[t]] += 2; deg[idx[t + 1]] += 2; deg[idx[t + 2]] += 2; }
    const st = new Int32Array(N + 1); for (let i = 0; i < N; i++) st[i + 1] = st[i] + deg[i]; const fill = st.slice(0, N), adj = new Int32Array(st[N]);
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2]; adj[fill[a]++] = b; adj[fill[a]++] = c; adj[fill[b]++] = a; adj[fill[b]++] = c; adj[fill[c]++] = a; adj[fill[c]++] = b; }
    let cv = new Float32Array(N);
    for (let i = 0; i < N; i++) { if (!crown[i]) continue; let s = 0, n = 0; for (let k = st[i]; k < st[i + 1]; k++) { const j = adj[k], dx = P[j * 3] - P[i * 3], dy = P[j * 3 + 1] - P[i * 3 + 1], dz = P[j * 3 + 2] - P[i * 3 + 2], L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1; s += (dx * NR[i * 3] + dy * NR[i * 3 + 1] + dz * NR[i * 3 + 2]) / L; n++; } cv[i] = n ? s / n : 0; }
    for (let it = 0; it < 2; it++) { const nx = new Float32Array(N); for (let i = 0; i < N; i++) { if (!crown[i]) continue; let s = cv[i], n = 1; for (let k = st[i]; k < st[i + 1]; k++) { const j = adj[k]; if (crown[j]) { s += cv[j]; n++; } } nx[i] = s / n; } cv = nx; }
    /* mật độ lõm theo s */
    const BIN = 0.2, nb = Math.ceil(cum[cum.length - 1] / BIN) + 2, D = new Float32Array(nb);
    for (let i = 0; i < N; i++) { if (sArr[i] < -1e8 || off[i] > 9) continue; const c = cv[i]; if (c > 0.08) D[Math.floor(sArr[i] / BIN)] += c; }
    const Dm = new Float32Array(nb), sg = 2; for (let b = 0; b < nb; b++) { let s = 0, w = 0; for (let k = -6; k <= 6; k++) { const j = b + k; if (j < 0 || j >= nb) continue; const g = Math.exp(-(k * k) / (2 * sg * sg)); s += D[j] * g; w += g; } Dm[b] = s / w; }
    let dmax = 0; for (let b = 0; b < nb; b++) if (Dm[b] > dmax) dmax = Dm[b];
    const WD = WIDTH[jaw], wOf = (f) => WD[(f % 10) - 1] || 7, bnd = [];
    for (let k = 0; k + 1 < arr.length; k++) {
      const a = seedS[k], b = seedS[k + 1], g = b - a, wa = wOf(arr[k].f), wb = wOf(arr[k + 1].f), mid = a + g * (wa / (wa + wb)); let best = mid, bsc = -1;
      const lo = a + 0.25 * g, hi = a + 0.75 * g; for (let s = lo; s <= hi; s += BIN) { const sc = Dm[Math.floor(s / BIN)] * Math.exp(-Math.pow((s - mid) / (0.2 * g), 2)); if (sc > bsc) { bsc = sc; best = s; } }
      bnd.push(bsc > 0.12 * dmax ? best : mid);
    }
    const lab = new Int8Array(N), s0 = seedS[0] - 4, s1 = seedS[seedS.length - 1] + 4;
    for (let i = 0; i < N; i++) { if (sArr[i] < -1e8 || off[i] > 9) continue; const s = sArr[i]; if (s < s0 || s > s1) continue; let k = 0; while (k < bnd.length && s > bnd[k]) k++; lab[i] = arr[k].f; }
    return lab;
  }
  window.archSegment = archSegment;
  window.detectTeeth = function (J, jaw, THREE, inv) {
    const N = J.crown.length, P = J.geo.getAttribute('position').array, U = J.U, V = J.V, H = J.H, crown = J.crown, sg = J.occ.dot(J.n) >= 0 ? 1 : -1;
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, nc = 0; for (let i = 0; i < N; i++) if (crown[i]) { nc++; if (U[i] < u0) u0 = U[i]; if (U[i] > u1) u1 = U[i]; if (V[i] < v0) v0 = V[i]; if (V[i] > v1) v1 = V[i]; }
    if (nc < 1500) return null; u0 -= 2; v0 -= 2; const W = Math.ceil((u1 - u0 + 2) / R) + 1, Hh = Math.ceil((v1 - v0 + 2) / R) + 1, G = W * Hh;
    const cell = new Int32Array(N).fill(-1), cnt = new Uint16Array(G), hg = new Float32Array(G).fill(-1e9);
    const hs = []; for (let i = 0; i < N; i += 3) if (crown[i]) hs.push(H[i] * sg); hs.sort((a, b) => a - b);
    const hmin = hs[Math.floor(hs.length * 0.02)], hmax = hs[Math.floor(hs.length * 0.995)];
    for (let i = 0; i < N; i++) { if (!crown[i]) continue; const x = Math.floor((U[i] - u0) / R), y = Math.floor((V[i] - v0) / R), c = y * W + x; cell[i] = c; cnt[c]++; const h = H[i] * sg; if (h > hg[c]) hg[c] = h; }
    const thr = hmin + 0.35 * (hmax - hmin); let m = new Uint8Array(G); for (let i = 0; i < G; i++) if (cnt[i] && hg[i] > thr) m[i] = 1;
    for (let k = 0; k < 2; k++) m = dilate(m, W, Hh); for (let k = 0; k < 2; k++) m = erode(m, W, Hh);
    m = fillHoles(m, W, Hh);
    for (let k = 0; k < 2; k++) m = erode(m, W, Hh); for (let k = 0; k < 2; k++) m = dilate(m, W, Hh);
    { const cc = components(m, W, Hh); let big = 0; for (let i = 1; i <= cc.n; i++) big = Math.max(big, cc.sizes[i]); const lim = Math.max(300, 0.1 * big); for (let i = 0; i < G; i++) if (m[i] && cc.sizes[cc.lab[i]] < lim) m[i] = 0; }
    const dt = gauss(edt(m, W, Hh), W, Hh, 1.5), bs = basins(dt, m, W, Hh, 1.0);
    /* các cụm */
    let blobs = []; for (let b = 1; b <= bs.n; b++) blobs.push({ id: b, n: 0, sx: 0, sy: 0 });
    for (let i = 0; i < G; i++) { const l = bs.lab[i]; if (l) { const o = blobs[l - 1]; o.n++; o.sx += i % W; o.sy += (i / W) | 0; } }
    blobs.forEach((o) => { o.area = o.n * R * R; o.cx = o.sx / o.n; o.cy = o.sy / o.n; o.cu = u0 + (o.cx + 0.5) * R; o.cv = v0 + (o.cy + 0.5) * R; });
    const areas = blobs.map((o) => o.area).sort((a, b) => a - b), med = areas[Math.floor(areas.length / 2)] || 1;
    const dropped = new Set(blobs.filter((o) => o.area < 0.22 * med).map((o) => o.id)); blobs = blobs.filter((o) => !dropped.has(o.id));
    if (blobs.length < 4) return null;

    /* 2. xếp các cụm dọc cung hàm: góc quanh tâm, bắt đầu sau khoảng hở lớn nhất */
    let cu = 0, cv = 0; blobs.forEach((o) => { cu += o.cu; cv += o.cv; }); cu /= blobs.length; cv /= blobs.length;
    blobs.forEach((o) => (o.ang = Math.atan2(o.cv - cv, o.cu - cu))); blobs.sort((a, b) => a.ang - b.ang);
    let gi = 0, gmax = -1; for (let i = 0; i < blobs.length; i++) { const a = blobs[i].ang, b = blobs[(i + 1) % blobs.length].ang; let d = b - a; if (d <= 0) d += 2 * Math.PI; if (d > gmax) { gmax = d; gi = i; } }
    const chain = []; for (let k = 1; k <= blobs.length; k++) chain.push(blobs[(gi + k) % blobs.length]);
    /* hướng ra phía trước: từ trung điểm hai đầu cung hàm tới tâm các cụm */
    const e0 = chain[0], e1 = chain[chain.length - 1]; let fu = cu - (e0.cu + e1.cu) / 2, fv = cv - (e0.cv + e1.cv) / 2; { const L = Math.hypot(fu, fv) || 1; fu /= L; fv /= L; }
    let mid = -1, bestSc = -1e9, mu = 0, mv = 0;
    for (let k = 0; k < chain.length - 1; k++) { const a = chain[k], b = chain[k + 1], px = (a.cu + b.cu) / 2 - cu, py = (a.cv + b.cv) / 2 - cv, along = px * fu + py * fv, perp = Math.abs(-px * fv + py * fu); const sc = along - 0.9 * perp; if (sc > bestSc) { bestSc = sc; mid = k; mu = (a.cu + b.cu) / 2; mv = (a.cv + b.cv) / 2; } }
    /* hai bên của đường giữa, xếp từ đường giữa ra ngoài */
    const sideA = chain.slice(mid + 1), sideB = chain.slice(0, mid + 1).reverse();
    /* bên nào là bên phải của bệnh nhân */
    const a3 = new THREE.Vector3().addScaledVector(J.e1, fu).addScaledVector(J.e2, fv).normalize(), sup = J.occ.clone().multiplyScalar(jaw === 'upper' ? -1 : 1), right = new THREE.Vector3().crossVectors(a3, sup).normalize();
    const ru = right.dot(J.e1), rv = right.dot(J.e2), aIsRight = (sideA.length ? (sideA[0].cu - mu) * ru + (sideA[0].cv - mv) * rv : 0) > 0;

    /* 3. gán số bằng quy hoạch động */
    function solve(side, kap, base0) {
      const ms = (q) => { const F = base0 + q; if (inv && inv.absent.has(F)) return 0.5; if (inv && inv.present.has(F)) return MISS[q - 1] + 0.8; return MISS[q - 1]; }, ap = (i) => (inv && inv.absent.has(base0 + i + 1) ? 0.6 : 0);
      const n = side.length, S = []; let acc = 0; const Wd = WIDTH[jaw]; for (let i = 0; i < 8; i++) { S.push((acc + Wd[i] / 2) * kap); acc += Wd[i]; }
      const sj = []; let prev = { cu: mu, cv: mv }, run = 0; side.forEach((o, j) => { run += Math.hypot(o.cu - prev.cu, o.cv - prev.cv); sj.push(run); prev = o; });
      const Ea = AREA[jaw].map((x) => x * kap * kap), INF = 1e9, f = [], bk = [];
      const mc = (j, i, ar) => 1.0 * Math.abs(Math.log(ar / Ea[i])) + 0.9 * Math.pow((sj[j] - S[i]) / 3.5, 2) + ap(i);
      for (let j = 0; j <= n; j++) { f.push(new Float64Array(10).fill(INF)); bk.push(new Array(10).fill(null)); } // f[j][i]: đã xử lý j cụm, răng cuối đã gán là i (0 = chưa có)
      f[0][0] = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i <= 8; i++) {
        const base = f[j][i]; if (base >= INF) continue;
        // bỏ cụm này (nhiễu)
        if (base + 1.6 < f[j + 1][i]) { f[j + 1][i] = base + 1.6; bk[j + 1][i] = [i, 0, 0]; }
        for (let t = i + 1; t <= 8; t++) {
          let sk = 0; for (let q = i + 1; q < t; q++) sk += ms(q);
          const pd = (i > 0 && j > 0) ? Math.pow((Math.hypot(side[j].cu - side[j - 1].cu, side[j].cv - side[j - 1].cv) - (S[t - 1] - S[i - 1])) / 3.0, 2) * 0.6 : 0; /* khoảng cách hai cụm liền kề phải khớp với số răng bị bỏ qua */
          const c1 = base + sk + pd + mc(j, t - 1, side[j].area);
          if (c1 < f[j + 1][t]) { f[j + 1][t] = c1; bk[j + 1][t] = [i, 1, 0]; }
          if (t >= i + 2 && side[j].area > 1.05 * (Ea[t - 2] + Ea[t - 1])) { // một cụm = hai răng dính nhau
            let sk2 = 0; for (let q = i + 1; q < t - 1; q++) sk2 += ms(q);
            const half = side[j].area / 2, c2 = base + sk2 + 0.35 + 0.5 * (Math.abs(Math.log(half / Ea[t - 2])) + Math.abs(Math.log(half / Ea[t - 1]))) + 0.9 * Math.pow((sj[j] - (S[t - 2] + S[t - 1]) / 2) / 3.5, 2);
            if (c2 < f[j + 1][t]) { f[j + 1][t] = c2; bk[j + 1][t] = [i, 2, 0]; }
          }
        }
      }
      let best = INF, bi = 0; for (let i = 0; i <= 8; i++) { let tail = 0; for (let q = i + 1; q <= 8; q++) tail += ms(q); const c = f[n][i] + tail; if (c < best) { best = c; bi = i; } }
      if (best >= INF) return null;
      const out = []; let j = n, i = bi; while (j > 0) { const [pi, kind] = bk[j][i]; if (kind === 1) out.push({ blob: side[j - 1], slots: [i] }); else if (kind === 2) out.push({ blob: side[j - 1], slots: [i - 1, i] }); j--; i = pi; }
      return { out: out.reverse(), cost: best };
    }
    let bestR = null;
    for (const kap of [0.8, 0.9, 1.0, 1.1, 1.2, 1.35]) { const bR = jaw === 'upper' ? 10 : 40, bL = jaw === 'upper' ? 20 : 30, a = solve(sideA, kap, aIsRight ? bR : bL), b = solve(sideB, kap, aIsRight ? bL : bR); if (!a || !b) continue; const tot = a.cost + b.cost + 1.2 * Math.abs(Math.log(kap)); if (!bestR || tot < bestR.tot) bestR = { a, b, tot, kap }; }
    if (!bestR) return null;

    /* 4. nhãn từng ô: tooth = FDI */
    const base1 = jaw === 'upper' ? 10 : 40, base2 = jaw === 'upper' ? 20 : 30, assigned = new Map(); // blobId -> [{f, part, parts}]
    const rightRes = aIsRight ? bestR.a : bestR.b, leftRes = aIsRight ? bestR.b : bestR.a, present = new Set();
    const tan = { u: fu, v: fv }; void tan;
    const place = (res, base) => res.out.forEach((o) => {
      const sl = o.slots; if (sl.length === 1) { assigned.set(o.blob.id, [{ f: base + sl[0] }]); present.add(base + sl[0]); } else { assigned.set(o.blob.id, [{ f: base + sl[0] }, { f: base + sl[1] }]); present.add(base + sl[0]); present.add(base + sl[1]); }
    });
    place(rightRes, base1); place(leftRes, base2);
    /* nhãn ô của lưới: cụm nguyên hoặc cụm tách đôi theo hướng cung hàm */
    const cellF = new Int8Array(G);
    blobs.forEach((o) => {
      const a = assigned.get(o.id); if (!a) return;
      if (a.length === 1) { for (let i = 0; i < G; i++) if (bs.lab[i] === o.id) cellF[i] = a[0].f; return; }
      const tu = (o.cu - mu), tv = (o.cv - mv); // tách theo hướng từ đường giữa ra: răng nhỏ số hơn nằm gần đường giữa
      const L = Math.hypot(tu, tv) || 1, dx = tu / L, dy = tv / L, ps = []; for (let i = 0; i < G; i++) if (bs.lab[i] === o.id) ps.push([i, (i % W) * dx + ((i / W) | 0) * dy]); ps.sort((p, q) => p[1] - q[1]);
      const cut = Math.floor(ps.length * 0.5); ps.forEach((p, k) => (cellF[p[0]] = k < cut ? a[0].f : a[1].f));
    });
    /* phân vùng lưới 3D: lan từ lõi từng răng, vượt nếp gấp (khe kẽ răng) thì tốn thêm chi phí => ranh giới bám khe giữa các răng */
    const vlab = meshSegment(J, cell, cellF, W, Hh);
    /* mở rộng nhãn ra toàn bộ thân răng (các ô có điểm) bằng lan tỏa nhiều nguồn */
    const lab = new Int8Array(cellF), q = []; for (let i = 0; i < G; i++) if (lab[i]) q.push(i);
    const dist = new Uint8Array(G); for (let h = 0; h < q.length; h++) { const i = q[h], x = i % W, y = (i / W) | 0, d = dist[i]; if (d >= 14) continue; const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < Hh - 1 ? i + W : -1]; for (const j of nb) { if (j < 0 || lab[j] || !cnt[j]) continue; lab[j] = lab[i]; dist[j] = d + 1; q.push(j); } }
    /* hạt giống: trung bình các điểm cao nhất của từng răng */
    const byF = new Map(); for (let i = 0; i < N; i++) { const c = cell[i]; if (c < 0) continue; const f = lab[c]; if (!f) continue; if (!byF.has(f)) byF.set(f, []); byF.get(f).push(i); }
    const seeds = [], missing = [], info = [], fs = jaw === 'upper' ? [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28] : [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
    fs.forEach((f) => {
      const L = byF.get(f); if (!L || L.length < 40) { missing.push(f); info.push({ f, present: false }); return; }
      L.sort((a, b) => H[b] * sg - H[a] * sg); const k = Math.max(12, Math.floor(L.length * 0.4)); let x = 0, y = 0, z = 0, h = 0; for (let t = 0; t < k; t++) { const v = L[t]; x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; h += H[v]; }
      seeds.push({ f, p: new THREE.Vector3(x / k, y / k, z / k), h: h / k }); info.push({ f, present: true, n: L.length });
    });
    /* tham số quét cho hiệu ứng: 0 = đầu bên phải, 1 = đầu bên trái (theo góc quanh tâm cung hàm) */
    const tsw = new Float32Array(N), angF = Math.atan2(fv, fu), rel = (a) => { let d = a - angF; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
    const rsign = ((-fv * ru + fu * rv) > 0) ? 1 : -1; // chiều tăng của góc là bên phải?
    let pmin = 1e9, pmax = -1e9; const ph = new Float32Array(N); for (let i = 0; i < N; i++) { if (!crown[i]) continue; const d = rel(Math.atan2(V[i] - cv, U[i] - cu)); ph[i] = d; if (d < pmin) pmin = d; if (d > pmax) pmax = d; }
    for (let i = 0; i < N; i++) { let t = (ph[i] - pmin) / Math.max(1e-3, pmax - pmin); t = Math.max(0, Math.min(1, t)); tsw[i] = rsign > 0 ? 1 - t : t; }
    const vlab2 = archSegment(J, seeds, jaw); if (vlab2) for (let i = 0; i < N; i++) { if (!vlab2[i]) continue; const x = Math.floor((U[i] - u0) / R), y = Math.floor((V[i] - v0) / R); if (x < 0 || y < 0 || x >= W || y >= Hh || !lab[y * W + x]) vlab2[i] = 0; } /* chỉ giữ phần nằm trong bóng của răng nhìn từ trên */
    return { seeds, missing, info, sweep: tsw, quality: { cost: bestR.tot / 16, present: seeds.length, total: 16 }, flipped: false, scale: bestR.kap, grid: { u0, v0, R, W, H: Hh, lab }, vlab: vlab2 || vlab, nblobs: blobs.length, dbg: { chain: chain.map((o) => ({ cu: o.cu, cv: o.cv, area: o.area })), mid, aIsRight, res: [bestR.a.out.map((o) => [o.slots, +o.blob.area.toFixed(0)]), bestR.b.out.map((o) => [o.slots, +o.blob.area.toFixed(0)])] } };
  };
})();
