/**
 * ZAPRASTRO — API NUVEM DE FOTO DO WHATSAPP (BAILEYS 24/7)
 * Permite parear via QR Code em /conectar-whatsapp e consultar fotos em /api-wa-pic.php?phone=5511999999999
 */
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]:', err && err.message ? err.message : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]:', reason && reason.message ? reason.message : reason);
});

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const SESSION_DIR = path.join(__dirname, 'wa-session');
const photoCache = new Map();

let waSock = null;
let waStatus = 'initializing'; // 'initializing' | 'qr' | 'connected' | 'disconnected'
let waQrDataUrl = null;
let waConnectedNumber = null;
let reconnecting = false;

async function startWhatsAppClient() {
  try {
    const baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = baileys.default || baileys.makeWASocket;
    const { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;
    const QRCode = require('qrcode');
    const pino = require('pino');

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    let version = [2, 3000, 1015901307];
    try {
      const latest = await fetchLatestBaileysVersion();
      if (latest && latest.version) version = latest.version;
    } catch (e) {}

    waSock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['ZapRastro Nuvem', 'Chrome', '122.0.0'],
      syncFullHistory: false,
      markOnlineOnConnect: false,
      shouldIgnoreJid: () => true,
      shouldSyncHistoryMessage: () => false,
      getMessage: async () => undefined
    });

    waSock.ev.on('creds.update', saveCreds);

    waSock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        waStatus = 'qr';
        try {
          waQrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        } catch (e) {}
      }

      if (connection === 'open') {
        waStatus = 'connected';
        waQrDataUrl = null;
        reconnecting = false;
        const me = waSock.user && waSock.user.id ? waSock.user.id.split(':')[0] : 'Conectado';
        waConnectedNumber = '+' + me.replace(/\D/g, '');
        console.log('[ZapRastro Nuvem] Conectado com sucesso:', waConnectedNumber);
      }

      if (connection === 'close') {
        const statusCode =
          lastDisconnect &&
          lastDisconnect.error &&
          lastDisconnect.error.output &&
          lastDisconnect.error.output.statusCode;

        const loggedOut = statusCode === DisconnectReason.loggedOut;
        waStatus = 'disconnected';
        waQrDataUrl = null;
        waConnectedNumber = null;

        if (loggedOut) {
          console.log('[ZapRastro Nuvem] Sessão desconectada. Limpando sessão...');
          try {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
          } catch (e) {}
        }

        if (!reconnecting) {
          reconnecting = true;
          setTimeout(() => {
            reconnecting = false;
            startWhatsAppClient();
          }, 3000);
        }
      }
    });
  } catch (err) {
    console.error('[ZapRastro Nuvem] Erro ao iniciar Baileys:', err.message);
    waStatus = 'error';
  }
}

function timeoutPromise(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ]);
}

async function getPhotoFromBaileys(phoneDigits) {
  if (!waSock || waStatus !== 'connected') return null;
  try {
    let clean = String(phoneDigits).replace(/\D/g, '');
    if (clean.length <= 11) clean = '55' + clean;

    const candidates = [];
    candidates.push(clean);
    if (clean.startsWith('55') && clean.length === 13) {
      const ddd = clean.slice(2, 4);
      if (clean[4] === '9') candidates.push('55' + ddd + clean.slice(5));
    } else if (clean.startsWith('55') && clean.length === 12) {
      const ddd = clean.slice(2, 4);
      candidates.push('55' + ddd + '9' + clean.slice(4));
    }

    for (const num of candidates) {
      try {
        const results = await timeoutPromise(waSock.onWhatsApp(num), 3000);
        if (results && results.length > 0 && results[0].exists && results[0].jid) {
          const jid = results[0].jid;
          try {
            const url = await timeoutPromise(waSock.profilePictureUrl(jid, 'image'), 3500);
            if (url) return url;
          } catch (picErr) {}
        }
      } catch (checkErr) {}
    }
    return null;
  } catch (e) {
    return null;
  }
}

function renderQrPage() {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZapRastro — Conectar WhatsApp Nuvem</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0B141A; color: #E9EDEF; margin: 0; padding: 24px 16px; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { max-width: 420px; width: 100%; background: #111B21; border: 1px solid rgba(0, 230, 118, 0.25); border-radius: 20px; padding: 28px 20px; text-align: center; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
    h1 { font-size: 20px; color: #00E676; margin: 0 0 8px; }
    p { font-size: 13.5px; color: #8696A0; line-height: 1.45; margin: 0 0 20px; }
    .qr-box { background: #fff; padding: 16px; border-radius: 14px; display: inline-block; margin-bottom: 18px; min-width: 280px; min-height: 280px; display: flex; align-items: center; justify-content: center; }
    .status-badge { display: inline-flex; align-items: center; gap: 8px; padding: 8px 16px; border-radius: 24px; font-size: 13px; font-weight: 700; margin-bottom: 18px; }
    .connected { background: rgba(0, 230, 118, 0.15); color: #00E676; border: 1px solid #00E676; }
    .waiting { background: rgba(234, 179, 8, 0.15); color: #EAB308; border: 1px solid #EAB308; }
    .btn { background: #00A884; color: #fff; border: none; border-radius: 10px; padding: 12px 20px; font-size: 14px; font-weight: 700; cursor: pointer; width: 100%; margin-top: 10px; }
    .btn-danger { background: #EF4444; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🛰️ ZapRastro — Conector Nuvem</h1>
    <p>Escaneie o QR Code com o WhatsApp do chip secundário para ativar a busca de fotos 24h.</p>
    <div id="status-container"></div>
    <div id="qr-container"></div>
    <button id="btn-logout" class="btn btn-danger" style="display:none;">Desconectar Sessão</button>
  </div>
  <script>
    async function checkStatus() {
      try {
        const res = await fetch('/api-wa-status');
        const data = await res.json();
        const statEl = document.getElementById('status-container');
        const qrEl = document.getElementById('qr-container');
        const btnLog = document.getElementById('btn-logout');

        if (data.status === 'connected') {
          statEl.innerHTML = '<div class="status-badge connected">✅ WhatsApp Conectado: ' + data.number + '</div>';
          qrEl.innerHTML = '<p style="color:#00E676;font-size:14px;">Servidor operando 24h na nuvem com sucesso!</p>';
          btnLog.style.display = 'block';
        } else if (data.qr) {
          statEl.innerHTML = '<div class="status-badge waiting">⏳ Aguardando leitura do QR Code...</div>';
          qrEl.innerHTML = '<div class="qr-box"><img src="' + data.qr + '" style="width:260px;height:260px;"></div>';
          btnLog.style.display = 'none';
        } else {
          statEl.innerHTML = '<div class="status-badge waiting">🔄 Inicializando WhatsApp...</div>';
          qrEl.innerHTML = '<p>Gerando novo QR Code...</p>';
          btnLog.style.display = 'none';
        }
      } catch(e) {}
    }
    setInterval(checkStatus, 2500);
    checkStatus();

    document.getElementById('btn-logout').onclick = async () => {
      if (!confirm('Deseja realmente desconectar?')) return;
      await fetch('/api-wa-logout', { method: 'POST' });
      location.reload();
    };
  </script>
</body>
</html>`;
}

http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Ping health-check
  if (pathname === '/' || pathname === '/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', waStatus, connectedNumber: waConnectedNumber, time: Date.now() }));
  }

  // Painel QR Code
  if (pathname === '/conectar-whatsapp') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(renderQrPage());
  }

  // Status API
  if (pathname === '/api-wa-status') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ status: waStatus, qr: waQrDataUrl, number: waConnectedNumber }));
  }

  // Logout API
  if (pathname === '/api-wa-logout' && req.method === 'POST') {
    try { if (waSock) await waSock.logout(); } catch (e) {} 
    try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
    waStatus = 'initializing';
    waQrDataUrl = null;
    waConnectedNumber = null;
    startWhatsAppClient();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }

  // Endpoint de Foto
  if (pathname === '/api-wa-pic.php' || pathname === '/api-wa-pic') {
    const phone = parsed.searchParams.get('phone') || '';
    if (!phone || phone.length < 10) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ photo: null, provider: 'invalid_phone' }));
    }

    let clean = phone.replace(/\D/g, '');
    if (clean.length <= 11) clean = '55' + clean;

    if (photoCache.has(clean)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ photo: photoCache.get(clean), provider: 'cache' }));
    }

    if (waStatus === 'connected') {
      const pic = await getPhotoFromBaileys(clean);
      if (pic) {
        photoCache.set(clean, pic);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ photo: pic, provider: 'baileys-cloud' }));
      }
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ photo: null, provider: 'no-public-photo' }));
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}).listen(PORT, () => {
  console.log(`[ZapRastro Nuvem] Servidor rodando na porta ${PORT}`);
  startWhatsAppClient();
});
