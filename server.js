/**
 * 국가 간 조직문화 인식 조사 - 서버
 *
 * 엔드포인트
 *   GET  /              설문 페이지 (참가자 접속용 — QR 링크 대상)
 *   GET  /dashboard     16:9 실시간 집계 대시보드 (강의실 모니터용)
 *   GET  /qr            QR 코드 + 접속 URL (강의실 안내용)
 *   POST /api/submit    설문 응답 저장
 *   GET  /api/results   집계 결과 JSON
 *   GET  /api/stream    SSE — 새 응답이 들어올 때마다 dashboard에 푸시
 *   POST /api/reset     응답 초기화 (관리자 토큰 필요)
 *   GET  /api/export    CSV 내보내기
 *
 * 저장: data/responses.json
 * 환경 변수
 *   PORT           기본 3000
 *   ADMIN_TOKEN    관리자 토큰 (reset, export 보호용) — 기본 'admin'
 *   PUBLIC_URL     QR 페이지에 표시할 외부 URL (예: https://survey.example.com)
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 같은 와이파이(LAN)에서 접속할 수 있는 내부 IP 주소를 찾는다
function getLanAddresses() {
  const ifaces = os.networkInterfaces();
  const addrs = [];
  for (const name of Object.keys(ifaces)) {
    for (const net of ifaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs;
}

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin';
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'responses.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- storage ----------
function loadResponses() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}
function saveResponses(arr) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2));
}

// ---------- SSE ----------
const sseClients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { /* noop */ }
  }
}

app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 5000\n\n');
  res.write(`event: hello\ndata: ${JSON.stringify({ count: loadResponses().length })}\n\n`);
  sseClients.add(res);
  // heartbeat every 25s to keep proxies happy
  const hb = setInterval(() => {
    try { res.write(': hb\n\n'); } catch (e) { clearInterval(hb); }
  }, 25000);
  req.on('close', () => {
    sseClients.delete(res);
    clearInterval(hb);
  });
});

// ---------- API ----------
app.post('/api/submit', (req, res) => {
  const { answers, pref } = req.body || {};
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'invalid_answers' });
  }
  const clean = {};
  for (let i = 1; i <= 15; i++) {
    const v = answers[i] ?? answers[String(i)];
    if (typeof v !== 'number' || v < 1 || v > 5 || !Number.isInteger(v)) {
      return res.status(400).json({ error: `invalid_q${i}` });
    }
    clean[i] = v;
  }
  const entry = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    ts: new Date().toISOString(),
    answers: clean,
    pref: typeof pref === 'string' && pref.length < 100 ? pref : null
  };
  const list = loadResponses();
  list.push(entry);
  saveResponses(list);
  broadcast('response', { count: list.length, entry });
  res.json({ ok: true, count: list.length });
});

app.get('/api/results', (req, res) => {
  res.json({ responses: loadResponses() });
});

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(403).json({ error: 'forbidden' });
  next();
}

app.post('/api/reset', requireAdmin, (req, res) => {
  // Backup before clearing
  const list = loadResponses();
  if (list.length > 0) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(DATA_DIR, `backup-${stamp}.json`), JSON.stringify(list, null, 2));
  }
  saveResponses([]);
  broadcast('reset', { count: 0 });
  res.json({ ok: true, backedUp: list.length });
});

app.get('/api/export', requireAdmin, (req, res) => {
  const list = loadResponses();
  const headers = ['id', 'ts', ...Array.from({ length: 15 }, (_, i) => `q${i + 1}`), 'pref'];
  const rows = list.map(r => [
    r.id,
    r.ts,
    ...Array.from({ length: 15 }, (_, i) => r.answers[i + 1] ?? ''),
    r.pref ?? ''
  ]);
  const csv = [headers, ...rows].map(row =>
    row.map(v => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  ).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="survey-${Date.now()}.csv"`);
  res.send('\uFEFF' + csv); // BOM for Excel Korean
});

// ---------- pages (clean URLs) ----------
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/qr', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qr.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  const lan = getLanAddresses();
  console.log(`\n  📋  국가 간 조직문화 인식 조사  ─  서버 시작됨`);
  console.log(`  ════════════════════════════════════════════════`);
  console.log(`\n  [이 PC에서 보기]`);
  console.log(`  설문        http://localhost:${PORT}/`);
  console.log(`  대시보드    http://localhost:${PORT}/dashboard`);
  console.log(`  QR 안내     http://localhost:${PORT}/qr`);
  if (lan.length) {
    console.log(`\n  [같은 와이파이에서 휴대폰으로 접속할 주소]  ← 참가자에게 공유`);
    lan.forEach(ip => {
      console.log(`  설문        http://${ip}:${PORT}/`);
      console.log(`  대시보드    http://${ip}:${PORT}/dashboard`);
      console.log(`  QR 안내     http://${ip}:${PORT}/qr`);
    });
    console.log(`\n  ※ 휴대폰이 안 열리면: PC 방화벽에서 ${PORT}번 포트 허용 +`);
    console.log(`     휴대폰/PC가 같은 와이파이인지 확인하세요.`);
  } else {
    console.log(`\n  ※ 와이파이/랜에 연결되어 있지 않아 외부 접속 주소를 못 찾았습니다.`);
  }
  console.log(`\n  관리 토큰   ${ADMIN_TOKEN}`);
  console.log(`  데이터      ${DATA_FILE}\n`);
});
