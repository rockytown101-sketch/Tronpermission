const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const TronWeb = require('tronweb');

const DATA_DIR = path.join(app.getPath('userData'), 'data');
const REQUEST_FILE = path.join(DATA_DIR, 'requests.json');
const TRON_FULL_HOST = process.env.TRON_FULL_HOST || 'https://api.trongrid.io';
const TRON_API_KEY = process.env.TRON_API_KEY || '';

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(REQUEST_FILE)) fs.writeFileSync(REQUEST_FILE, '[]');
}
function loadRequests() { ensureStore(); return JSON.parse(fs.readFileSync(REQUEST_FILE, 'utf8')); }
function saveRequests(items) { ensureStore(); fs.writeFileSync(REQUEST_FILE, JSON.stringify(items, null, 2)); }
function tron() {
  const opts = { fullHost: TRON_FULL_HOST };
  if (TRON_API_KEY) opts.headers = { 'TRON-PRO-API-KEY': TRON_API_KEY };
  return new TronWeb(opts);
}
function normalizeAddress(address) {
  const t = tron();
  return t.address.fromHex(t.address.toHex(String(address).trim()));
}
function isAddress(address) {
  try { normalizeAddress(address); return true; } catch { return false; }
}
function proposalHash({ target, a, b, threshold }) {
  const payload = JSON.stringify({ v: 1, target, signers: [a, b], threshold });
  return crypto.createHash('sha256').update(payload).digest('hex');
}
function id() { return `MSIG-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`; }

async function buildPermissionTx({ target, a, b, threshold = 2 }) {
  const t = tron();
  const account = await t.trx.getAccount(target);
  if (!account || !account.address) throw new Error('无法读取目标账户');
  const currentOwner = account.owner_permission;
  if (!currentOwner || !Array.isArray(currentOwner.keys)) throw new Error('目标账户缺少可用 Owner Permission');
  const currentOwnerAddress = t.address.fromHex(account.address);
  const owns = currentOwner.keys.some(k => t.address.fromHex(k.address) === target);
  if (!owns) throw new Error('当前 C 地址不在现有 Owner Permission 中，无法授权修改');

  // AccountPermissionUpdateContract overwrites permission slots. Preserve active permissions.
  const owner = {
    type: 0,
    permission_name: 'owner',
    threshold,
    keys: [
      { address: a, weight: 1 },
      { address: b, weight: 1 }
    ]
  };
  const active = Array.isArray(account.active_permission) ? account.active_permission : [];
  const tx = await t.transactionBuilder.updateAccountPermissions(target, owner, null, active);
  return { tx, currentOwnerAddress };
}

function tronLinkDeepLink({ tx, target, callbackUrl, requestId }) {
  const param = {
    url: 'https://example.invalid/tron-permission-control',
    callbackUrl,
    dappName: 'TRON Permission Control',
    protocol: 'TronLink',
    version: '1.0',
    chainId: '0x2b6653dc',
    action: 'sign',
    loginAddress: target,
    signType: 'signTransaction',
    data: JSON.stringify(tx),
    method: 'AccountPermissionUpdateContract',
    actionId: requestId
  };
  return 'tronlinkoutside://pull.activity?param=' + encodeURIComponent(JSON.stringify(param));
}

function tokenPocketDeepLink({ tx, requestId, callbackSchema = 'tronpermission://tp-callback' }) {
  // TP officially documents tpoutside:// and pushTransaction. Exact TRON txData fields can vary by TP version;
  // keep the raw transaction available and let the adapter be updated independently.
  const param = {
    txData: JSON.stringify(tx),
    action: 'pushTransaction',
    actionId: requestId,
    blockchains: [{ chainId: '728126428', network: 'tron' }],
    dappName: 'TRON Permission Control',
    expired: Math.floor(Date.now() / 1000) + 600,
    protocol: 'TokenPocket',
    version: '1.1.8',
    callbackSchema
  };
  return 'tpoutside://pull.activity?param=' + encodeURIComponent(JSON.stringify(param));
}

async function createRequest(input) {
  const target = normalizeAddress(input.target);
  const a = normalizeAddress(input.a);
  const b = normalizeAddress(input.b);
  if (target === a || target === b) throw new Error('A/B 不能与 C 相同');
  if (a === b) throw new Error('A/B 必须是两个不同地址');
  const threshold = 2;
  const proposal = proposalHash({ target, a, b, threshold });
  const request = {
    id: id(), target, a, b, threshold, proposalHash: proposal,
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    status: 'PENDING'
  };
  const built = await buildPermissionTx({ target, a, b, threshold });
  request.transaction = built.tx;
  request.currentOwnerAddress = built.currentOwnerAddress;
  const items = loadRequests(); items.push(request); saveRequests(items);
  return request;
}

function createWindow() {
  const win = new BrowserWindow({ width: 1120, height: 820, minWidth: 900, minHeight: 700, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false } });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

ipcMain.handle('request:create', async (_, input) => {
  try { return { ok: true, request: await createRequest(input) }; }
  catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.handle('request:list', () => ({ ok: true, requests: loadRequests().map(r => ({ ...r, transaction: undefined })) }));
ipcMain.handle('request:get', (_, requestId) => ({ ok: true, request: loadRequests().find(r => r.id === requestId) || null }));
ipcMain.handle('wallet:open', async (_, payload) => {
  try {
    if (!payload?.url) throw new Error('缺少钱包 DeepLink');
    await shell.openExternal(payload.url);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message || String(e) }; }
});
ipcMain.handle('wallet:links', async (_, requestId) => {
  const request = loadRequests().find(r => r.id === requestId);
  if (!request) return { ok: false, error: '请求不存在' };
  const callback = 'https://YOUR-SERVER.example/api/wallet/callback';
  return { ok: true, tronLink: tronLinkDeepLink({ tx: request.transaction, target: request.target, callbackUrl: callback, requestId }), tokenPocket: tokenPocketDeepLink({ tx: request.transaction, requestId }) };
});
ipcMain.handle('settings:get', () => ({ apiHost: TRON_FULL_HOST, apiKeyConfigured: Boolean(TRON_API_KEY) }));
ipcMain.handle('app:showError', (_, message) => dialog.showErrorBox('TRON Permission Control', message));

app.whenReady().then(() => { ensureStore(); createWindow(); app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
