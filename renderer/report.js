/* Builds the HTML of the customer-facing examination record (printed to PDF by the main process). */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (iso) => (iso || '').slice(0, 10).split('-').reverse().join('/');
  const nl = (s) => esc(s).replace(/\n/g, '<br>');
  const UP = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28], LO = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
  const INK = '#1d3646', RULE = '#9aa8b1';

  function chart(states) {
    const W = 9.6, G = 0.8, MID = 3.4, H = 10.5, x0 = 0, row = (arr, y) => arr.map((f, i) => {
      const x = x0 + i * (W + G) + (i >= 8 ? MID : 0), st = states[f] || 'none';
      let fill = '#fff', stroke = RULE, sw = 0.35, txt = '#6b7a84', dash = '', extra = '';
      if (st === 'done') { fill = INK; stroke = INK; txt = '#fff'; }
      else if (st === 'pend') { fill = 'url(#h1)'; stroke = INK; sw = 0.5; txt = INK; }
      else if (st === 'risk') { fill = 'url(#h2)'; stroke = INK; sw = 0.9; txt = INK; }
      else if (st === 'missing') { dash = ' stroke-dasharray="1.2 0.8"'; extra = '<line x1="' + (x + 1.5) + '" y1="' + (y + 1.5) + '" x2="' + (x + W - 1.5) + '" y2="' + (y + H - 1.5) + '" stroke="' + RULE + '" stroke-width=".35"/><line x1="' + (x + W - 1.5) + '" y1="' + (y + 1.5) + '" x2="' + (x + 1.5) + '" y2="' + (y + H - 1.5) + '" stroke="' + RULE + '" stroke-width=".35"/>'; }
      const lab = st === 'pend' || st === 'risk' ? '<rect x="' + (x + 2.3) + '" y="' + (y + H / 2 - 2.1) + '" width="' + (W - 4.6) + '" height="4.2" fill="#fff"/>' : '';
      return '<rect x="' + x + '" y="' + y + '" width="' + W + '" height="' + H + '" rx="1.2" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + sw + '"' + dash + '/>' + extra + lab +
        '<text x="' + (x + W / 2) + '" y="' + (y + H / 2 + 1.25) + '" text-anchor="middle" font-size="3.4" font-weight="600" fill="' + txt + '">' + f + '</text>';
    }).join('');
    const total = 16 * W + 15 * G + MID;
    return '<svg viewBox="0 0 ' + total + ' 29" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="BVP, Arial, sans-serif">' +
      '<defs><pattern id="h1" width="1.7" height="1.7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.7" height="1.7" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.7" stroke="' + INK + '" stroke-width=".45"/></pattern>' +
      '<pattern id="h2" width="1.1" height="1.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.1" height="1.1" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.1" stroke="' + INK + '" stroke-width=".5"/></pattern></defs>' +
      row(UP, 1) + row(LO, 17.5) + '</svg>';
  }
  const legendSvg = (kind) => {
    const body = { done: '<rect x=".3" y=".3" width="8.4" height="5.4" rx="1" fill="' + INK + '"/>', pend: '<rect x=".3" y=".3" width="8.4" height="5.4" rx="1" fill="url(#l1)" stroke="' + INK + '" stroke-width=".5"/>', risk: '<rect x=".3" y=".3" width="8.4" height="5.4" rx="1" fill="url(#l2)" stroke="' + INK + '" stroke-width=".9"/>', none: '<rect x=".3" y=".3" width="8.4" height="5.4" rx="1" fill="#fff" stroke="' + RULE + '" stroke-width=".4"/>', missing: '<rect x=".3" y=".3" width="8.4" height="5.4" rx="1" fill="#fff" stroke="' + RULE + '" stroke-width=".4" stroke-dasharray="1.2 .8"/><path d="M2 1.4 L7 4.6 M7 1.4 L2 4.6" stroke="' + RULE + '" stroke-width=".35"/>' }[kind];
    return '<svg viewBox="0 0 9 6" width="19" height="13" style="vertical-align:-3px;margin-right:4px"><defs><pattern id="l1" width="1.7" height="1.7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.7" height="1.7" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.7" stroke="' + INK + '" stroke-width=".45"/></pattern><pattern id="l2" width="1.1" height="1.1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1.1" height="1.1" fill="#fff"/><line x1="0" y1="0" x2="0" y2="1.1" stroke="' + INK + '" stroke-width=".5"/></pattern></defs>' + body + '</svg>';
  };

  window.buildReport = function (c) {
    const p = c.patient, cl = c.clinic;
    const kv = (k, v) => '<tr><th>' + k + '</th><td>' + (v ? esc(v) : '<span class="dim">—</span>') + '</td></tr>';
    const rows = c.teethRows.map((r) => '<tr><td class="num">' + r.f + '</td><td>' + (r.note ? nl(r.note) : '<span class="dim">—</span>') + '</td><td>' +
      (r.done.length ? r.done.map((d) => esc(d.name) + '<div class="sub">' + fmt(d.date) + (d.who ? ' · ' + esc(d.who) : '') + '</div>').join('') : '<span class="dim">—</span>') + '</td><td>' +
      (r.todo.length ? r.todo.map((d) => esc(d.name) + (d.note ? '<div class="sub">' + esc(d.note) + '</div>' : '')).join('') : '<span class="dim">—</span>') + '</td></tr>').join('');
    const li = (arr) => arr.length ? '<ul>' + arr.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p class="dim">Không có nội dung.</p>';
    const PG = { now: 'Cần làm ngay', soon: 'Nên làm trong 1–3 tháng', later: 'Có thể cân nhắc sau' };
    const plan = (c.plan || []).length ? ['now', 'soon', 'later'].map((g) => { const L = c.plan.filter((x) => x.group === g); return L.length ? '<h3 style="margin:8pt 0 3pt;font-size:10pt">' + PG[g] + '</h3><table class="grid"><thead><tr><th style="width:8%">Răng</th><th style="width:18%">Việc cần làm</th><th style="width:20%">Căn cứ</th><th style="width:18%">Kết quả mong đợi</th><th style="width:20%">Nguy cơ nếu không làm</th><th style="width:16%">Thời gian dự kiến</th></tr></thead><tbody>' + L.map((x) => '<tr><td class="num">' + esc(x.teeth || '') + '</td><td>' + esc(x.title) + '</td><td>' + esc(x.why) + '</td><td>' + esc(x.outcome) + '</td><td>' + esc(x.risk) + '</td><td>' + esc([x.when, x.visits].filter(Boolean).join('. ')) + '</td></tr>').join('') + '</tbody></table>' : ''; }).join('') : '';
    const care = c.care.length ? '<table class="grid"><thead><tr><th style="width:24%">Dự kiến</th><th>Nội dung</th></tr></thead><tbody>' + c.care.map((t) => '<tr><td>' + fmt(t.due) + '</td><td>' + esc(t.title) + '</td></tr>').join('') + '</tbody></table>' : '';
    const shot = (src, cap) => src ? '<figure><img src="' + src + '"><figcaption>' + cap + '</figcaption></figure>' : '';
    return '<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Phiếu khám ' + esc(p.name) + '</title><style>/*FONTS*/' + `
*{box-sizing:border-box} html,body{margin:0;padding:0}
body{font-family:'BVP',Arial,sans-serif;font-size:9.4pt;line-height:1.5;color:#17242d;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.head{display:flex;justify-content:space-between;align-items:flex-end;gap:16pt;padding-bottom:9pt;border-bottom:1.3pt solid ${INK}}
.brand{display:flex;gap:10pt;align-items:center}
.brand img{height:40pt;max-width:90pt;object-fit:contain}
.brand h1{margin:0;font-size:13pt;font-weight:700;color:${INK};line-height:1.2}
.brand p{margin:1pt 0 0;font-size:8.2pt;color:#4d5d67}
.doc{text-align:right}
.doc .t{font-size:11pt;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:${INK}}
.doc .m{font-size:8.4pt;color:#4d5d67;margin-top:2pt}
h2{font-size:8.8pt;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${INK};border-bottom:.6pt solid ${RULE};padding-bottom:3pt;margin:15pt 0 7pt;break-after:avoid}
h2 span{display:inline-block;min-width:28pt}
p{margin:0 0 5pt} ul{margin:0;padding-left:14pt} li{margin:0 0 2.5pt}
.dim{color:#8b99a2} .sub{font-size:8pt;color:#5b6a73;margin-top:1pt}
table{border-collapse:collapse;width:100%}
table.kv{table-layout:fixed} table.kv th{width:17%;text-align:left;font-weight:500;color:#4d5d67;padding:3.5pt 6pt 3.5pt 0;vertical-align:top;font-size:8.6pt}
table.kv td{padding:3.5pt 12pt 3.5pt 0;border-bottom:.4pt solid #d3dade;vertical-align:top} table.kv th{border-bottom:.4pt solid #d3dade}
table.grid{border:.6pt solid ${RULE}} table.grid th,table.grid td{border:.5pt solid ${RULE};padding:4pt 6pt;vertical-align:top;text-align:left}
table.grid thead th{background:#edf1f3;font-weight:600;font-size:8.3pt;color:${INK}}
table.grid td.num{font-weight:700;width:9%;text-align:center;color:${INK}}
table.grid tr{break-inside:avoid}
.counts{display:flex;gap:0;border:.6pt solid ${RULE}}
.counts div{flex:1;padding:6pt 10pt;border-right:.6pt solid ${RULE}} .counts div:last-child{border-right:0}
.counts b{display:block;font-size:15pt;font-weight:600;color:${INK};line-height:1.15}
.counts span{font-size:8pt;color:#4d5d67}
.shots{display:grid;grid-template-columns:1fr 1fr;gap:10pt}
figure{margin:0;break-inside:avoid} figure img{width:100%;display:block;border:.5pt solid ${RULE}} figcaption{font-size:8pt;color:#4d5d67;margin-top:3pt}
.legend{font-size:8pt;color:#4d5d67;margin-top:5pt;display:flex;flex-wrap:wrap;gap:3pt 14pt}
.avoid{break-inside:avoid}
.sign{display:flex;justify-content:flex-end;margin-top:20pt;break-inside:avoid}
.sign div{width:200pt;text-align:center;font-size:8.8pt} .sign .line{height:52pt} .sign b{font-weight:600}
.note{margin-top:14pt;padding-top:6pt;border-top:.5pt solid ${RULE};font-size:8pt;color:#5b6a73;break-inside:avoid}
` + '</style></head><body>' +
      '<div class="head"><div class="brand">' + (cl.logo ? '<img src="' + cl.logo + '">' : '') + '<div><h1>' + esc(cl.name) + '</h1>' + (cl.address ? '<p>' + esc(cl.address) + '</p>' : '') + (cl.phone ? '<p>Điện thoại: ' + esc(cl.phone) + '</p>' : '') + '</div></div>' +
      '<div class="doc"><div class="t">Phiếu khám răng miệng</div><div class="m">Mã hồ sơ: ' + esc(c.code) + '<br>Ngày khám: ' + fmt(p.visitDate) + '</div></div></div>' +

      '<h2><span>I.</span>Thông tin khách hàng</h2><table class="kv"><tr>' + kv('Họ và tên', p.name).replace(/<\/tr>$/, '') + kv('Năm sinh', p.year).replace(/^<tr>/, '') + '</tr><tr>' + kv('Giới tính', p.gender).replace(/<\/tr>$/, '') + kv('Điện thoại', p.phone).replace(/^<tr>/, '') + '</tr><tr>' + kv('Bác sĩ khám', p.doctor || cl.doctor).replace(/<\/tr>$/, '') + kv('Ngày khám', fmt(p.visitDate)).replace(/^<tr>/, '') + '</tr>' +
      (p.history ? '<tr><th>Tiền sử, lưu ý</th><td colspan="3">' + nl(p.history) + '</td></tr>' : '') + '</table>' +

      '<h2><span>II.</span>Nhận định tổng quan</h2><div class="avoid">' + (c.summary ? '<p>' + nl(c.summary) + '</p>' : '<p class="dim">Chưa có nhận định.</p>') + '</div>' +
      '<div class="counts avoid"><div><b>' + c.counts.examined + '</b><span>Răng đã ghi nhận</span></div><div><b>' + c.counts.done + '</b><span>Hạng mục đã thực hiện</span></div><div><b>' + c.counts.todo + '</b><span>Hạng mục cần thực hiện hoặc theo dõi</span></div><div><b>' + c.counts.missing + '</b><span>Răng đã mất</span></div></div>' +

      '<h2><span>III.</span>Hình ảnh scan 3D trong miệng</h2><div class="shots">' + shot(c.shots.upper, 'Hàm trên, nhìn từ mặt nhai') + shot(c.shots.lower, 'Hàm dưới, nhìn từ mặt nhai') + '</div>' +

      '<h2><span>IV.</span>Sơ đồ răng</h2><div class="avoid">' + chart(c.states) + '<div class="legend"><span>' + legendSvg('done') + 'Đã thực hiện</span><span>' + legendSvg('pend') + 'Cần thực hiện hoặc theo dõi</span><span>' + legendSvg('risk') + 'Cần thực hiện, nên sớm</span><span>' + legendSvg('none') + 'Chưa ghi nhận</span><span>' + legendSvg('missing') + 'Đã mất răng</span></div><div class="legend"><span>Hàng trên: hàm trên (18 đến 28) · Hàng dưới: hàm dưới (48 đến 38). Ký hiệu theo FDI.</span></div></div>' +

      '<h2><span>V.</span>Chi tiết từng răng</h2>' + (rows ? '<table class="grid"><thead><tr><th>Răng</th><th style="width:34%">Nhận xét</th><th style="width:26%">Đã thực hiện</th><th style="width:26%">Cần thực hiện hoặc theo dõi</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="dim">Chưa có ghi nhận theo từng răng.</p>') +

      (plan ? '<h2><span>VI.</span>Kế hoạch điều trị đề xuất</h2>' + plan : '') +
      '<h2><span>VII.</span>Lời khuyên</h2><div class="avoid">' + li(c.advice) + '</div>' +
      '<h2><span>VIII.</span>Những điều cần lưu ý trong tương lai</h2><div class="avoid">' + li(c.risks) + '</div>' +
      (care ? '<h2><span>IX.</span>Lịch tái khám và chăm sóc dự kiến</h2><div class="avoid">' + care + '</div>' : '') +
      '<div class="sign"><div>Ngày ' + fmt(p.visitDate) + '<br><b>Bác sĩ khám</b><div class="line"></div>' + esc(p.doctor || cl.doctor || '') + (cl.license ? '<br><span class="dim">CCHN: ' + esc(cl.license) + '</span>' : '') + '</div></div>' +
      '<div class="note">' + esc(cl.note || 'Phiếu này tổng hợp kết quả khám và hình ảnh scan tại thời điểm lập, không thay thế chỉ định điều trị của bác sĩ. Nếu có thắc mắc hoặc thấy răng miệng có thay đổi, xin liên hệ phòng khám để được hỗ trợ.') + '</div>' +
      '</body></html>';
  };
})();
