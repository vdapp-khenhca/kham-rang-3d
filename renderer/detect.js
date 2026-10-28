/* Nhận diện răng tự động trên scan hàm (hình học, chạy ngay trong máy).
   Ý tưởng: lấy các điểm thân răng (đã tách khỏi nướu theo màu), tìm hướng cung hàm,
   trải cung hàm ra thành một đường, tìm các khe giữa răng (chỗ thấp), rồi gán số răng
   từ đường giữa ra hai bên theo bề rộng răng thông thường. Chỗ nào không có răng thì ghi là răng mất. */
(function () {
  'use strict';
  const WIDTH = {
    upper: [8.6, 6.6, 7.6, 7.0, 6.6, 10.2, 9.4, 8.4],
    lower: [5.4, 5.9, 6.9, 7.1, 7.3, 11.0, 10.4, 9.6]
  };
  const DS = 0.25; // mm mỗi ô trên đường cung hàm

  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; }
  function smooth(arr, w) {
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0, c = 0; for (let k = -w; k <= w; k++) { const j = i + k; if (j >= 0 && j < n) { s += arr[j]; c++; } } out[i] = s / c; }
    return out;
  }

  window.detectTeeth = function (J, jaw, THREE) {
    const N = J.crown.length, P = J.geo.getAttribute('position').array, U = J.U, V = J.V, H = J.H, crown = J.crown;
    const sg = J.occ.dot(J.n) >= 0 ? 1 : -1;
    /* bỏ các mảng "giống thân răng" rời rạc (nhiễu ở nướu): chỉ giữ các cụm lớn nối liền nhau */
    let keep = crown;
    if (J.geo.index) {
      const ix = J.geo.index.array, par = new Int32Array(N); for (let i = 0; i < N; i++) par[i] = i;
      const find = (x) => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
      for (let t = 0; t < ix.length; t += 3) { const a = ix[t], b = ix[t + 1], c = ix[t + 2]; if (crown[a] && crown[b]) par[find(a)] = find(b); if (crown[b] && crown[c]) par[find(b)] = find(c); if (crown[a] && crown[c]) par[find(a)] = find(c); }
      const size = new Map(); let tot = 0; for (let i = 0; i < N; i++) if (crown[i]) { const r = find(i); size.set(r, (size.get(r) || 0) + 1); tot++; }
      let big = 0; size.forEach((v) => { if (v > big) big = v; });
      keep = new Uint8Array(N); for (let i = 0; i < N; i++) if (crown[i] && size.get(find(i)) >= Math.max(300, big * 0.12)) keep[i] = 1;
    }
    const idx = []; for (let i = 0; i < N; i++) if (keep[i]) idx.push(i);
    if (idx.length < 1500) return null;
    let cu = 0, cv = 0; for (const i of idx) { cu += U[i]; cv += V[i]; } cu /= idx.length; cv /= idx.length;

    /* 1. Chia theo góc quanh tâm, tìm khoảng hở phía sau (miệng cung hàm) */
    const NB = 360, cnt = new Float32Array(NB), binOf = new Int16Array(N).fill(-1);
    for (const i of idx) { let b = Math.floor(((Math.atan2(V[i] - cv, U[i] - cu) + Math.PI) / (2 * Math.PI)) * NB); if (b >= NB) b = NB - 1; if (b < 0) b = 0; binOf[i] = b; cnt[b]++; }
    const sc = new Float32Array(NB); for (let b = 0; b < NB; b++) { let s = 0; for (let k = -4; k <= 4; k++) s += cnt[(b + k + NB) % NB]; sc[b] = s / 9; }
    let mx = 0; for (let b = 0; b < NB; b++) mx = Math.max(mx, sc[b]);
    const low = (b) => sc[b] < mx * 0.06;
    let bestLen = 0, bestStart = 0;
    for (let b = 0; b < NB; b++) { if (!low(b) || low((b - 1 + NB) % NB)) continue; let L = 0; while (L < NB && low((b + L) % NB)) L++; if (L > bestLen) { bestLen = L; bestStart = b; } }
    if (bestLen < 20 || bestLen > 250) return null;
    const gapMid = ((bestStart + bestLen / 2) % NB + 0.5) / NB * 2 * Math.PI - Math.PI, thA = wrap(gapMid + Math.PI);

    /* 2. Trải cung hàm: mỗi góc một điểm giữa thân răng, độ cao đỉnh múi */
    const nPhi = NB, phiOf = (b) => wrap(((b + 0.5) / NB) * 2 * Math.PI - Math.PI - thA);
    const order = []; for (let b = 0; b < NB; b++) if (cnt[b] > 0) order.push(b);
    order.sort((x, y) => phiOf(x) - phiOf(y));
    const mu = new Float32Array(NB), mv = new Float32Array(NB), hp = new Float32Array(NB), ok = new Uint8Array(NB), lists = new Array(NB);
    for (const i of idx) { const b = binOf[i]; (lists[b] || (lists[b] = [])).push(i); }
    for (const b of order) {
      const L = lists[b]; if (L.length < 6) continue; let su = 0, sv = 0; for (const i of L) { su += U[i]; sv += V[i]; } mu[b] = su / L.length; mv[b] = sv / L.length;
      const hs = L.map((i) => H[i] * sg).sort((x, y) => y - x), k = Math.max(3, Math.floor(hs.length * 0.12)); let t = 0; for (let q = 0; q < k; q++) t += hs[q]; hp[b] = t / k; ok[b] = 1;
    }
    const arch = order.filter((b) => ok[b] && Math.abs(phiOf(b)) < Math.PI * 0.98); if (arch.length < 40) return null;
    { /* làm mượt đường tâm cung hàm để chiều dài không bị gấp khúc */
      const su = arch.map((b) => mu[b]), sv = arch.map((b) => mv[b]), W2 = 9;
      arch.forEach((b, k) => { let a = 0, c = 0, q = 0; for (let j = Math.max(0, k - W2); j <= Math.min(arch.length - 1, k + W2); j++) { a += su[j]; c += sv[j]; q++; } mu[b] = a / q; mv[b] = c / q; });
    }
    const sArc = new Float32Array(NB).fill(NaN); let acc = 0;
    for (let k = 0; k < arch.length; k++) { if (k) { const a = arch[k - 1], b = arch[k]; acc += Math.hypot(mu[b] - mu[a], mv[b] - mv[a]); } sArc[arch[k]] = acc; }
    const total = acc, nG = Math.floor(total / DS) + 1; if (nG < 120) return null;
    const hpG = new Float32Array(nG), massG = new Float32Array(nG), cntG = new Float32Array(nG), phiG = new Float32Array(nG);
    const sBinList = arch.map((b) => sArc[b]);
    let ptr = 0;
    for (let g = 0; g < nG; g++) {
      const s = g * DS; while (ptr < arch.length - 2 && sBinList[ptr + 1] < s) ptr++;
      const a = arch[ptr], b = arch[Math.min(ptr + 1, arch.length - 1)], s0 = sArc[a], s1 = sArc[b], t = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 0;
      hpG[g] = hp[a] * (1 - t) + hp[b] * t; phiG[g] = phiOf(a) * (1 - t) + phiOf(b) * t;
    }
    /* khối lượng thân răng theo chiều dài cung: số điểm trong mỗi ô */
    const vS = new Float32Array(N).fill(NaN);
    for (const i of idx) { const b = binOf[i]; let s = sArc[b]; if (s !== s) { let bb = b, d = 0; while (s !== s && d < 6) { bb = (bb + 1) % NB; s = sArc[bb]; d++; } } if (s === s) { vS[i] = s; const g = Math.min(nG - 1, Math.round(s / DS)); cntG[g]++; } }
    const cg = smooth(cntG, 3); let med = 0; { const nz = Array.from(cg).filter((x) => x > 0).sort((x, y) => x - y); med = nz.length ? nz[Math.floor(nz.length * 0.6)] : 1; }
    for (let g = 0; g < nG; g++) massG[g] = Math.min(1.5, cg[g] / (med || 1));
    const hs = smooth(hpG, 2), valley = new Float32Array(nG), W = Math.round(2.6 / DS);
    for (let g = 0; g < nG; g++) {
      let l = -1e9, r = -1e9; for (let k = 1; k <= W; k++) { if (g - k >= 0) l = Math.max(l, hs[g - k]); if (g + k < nG) r = Math.max(r, hs[g + k]); }
      const d = Math.min(l, r) - hs[g]; valley[g] = d > 0 ? d : 0;
    }
    /* đầu mút cung hàm (nơi hết răng) */
    let gA = 0; while (gA < nG - 1 && massG[gA] < 0.3) gA++; let gB = nG - 1; while (gB > 0 && massG[gB] < 0.3) gB--;

    /* 3. Đường giữa: ô ứng với phía trước, tinh chỉnh theo khe sâu nhất gần đó */
    let gm = 0, bd = 1e9; for (let g = gA; g <= gB; g++) { const d = Math.abs(phiG[g]); if (d < bd) { bd = d; gm = g; } }
    let gm2 = gm, bv = valley[gm]; for (let k = -Math.round(2.2 / DS); k <= Math.round(2.2 / DS); k++) { const g = gm + k; if (g > gA && g < gB && valley[g] > bv + 0.15) { bv = valley[g]; gm2 = g; } } gm = gm2;

    /* 4. Quy hoạch động cho từng bên */
    function solveSide(sign, scale) {
      const pos = []; for (let g = gm; sign > 0 ? g <= gB : g >= gA; g += sign) pos.push(g);
      const m = pos.length, W8 = WIDTH[jaw].map((x) => x * scale), INF = 1e9;
      const mass = pos.map((g) => massG[g]), val = pos.map((g) => valley[g]);
      const pm = new Float32Array(m + 1); for (let j = 0; j < m; j++) pm[j + 1] = pm[j] + (mass[j] < 0.3 ? 1 : 0);
      const pmass = new Float32Array(m + 1); for (let j = 0; j < m; j++) pmass[j + 1] = pmass[j] + Math.min(1, mass[j]);
      const dp = []; const bk = [];
      for (let i = 0; i <= 8; i++) { dp.push(new Float32Array(m).fill(INF)); bk.push(new Array(m).fill(null)); }
      dp[0][0] = 0;
      for (let i = 1; i <= 8; i++) {
        const w = W8[i - 1], lo = Math.max(1, Math.round(0.7 * w / DS)), hi = Math.round(1.55 * w / DS), mlo = 0, mhi = Math.round(1.0 * w / DS);
        for (let a = 0; a < m; a++) {
          const base = dp[i - 1][a]; if (base >= INF) continue;
          for (let L = lo; L <= hi; L++) {
            const b = a + L; if (b >= m) break;
            const dev = (L * DS - w) / w, hole = (pm[b] - pm[a]) / L;
            const c = base + (dev < 0 ? 9.0 : 3.0) * dev * dev + 3.2 * hole - 0.5 * Math.min(1, val[b] / 1.2);
            if (c < dp[i][b]) { dp[i][b] = c; bk[i][b] = [a, 1]; }
          }
          for (let L = mlo; L <= mhi; L++) {
            const b = a + L; if (b >= m) break;
            const gm_ = L ? (pmass[b] - pmass[a]) / L : 0;
            const c = base + 0.9 + 5.0 * gm_ + 0.4 * (L * DS / w);
            if (c < dp[i][b]) { dp[i][b] = c; bk[i][b] = [a, 0]; }
          }
        }
      }
      let bestB = -1, best = INF; const tail = (j) => (pmass[m] - pmass[j]) * DS * 0.8;
      for (let b = 0; b < m; b++) { if (dp[8][b] >= INF) continue; const c = dp[8][b] + tail(b); if (c < best) { best = c; bestB = b; } }
      if (bestB < 0) return null;
      const res = []; let b = bestB; for (let i = 8; i >= 1; i--) { const [a, present] = bk[i][b]; res[i - 1] = { present: !!present, g0: pos[a], g1: pos[b], a, b }; b = a; }
      return { res, cost: best };
    }
    let sideP = null, sideN = null, bestScale = 1, bestTot = 1e9;
    for (const sc2 of [0.82, 0.88, 0.94, 1.0, 1.06, 1.12]) {
      const a = solveSide(1, sc2), b = solveSide(-1, sc2); if (!a || !b) continue;
      const tot = a.cost + b.cost + Math.abs(Math.log(sc2)) * 2.5; if (tot < bestTot) { bestTot = tot; sideP = a; sideN = b; bestScale = sc2; }
    }
    if (!sideP || !sideN) return null;

    /* 5. Bên nào là bên phải của bệnh nhân? (theo hình học, không phụ thuộc cách quét) */
    const au = Math.cos(thA), av = Math.sin(thA);
    const a3 = new THREE.Vector3().addScaledVector(J.e1, au).addScaledVector(J.e2, av).normalize();
    const sup = J.occ.clone().multiplyScalar(jaw === 'upper' ? -1 : 1);
    const right = new THREE.Vector3().crossVectors(a3, sup).normalize();
    const tan = new THREE.Vector3().addScaledVector(J.e1, -av).addScaledVector(J.e2, au).normalize();
    const posIsRight = tan.dot(right) > 0; // chiều tăng của góc phi (tăng s) là bên phải?
    /* s tăng theo phi tăng, nên sideP (g tăng) ứng với phi tăng */
    const rightSide = posIsRight ? sideP : sideN, leftSide = posIsRight ? sideN : sideP;
    const base1 = jaw === 'upper' ? 10 : 40, base2 = jaw === 'upper' ? 20 : 30;

    /* 6. Dựng hạt giống (tâm mỗi răng) */
    const seeds = [], missing = [], info = [];
    const make = (side, base) => {
      side.res.forEach((t, i) => {
        const f = base + i + 1;
        if (!t.present) { missing.push(f); info.push({ f, present: false }); return; }
        const s0 = Math.min(t.g0, t.g1) * DS, s1 = Math.max(t.g0, t.g1) * DS, sel = [];
        for (const v of idx) { const s = vS[v]; if (s === s && s >= s0 && s <= s1) sel.push(v); }
        if (sel.length < 40) { missing.push(f); info.push({ f, present: false }); return; }
        sel.sort((x, y) => H[y] * sg - H[x] * sg); const k = Math.max(12, Math.floor(sel.length * 0.4)); let x = 0, y = 0, z = 0, h = 0;
        for (let q = 0; q < k; q++) { const v = sel[q]; x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; h += H[v]; }
        seeds.push({ f, p: new THREE.Vector3(x / k, y / k, z / k), h: h / k });
        info.push({ f, present: true, width: (s1 - s0), s0, s1 });
      });
    };
    make(rightSide, base1); make(leftSide, base2);

    /* 7. Tham số quét cho hiệu ứng: 0 = đầu bên phải, 1 = đầu bên trái */
    const tsw = new Float32Array(N), phiMin = phiG[gA], phiMax = phiG[gB], span = Math.max(1e-3, phiMax - phiMin);
    for (let i = 0; i < N; i++) { let ph = wrap(Math.atan2(V[i] - cv, U[i] - cu) - thA); let t = (ph - phiMin) / span; t = Math.max(0, Math.min(1, t)); tsw[i] = posIsRight ? 1 - t : t; }
    const cost = (sideP.cost + sideN.cost) / 16;
    return { dbg: { vS,  valley, massG, hpG, gm, gA, gB, DS, rightIsPos: posIsRight, res: [sideP.res, sideN.res] }, seeds, missing, info, sweep: tsw, quality: { cost, present: seeds.length, total: 16, archLen: total }, flipped: !posIsRight, scale: bestScale };
  };
})();
