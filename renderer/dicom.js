/* Đọc file DICOM ảnh X-quang (panorama, cephalo, cận chóp) không nén, chạy ngay trong máy. */
(function () {
  'use strict';
  const LONG = { OB: 1, OW: 1, OF: 1, OD: 1, OL: 1, SQ: 1, UT: 1, UN: 1, UC: 1, UR: 1 };
  const clean = (s) => String(s || '').replace(/\0/g, '').trim();
  function parse(buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf); let p = 0;
    if (buf.byteLength > 132 && String.fromCharCode(u8[128], u8[129], u8[130], u8[131]) === 'DICM') p = 132;
    else throw new Error('Không phải file DICOM hợp lệ');
    const T = {}; let ts = '1.2.840.10008.1.2.1', explicit = true, pix = null;
    const txt = (o, l) => { let s = ''; for (let i = 0; i < l; i++) s += String.fromCharCode(u8[o + i]); return s; };
    while (p + 8 <= buf.byteLength) {
      const g = dv.getUint16(p, true), e = dv.getUint16(p + 2, true), grp = g === 2;
      const ex = grp ? true : explicit; let vr = '', len, hdr;
      if (g === 0xfffe) { const l = dv.getUint32(p + 4, true); p += 8; if (e === 0xe000 && l !== 0xffffffff) { /* mục trong chuỗi: đi vào trong */ } continue; }
      if (ex) { vr = txt(p + 4, 2); if (LONG[vr]) { len = dv.getUint32(p + 8, true); hdr = 12; } else { len = dv.getUint16(p + 6, true); hdr = 8; } }
      else { len = dv.getUint32(p + 4, true); hdr = 8; }
      const key = (g << 16 | e) >>> 0, vo = p + hdr;
      if (key === 0x7fe00010) { pix = { off: vo, len: len === 0xffffffff ? -1 : len, vr }; break; }
      if (len === 0xffffffff) { p = vo; continue; } /* chuỗi độ dài không xác định: đi vào trong */
      if (vr === 'SQ' || (!ex && (g & 1) === 0 && false)) { p = vo; continue; }
      if (T[key] === undefined) {
        if (vr === 'US' || (!ex && (key === 0x00280010 || key === 0x00280011 || key === 0x00280100 || key === 0x00280101 || key === 0x00280102 || key === 0x00280103 || key === 0x00280002))) T[key] = dv.getUint16(vo, true);
        else if (vr === 'SS') T[key] = dv.getInt16(vo, true);
        else T[key] = clean(txt(vo, Math.min(len, 256)));
      }
      if (key === 0x00020010) { ts = T[key]; explicit = ts !== '1.2.840.10008.1.2'; }
      p = vo + len;
    }
    if (!pix) throw new Error('File DICOM không có dữ liệu ảnh');
    if (/^1\.2\.840\.10008\.1\.2\.(4|5|6)|^1\.2\.840\.10008\.1\.2\.1\.99|^1\.2\.840\.10008\.1\.2\.2$/.test(ts)) throw new Error('DICOM này được nén hoặc big-endian (' + ts + '). Hãy xuất lại không nén hoặc xuất ảnh JPG/PNG từ phần mềm máy chụp.');
    const w = +T[0x00280011], h = +T[0x00280010], ba = +T[0x00280100] || 16, bs = +T[0x00280101] || ba, rep = +T[0x00280103] || 0, spp = +T[0x00280002] || 1;
    if (!w || !h) throw new Error('Thiếu kích thước ảnh trong DICOM');
    if (spp !== 1) throw new Error('DICOM ảnh màu chưa được hỗ trợ');
    const n = w * h, nf = +T[0x00280008] || 1; if (nf > 1) throw new Error('DICOM nhiều lát (CT khối) chưa đọc trực tiếp được. Hãy xuất ảnh panorama hoặc lát cắt dạng JPG/PNG.');
    let px;
    if (ba === 16) { if (pix.off + n * 2 > buf.byteLength) throw new Error('Dữ liệu ảnh bị cắt ngắn'); px = new Uint16Array(n); for (let i = 0; i < n; i++) px[i] = dv.getUint16(pix.off + i * 2, true); if (rep) for (let i = 0; i < n; i++) px[i] = (px[i] + 32768) & 0xffff; }
    else if (ba === 8) { px = new Uint16Array(n); for (let i = 0; i < n; i++) px[i] = u8[pix.off + i]; }
    else throw new Error('Độ sâu ảnh ' + ba + ' bit chưa hỗ trợ');
    const sp = String(T[0x00280030] || T[0x00181164] || '').split('\\').map(Number).filter((x) => x > 0);
    const name = String(T[0x00100010] || '').replace(/\^/g, ' ').replace(/\s+/g, ' ').trim();
    return { w, h, px, signed: !!rep, bits: bs, mono1: /MONOCHROME1/i.test(T[0x00280004] || ''), spacing: sp[0] || 0, meta: { modality: T[0x00080060] || '', maker: T[0x00080070] || '', model: T[0x00081090] || '', name, age: T[0x00101010] || '', sex: T[0x00100040] || '', study: T[0x00080020] || '', id: T[0x00100020] || '', ipp: T[0x00200032] || '', inst: T[0x00200013] || '', thick: T[0x00180050] || '', rs: T[0x00281053] || '', ri: T[0x00281052] || '' } };
  }
  /* một lát cắt CT: trả về Int16 gốc và vị trí z */
  function parseSlice(buf) {
    const d = parse(buf), n = d.w * d.h, s = new Int16Array(n); for (let i = 0; i < n; i++) s[i] = d.raw ? d.raw[i] : d.signed ? d.px[i] - 32768 : d.px[i];
    const ipp = String(d.meta.ipp || '').split('\\').map(Number);
    return { w: d.w, h: d.h, s, z: ipp.length === 3 ? ipp[2] : NaN, inst: +d.meta.inst || 0, spacing: d.spacing, thick: +d.meta.thick || 0, meta: d.meta };
  }
  /* cửa sổ hiển thị tự động theo phân vị, trả về canvas 8 bit */
  function toCanvas(d, opt) {
    opt = opt || {}; const n = d.w * d.h, step = Math.max(1, Math.floor(n / 200000)), hist = new Uint32Array(65536); let tot = 0;
    for (let i = 0; i < n; i += step) { const v = d.px[i]; if (v > 0) { hist[v]++; tot++; } }
    const q = (f) => { let a = 0, t = tot * f; for (let v = 0; v < 65536; v++) { a += hist[v]; if (a >= t) return v; } return 65535; };
    const lo = opt.lo != null ? opt.lo : q(0.004), hi = opt.hi != null ? opt.hi : q(0.997), c = document.createElement('canvas'); c.width = d.w; c.height = d.h;
    const g = c.getContext('2d'), im = g.createImageData(d.w, d.h), o = im.data, inv = d.mono1 !== !!opt.invert, k = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) { let v = (d.px[i] - lo) * k; v = v < 0 ? 0 : v > 255 ? 255 : v; if (inv) v = 255 - v; o[i * 4] = o[i * 4 + 1] = o[i * 4 + 2] = v; o[i * 4 + 3] = 255; }
    g.putImageData(im, 0, 0); return c;
  }
  /* tăng tương phản cục bộ (làm rõ chân răng, xương) cho ảnh gửi AI; box = [x0,y0,x1,y1] theo tỉ lệ 0-1 */
  function enhance(srcCanvas, box, maxW) {
    const W0 = srcCanvas.width, H0 = srcCanvas.height, sx = Math.round(box[0] * W0), sy = Math.round(box[1] * H0), sw = Math.round((box[2] - box[0]) * W0), sh = Math.round((box[3] - box[1]) * H0), k = Math.min(1, maxW / sw);
    const w = Math.round(sw * k), h = Math.round(sh * k), c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, w, h);
    const im = g.getImageData(0, 0, w, h), d = im.data, L = new Float32Array(w * h); for (let i = 0; i < w * h; i++) L[i] = d[i * 4];
    const r = Math.max(8, Math.round(w / 28)), I = new Float64Array((w + 1) * (h + 1)); for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += L[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1), m = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); let v = 128 + (L[y * w + x] - m) * 2.2 + (m - 128) * 0.35; v = v < 0 ? 0 : v > 255 ? 255 : v; const j = (y * w + x) * 4; d[j] = d[j + 1] = d[j + 2] = v; }
    g.putImageData(im, 0, 0); return c;
  }
  window.DICOM = { parse, parseSlice, toCanvas, enhance };
})();
