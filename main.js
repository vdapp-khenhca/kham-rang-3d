'use strict';
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

if (!app.requestSingleInstanceLock()) { app.quit(); }

const DATA = () => app.getPath('userData');
const CASES = () => path.join(DATA(), 'cases');
const SETTINGS_FILE = () => path.join(DATA(), 'settings.json');
const KEY_FILE = () => path.join(DATA(), 'ai.key');

const OLD_RULES = [
  'Vai trò: bạn là trợ lý phân tích hồ sơ nha khoa cho phòng khám. Bác sĩ luôn là người quyết định cuối cùng.',
  'Chỉ nêu điều thấy được từ dữ liệu. Chỗ chưa chắc chắn phải ghi rõ "cần bác sĩ xác nhận", không suy đoán.',
  'Nội dung dành cho khách phải dễ hiểu, trung lập, nêu khuyến nghị và rủi ro tương lai. Không nhắc giá, không ưu đãi, không thúc ép làm dịch vụ.',
  'Dùng ký hiệu FDI (11 đến 48) khi nói về từng răng.',
  'Trả về đúng JSON theo yêu cầu, không thêm văn bản ngoài JSON.'
].map((r, i) => (i + 1) + '. ' + r).join('\n');

const DEFAULT_RULES = [
  'VAI TRÒ: bạn là bác sĩ chuyên khoa Răng Hàm Mặt có kinh nghiệm lâm sàng (nha tổng quát, nội nha, nha chu, phục hình, phẫu thuật miệng, chỉnh nha, cắn khớp), hỗ trợ bác sĩ của phòng khám đọc scan 3D trong miệng và ảnh X-quang. Bác sĩ trực tiếp khám luôn là người quyết định cuối cùng.',
  'NGUYÊN TẮC TRUNG THỰC: chỉ ghi điều NHÌN THẤY trên dữ liệu được đưa. Không bịa, không suy diễn quá mức. Scan bề mặt không thấy được kẽ răng, dưới nướu, dưới mão, tủy, chân răng, xương: các vấn đề này chỉ ghi là "cần X-quang hoặc khám trực tiếp". Dùng "có thể", "nghi ngờ"; không khẳng định chẩn đoán. Chỗ không chắc phải ghi rõ trong mục cần bác sĩ xác nhận.',
  'KÝ HIỆU: dùng FDI (hàm trên phải 18-11, trái 21-28; hàm dưới trái 38-31, phải 41-48), trái/phải là của BỆNH NHÂN. Luôn đối chiếu hình thái răng với số răng được gán (cửa, nanh, tiền hàm 2 múi, hàm lớn 3-5 múi, răng khôn) và báo ngay nếu thấy không khớp.',
  'KHÁM CÓ HỆ THỐNG cho từng răng theo thứ tự: (1) mô cứng: sâu men/ngà (đốm trắng đục, nâu, hố rãnh tối, mất cấu trúc), nứt, mẻ, mòn cơ học hoặc hóa học, mòn cổ răng, dấu hiệu nghiến; (2) phục hình có sẵn: trám, mão, cầu, implant, bờ phục hình hở, đổi màu, lộ viền kim loại; (3) nha chu: nướu viêm đỏ phù, tụt nướu, lộ chân, vôi, mảng bám; (4) khớp cắn và vị trí: xoay, nghiêng, chen chúc, thưa, trồi, lún, khoảng mất răng, răng khôn lệch; (5) nguy cơ tiến triển nếu không xử lý.',
  'MỨC ƯU TIÊN: "cao" khi có dấu hiệu rõ cần can thiệp sớm (sâu lớn, vỡ, viêm nướu nặng, phục hình hỏng, nguy cơ biến chứng); "trung bình" khi cần xử lý hoặc theo dõi trong vài tháng; "thấp" khi chỉ cần duy trì và theo dõi định kỳ. Không nâng mức ưu tiên để thúc ép làm dịch vụ.',
  'ĐỀ XUẤT DỊCH VỤ phải có căn cứ nhìn thấy và theo thứ tự lâm sàng hợp lý (kiểm soát nhiễm trùng và nha chu trước, điều trị bảo tồn, rồi phục hình, sau cùng thẩm mỹ). Ưu tiên giữ răng thật, điều trị bảo tồn nhất có thể. Không đề xuất điều trị xâm lấn khi chưa đủ căn cứ.',
  'CHỖ CẦN X-QUANG: sâu kẽ và sâu dưới mão, tình trạng tủy và vùng quanh chóp, mức tiêu xương, chân răng, răng ngầm, xoang hàm. Khi đọc phim, nêu vị trí theo FDI và ghi rõ chất lượng phim nếu khó đọc.',
  'VĂN PHONG: nội dung dành cho khách phải dễ hiểu, trung lập, nêu khuyến nghị cụ thể và rủi ro tương lai. Không nhắc giá, không ưu đãi, không thúc ép, không dọa. Nội dung cho bác sĩ thì ngắn gọn, đúng thuật ngữ chuyên môn.',
  'ĐỊNH DẠNG: trả về đúng JSON theo yêu cầu, tiếng Việt, không thêm văn bản ngoài JSON.'
].map((r, i) => (i + 1) + '. ' + r).join('\n');

const DEFAULT_SETTINGS = {
  clinic: { name: 'Tên phòng khám', address: '', phone: '', doctor: '', license: '', logo: '', note: '' },
  ai: { model: 'gpt-4o', rules: DEFAULT_RULES },
  update: { repo: 'vdapp-khenhca/kham-rang-3d' }
};

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } }
function writeJson(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); }
function settings() { const s = readJson(SETTINGS_FILE(), {}); if (s.ai && (!s.ai.rules || s.ai.rules === OLD_RULES)) s.ai.rules = DEFAULT_RULES; return { clinic: Object.assign({}, DEFAULT_SETTINGS.clinic, s.clinic), ai: Object.assign({}, DEFAULT_SETTINGS.ai, s.ai), update: Object.assign({}, DEFAULT_SETTINGS.update, s.update) }; }
function apiKey() {
  try { const b = fs.readFileSync(KEY_FILE()); if (b.slice(0, 4).toString() === 'RAW:') return Buffer.from(b.slice(4).toString(), 'base64').toString('utf8'); return safeStorage.decryptString(b); } catch (e) { return ''; }
}
const safeKey = (k) => String(k).replace(/[^a-z0-9\-_]/gi, '').slice(0, 80);

let win = null;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 980, minHeight: 640, title: 'Khám Răng 3D', backgroundColor: '#0d1417',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => { createWindow(); setupUpdater(); });
app.on('window-all-closed', () => app.quit());

/* ---------------- cases (patient records, stored on this computer) ---------------- */
ipcMain.handle('cases:list', () => {
  const dir = CASES(); if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((k) => readJson(path.join(dir, k, 'case.json'), null)).filter(Boolean);
});
ipcMain.handle('cases:load', (e, key) => {
  key = safeKey(key); const dir = path.join(CASES(), key), data = readJson(path.join(dir, 'case.json'), null);
  if (!data) return null;
  const scans = {};
  ['upper', 'lower'].forEach((j) => { for (const ext of ['ply', 'stl']) { const f = path.join(dir, j + '.' + ext); if (fs.existsSync(f)) { scans[j] = { ext, buf: fs.readFileSync(f) }; break; } } });
  for (const ext of ['jpg', 'png', 'webp']) { const f = path.join(dir, 'pano.' + ext); if (fs.existsSync(f)) { scans.pano = { ext, buf: fs.readFileSync(f) }; break; } }
  return { data, scans };
});
ipcMain.handle('cases:save', (e, key, data) => { writeJson(path.join(CASES(), safeKey(key), 'case.json'), data); return true; });
ipcMain.handle('cases:saveScan', (e, key, jaw, ext, buf) => {
  const dir = path.join(CASES(), safeKey(key)); fs.mkdirSync(dir, { recursive: true });
  const isPano = jaw === 'pano', exts = isPano ? ['jpg', 'png', 'webp'] : ['ply', 'stl'], useExt = exts.indexOf(ext) >= 0 ? ext : exts[0];
  if (!isPano && jaw !== 'upper' && jaw !== 'lower') throw new Error('Tên file không hợp lệ');
  exts.forEach((x) => { try { fs.unlinkSync(path.join(dir, jaw + '.' + x)); } catch (er) {} });
  fs.writeFileSync(path.join(dir, jaw + '.' + useExt), Buffer.from(buf)); return true;
});
ipcMain.handle('cases:delete', (e, key) => { fs.rmSync(path.join(CASES(), safeKey(key)), { recursive: true, force: true }); return true; });
ipcMain.handle('app:openDataFolder', () => { fs.mkdirSync(DATA(), { recursive: true }); return shell.openPath(DATA()); });
ipcMain.handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Chọn file scan của khách (kèm ảnh X-quang nếu có)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Scan 3D và ảnh X-quang', extensions: ['zip', 'ply', 'stl', 'jpg', 'jpeg', 'png', 'webp'] }] });
  if (r.canceled) return [];
  return r.filePaths.map((p) => ({ name: path.basename(p), buf: fs.readFileSync(p) }));
});

/* ---------------- settings and AI ---------------- */
ipcMain.handle('settings:get', () => ({ settings: settings(), hasKey: !!apiKey(), version: app.getVersion(), dataPath: DATA(), packaged: app.isPackaged }));
ipcMain.handle('settings:set', (e, patch) => { const s = settings(); ['clinic', 'ai', 'update'].forEach((k) => { if (patch[k]) s[k] = Object.assign({}, s[k], patch[k]); }); writeJson(SETTINGS_FILE(), s); if (patch.update) configureFeed(); return true; });
ipcMain.handle('settings:setKey', (e, key) => {
  key = String(key || '').trim();
  if (!key) { try { fs.unlinkSync(KEY_FILE()); } catch (er) {} return { ok: true, hasKey: false }; }
  fs.mkdirSync(DATA(), { recursive: true });
  if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(KEY_FILE(), safeStorage.encryptString(key));
  else fs.writeFileSync(KEY_FILE(), 'RAW:' + Buffer.from(key, 'utf8').toString('base64'));
  return { ok: true, hasKey: true };
});
async function openai(pathname, init) {
  const key = apiKey(); if (!key) throw new Error('Chưa nhập khóa API OpenAI. Vào Cài đặt để nhập.');
  const r = await fetch('https://api.openai.com' + pathname, Object.assign({}, init, { headers: Object.assign({ Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, init && init.headers) }));
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) {}
  if (!r.ok) {
    const m = (j && j.error && j.error.message) || text.slice(0, 200);
    if (r.status === 401) throw new Error('Khóa API không đúng hoặc đã bị thu hồi.');
    if (r.status === 429) throw new Error('OpenAI báo quá giới hạn hoặc hết hạn mức: ' + m);
    throw new Error('OpenAI trả lỗi ' + r.status + ': ' + m);
  }
  return j;
}
ipcMain.handle('ai:models', async () => { const j = await openai('/v1/models', { method: 'GET' }); return (j.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id)).sort(); });
ipcMain.handle('ai:run', async (e, { prompt, images }) => {
  const s = settings();
  const content = [{ type: 'text', text: prompt }].concat((images || []).map((u) => ({ type: 'image_url', image_url: { url: u, detail: 'high' } })));
  const j = await openai('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: s.ai.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: s.ai.rules }, { role: 'user', content }] }) });
  const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
  if (!txt) throw new Error('AI không trả về nội dung.');
  try { return JSON.parse(txt); } catch (er) { throw new Error('AI trả về dữ liệu không đúng định dạng, thử lại.'); }
});

/* ---------------- PDF ---------------- */
function fontCss() {
  const dir = path.join(__dirname, 'renderer', 'fonts'); let css = '';
  for (const w of [400, 500, 600, 700]) for (const sub of ['vietnamese', 'latin']) {
    const f = path.join(dir, 'be-vietnam-pro-' + sub + '-' + w + '-normal.woff2'); if (!fs.existsSync(f)) continue;
    const range = sub === 'vietnamese' ? 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB' : 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
    css += "@font-face{font-family:'BVP';font-weight:" + w + ';font-style:normal;src:url(data:font/woff2;base64,' + fs.readFileSync(f).toString('base64') + ") format('woff2');unicode-range:" + range + ';}\n';
  }
  return css;
}
ipcMain.handle('pdf:make', async (e, { html, name, footerLeft }) => {
  const tmp = path.join(app.getPath('temp'), 'kr_report_' + Date.now() + '.html');
  fs.writeFileSync(tmp, html.replace('/*FONTS*/', fontCss()));
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  try {
    await w.loadFile(tmp);
    await w.webContents.executeJavaScript('document.fonts.ready.then(() => true)');
    const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    const footer = '<div style="font-family:Arial,sans-serif;font-size:7.5px;color:#5b6a73;width:100%;padding:0 17mm;display:flex;justify-content:space-between"><span>' + esc(footerLeft) + '</span><span>Trang <span class="pageNumber"></span>/<span class="totalPages"></span></span></div>';
    const buf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>', footerTemplate: footer, margins: { top: 0.55, bottom: 0.7, left: 0.65, right: 0.65 } });
    const r = await dialog.showSaveDialog(win, { title: 'Lưu phiếu khám PDF', defaultPath: path.join(app.getPath('documents'), name || 'PhieuKham.pdf'), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.writeFileSync(r.filePath, buf); shell.openPath(r.filePath); return { path: r.filePath };
  } finally { w.destroy(); try { fs.unlinkSync(tmp); } catch (er) {} }
});

/* ---------------- updates (GitHub Releases) ---------------- */
function configureFeed() {
  const m = String(settings().update.repo || '').trim().replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '').replace(/(\.git)?\/*$/i, '').match(/^([\w.-]+)\/([\w.-]+)$/);
  if (m) { try { autoUpdater.setFeedURL({ provider: 'github', owner: m[1], repo: m[2] }); return true; } catch (e) {} }
  return false;
}
function setupUpdater() {
  autoUpdater.autoDownload = false; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => send('update:status', { state: 'checking' }));
  autoUpdater.on('update-available', (i) => send('update:status', { state: 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes.replace(/<[^>]+>/g, '').slice(0, 400) : '' }));
  autoUpdater.on('update-not-available', () => send('update:status', { state: 'none', version: app.getVersion() }));
  autoUpdater.on('download-progress', (p) => send('update:status', { state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => send('update:status', { state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => send('update:status', { state: 'error', message: String((e && e.message) || e).slice(0, 220) }));
  if (app.isPackaged && configureFeed()) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 6000);
}
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return send('update:status', { state: 'dev' });
  if (!configureFeed()) return send('update:status', { state: 'norepo' });
  try { await autoUpdater.checkForUpdates(); } catch (e) { send('update:status', { state: 'error', message: String(e.message || e).slice(0, 220) }); }
});
ipcMain.handle('update:download', async () => { try { await autoUpdater.downloadUpdate(); } catch (e) { send('update:status', { state: 'error', message: String(e.message || e).slice(0, 220) }); } });
ipcMain.handle('update:install', () => { autoUpdater.quitAndInstall(false, true); });
