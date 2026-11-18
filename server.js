import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DURATION_MS = 240000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function resolveFile(pathname) {
  let p = decodeURIComponent(pathname);
  if (p === '/') p = '/src/index.html';

  // 只暴露本游戏自己的目录，避免把同目录下的其他项目源码也发出去
  const allowed = p.startsWith('/src/') || p.startsWith('/shared/') || p.startsWith('/vendor/');
  if (!allowed) return null;

  let file;
  if (p.startsWith('/vendor/addons/')) {
    file = path.join(ROOT, 'node_modules/three/examples/jsm', p.slice('/vendor/addons/'.length));
  } else if (p.startsWith('/vendor/')) {
    file = path.join(ROOT, 'node_modules/three/build', p.slice('/vendor/'.length));
  } else {
    file = path.join(ROOT, p);
  }
  const resolved = path.resolve(file);
  if (!resolved.startsWith(ROOT + path.sep)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const file = resolveFile(url.pathname);
  if (!file) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
      'content-length': stat.size,
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------------------------------------------------------- rooms

const rooms = new Map();
let nextId = 1;

const randCode = () => String(1000 + Math.floor(Math.random() * 9000));
const randSeed = () => (Math.random() * 0x7fffffff) | 1;

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, except) {
  for (const p of room.players) if (p.ws !== except) send(p.ws, msg);
}

function clearTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function startRound(room) {
  clearTimer(room);
  room.round += 1;
  room.phase = 'HIDE';
  room.seeds = [randSeed(), randSeed()];
  room.players.forEach((p, i) => {
    p.slot = i;
    p.hidden = null;
    p.again = false;
  });
  room.players.forEach((p) => {
    send(p.ws, {
      t: 'hidePhase',
      phase: 'HIDE',
      round: room.round,
      slot: p.slot,
      seedSelf: room.seeds[p.slot],
      seedOther: room.seeds[1 - p.slot],
    });
  });
}

function startHunt(room) {
  if (room.players.length !== 2) return;
  room.phase = 'HUNT';
  const resetTimer = setTimeout(() => finish(room, null, 'timeout'), DURATION_MS + 1500);
  resetTimer.unref?.();
  room.timer = resetTimer;

  for (const p of room.players) {
    const peer = room.players.find((q) => q !== p);
    send(p.ws, {
      t: 'start',
      phase: 'HUNT',
      seeds: room.seeds,
      youAreOn: 1 - p.slot,
      peerHidden: peer.hidden,
      duration: DURATION_MS,
    });
  }
}

function finish(room, winner, reason) {
  if (room.phase === 'RESULT') return;
  clearTimer(room);
  room.phase = 'RESULT';
  const winnerName = winner !== null && room.players[winner] ? room.players[winner].name : null;
  for (const p of room.players) {
    send(p.ws, {
      t: 'result',
      phase: 'RESULT',
      winner,
      winnerName,
      reason,
      you: p.slot,
      names: room.players.map((q) => q.name),
    });
  }
}

function handle(ws, msg) {
  if (!msg || typeof msg.t !== 'string') return;

  if (msg.t === 'join') {
    if (ws.room) return;
    let code = String(msg.code || '').replace(/\D/g, '').slice(0, 4);
    if (!code) code = randCode();
    let room = rooms.get(code);
    if (!room) {
      room = { code, players: [], phase: 'LOBBY', seeds: [0, 0], round: 0, timer: null };
      rooms.set(code, room);
    }
    if (room.players.length >= 2) {
      send(ws, { t: 'error', message: '房间已满（最多两人）' });
      return;
    }
    const name = String(msg.name || '').trim().slice(0, 16) || `病人${ws.id}`;
    const player = { ws, id: ws.id, slot: room.players.length, name, hidden: null, again: false };
    room.players.push(player);
    ws.room = room;
    ws.player = player;
    send(ws, { t: 'joined', code, slot: player.slot, playerId: ws.id });
    broadcast(room, { t: 'peerJoined', count: room.players.length }, ws);
    if (room.players.length === 2) startRound(room);
    return;
  }

  const room = ws.room;
  const player = ws.player;
  if (!room || !player) return;

  if (msg.t === 'hide') {
    if (room.phase !== 'HIDE' || player.hidden) return;
    const x = Number(msg.x);
    const z = Number(msg.z);
    const y = Number(msg.y ?? 0);
    const yaw = Number(msg.yaw);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return;
    if (!Number.isFinite(y) || y < 0 || y > 3.4) return;
    player.hidden = {
      x,
      y,
      z,
      yaw: Number.isFinite(yaw) ? yaw : 0,
      spotId: Number.isInteger(msg.spotId) ? msg.spotId : -1,
    };
    broadcast(room, { t: 'peerHidden' }, ws);
    if (room.players.length === 2 && room.players.every((p) => p.hidden)) startHunt(room);
    return;
  }

  if (msg.t === 'found') {
    if (room.phase === 'HUNT') finish(room, player.slot, 'found');
    return;
  }

  if (msg.t === 'died') {
    if (room.phase === 'HUNT') finish(room, 1 - player.slot, 'ghost');
    return;
  }

  if (msg.t === 'timeout') {
    if (room.phase === 'HUNT') finish(room, null, 'timeout');
    return;
  }

  if (msg.t === 'again') {
    if (room.phase !== 'RESULT') return;
    player.again = true;
    if (room.players.length === 2 && room.players.every((p) => p.again)) startRound(room);
    return;
  }
}

function dropPlayer(ws) {
  const room = ws.room;
  const player = ws.player;
  if (!room || !player) return;
  room.players = room.players.filter((p) => p !== player);
  ws.room = null;
  ws.player = null;
  clearTimer(room);
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }
  room.phase = 'LOBBY';
  room.players.forEach((p, i) => {
    p.slot = i;
    p.hidden = null;
    p.again = false;
  });
  broadcast(room, { t: 'peerLeft', phase: 'LOBBY' });
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.room = null;
  ws.player = null;
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    handle(ws, msg);
  });
  ws.on('close', () => dropPlayer(ws));
  ws.on('error', () => dropPlayer(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, 30000);
heartbeat.unref?.();

server.listen(PORT, '0.0.0.0', () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
    }
  }
  console.log('');
  console.log('  寂静病房 · SILENT WARD');
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  局域网: http://${ip}:${PORT}`);
  console.log('  两人打开同一地址，输入同一个 4 位房间码。');
  console.log('');
});
