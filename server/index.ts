// LAN 対戦用のサーバー
//
//   npm start      … 画面をビルドしてからサーバーを起動
//   npm run serve  … ビルド済みの画面でサーバーだけ起動
//
// 同じネットワークの人は、表示された http://<IP>:<PORT> をブラウザで開けば参加できる。
// 4 人に満たない席は CPU が入る。対局の牌譜は logs/ に保存する。

import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Agent } from '../src/ai/agent.ts';
import { makeCpu, parseCpuLevel, type CpuLevel } from '../src/ai/index.ts';
import { parseTimeKey, PromptAgent, TIME_CONTROLS, type TimeKey } from '../src/ai/prompt.ts';
import { randomSeed, Rng } from '../src/engine/rng.ts';
import type { Rules } from '../src/engine/rules.ts';
import type { Action, Seat } from '../src/engine/types.ts';
import { viewFor } from '../src/engine/view.ts';
import type { ClientMsg, LobbyMember, ServerMsg } from '../src/net/protocol.ts';
import { MAX_HUMANS } from '../src/net/protocol.ts';
import { GameRunner } from '../src/runner.ts';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const LOG_DIR = join(ROOT, 'logs');
const CPU_DELAY = Number(process.env.CPU_DELAY ?? 500);

// ───────────── 静的ファイル ─────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ lan: true, urls: lanAddresses().map((a) => `http://${a}:${PORT}`) }));
    return;
  }
  let path = decodeURIComponent(url.pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(DIST, path));
  if (!file.startsWith(DIST) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('見つかりません');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a!.address);
}

// ───────────── 部屋 ─────────────

interface Member {
  token: string;
  name: string;
  ws: WebSocket | null;
  host: boolean;
  /** 対局中の席 */
  seat?: Seat;
  agent?: PromptAgent;
}

const members: Member[] = [];
let runner: GameRunner | null = null;
let names: string[] = [];
let lastAction: { seat: Seat; action: Action } | undefined;

function send(ws: WebSocket | null, msg: ServerMsg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcastLobby() {
  for (const m of members) {
    const list: LobbyMember[] = members.map((x) => ({ name: x.name, online: !!x.ws, you: x === m, host: x.host }));
    send(m.ws, { t: 'lobby', members: list, host: m.host, running: !!runner });
  }
}

function sendState(m: Member) {
  if (!runner || m.seat === undefined || !m.agent) return;
  const game = runner.game;
  // 局の結果の確認で、自分は済んでいて他の人を待っている
  const waiting = game.phase === 'roundEnd' && m.agent.ackId === null && members.some((x) => x.agent?.ackId !== null && x.agent?.ackId !== undefined);
  send(m.ws, {
    t: 'state',
    view: viewFor(game, m.seat),
    names,
    prompt: m.agent.prompt,
    ack: m.agent.ackId,
    ackTime: m.agent.ackTime,
    waiting,
    last: lastAction,
  });
}

function broadcastState() {
  for (const m of members) sendState(m);
}

function startGame(rules: Partial<Rules>, cpu: CpuLevel, time: TimeKey) {
  const humans = members.slice(0, MAX_HUMANS);
  // 席はランダム（偏りのない混ぜ方）
  const seats = new Rng(randomSeed()).shuffle([0, 1, 2, 3] as Seat[]);
  const agents: Agent[] = [];
  names = [];
  let cpuNo = 0;
  for (const m of members) {
    m.agent?.dispose();
    m.seat = undefined;
    m.agent = undefined;
  }
  humans.forEach((m, i) => {
    m.seat = seats[i];
    m.agent = new PromptAgent(TIME_CONTROLS[time]);
    m.agent.onChange = () => broadcastState();
  });
  for (let s = 0; s < 4; s++) {
    const m = humans.find((x) => x.seat === s);
    if (m) {
      agents.push(m.agent!);
      names.push(m.name);
    } else {
      agents.push(makeCpu(cpu));
      names.push(`CPU ${++cpuNo}`);
    }
  }
  lastAction = undefined;
  const r = new GameRunner({
    seed: randomSeed(),
    rules,
    agents,
    names,
    cpuDelay: CPU_DELAY,
    onUpdate: (_game, last) => {
      lastAction = last;
      broadcastState();
    },
  });
  runner = r;
  broadcastLobby();
  console.log(`対局開始: ${names.join(' / ')}`);
  r.run()
    .then((log) => {
      if (runner !== r) return;
      mkdirSync(LOG_DIR, { recursive: true });
      const file = join(LOG_DIR, `${log.startedAt.replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify(log));
      console.log(`対局終了。牌譜を保存しました: ${file}`);
      for (const m of members) send(m.ws, { t: 'log', log });
      broadcastState();
      runner = null;
      broadcastLobby();
    })
    .catch((e) => {
      console.error('対局中にエラー:', e);
      for (const m of members) send(m.ws, { t: 'error', message: `対局中にエラーが発生しました: ${e?.message ?? e}` });
      runner = null;
      broadcastLobby();
    });
}

function onMessage(ws: WebSocket, raw: string, self: { member?: Member }) {
  let msg: ClientMsg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.t === 'hello') {
    const name = String(msg.name ?? '').trim().slice(0, 16) || '名無し';
    const token = String(msg.token ?? '').slice(0, 64);
    let m = members.find((x) => x.token === token);
    if (m) {
      if (m.ws && m.ws !== ws) m.ws.close();
      m.ws = ws;
      m.name = name;
    } else {
      if (runner) {
        send(ws, { t: 'error', message: '対局中のため参加できません。終わるまでお待ちください。' });
        return;
      }
      if (members.length >= MAX_HUMANS) {
        send(ws, { t: 'error', message: '満席です（最大 4 人）。' });
        return;
      }
      m = { token, name, ws, host: !members.some((x) => x.host) };
      members.push(m);
      console.log(`参加: ${name}${m.host ? '（ホスト）' : ''}`);
    }
    self.member = m;
    broadcastLobby();
    sendState(m);
    return;
  }
  const m = self.member;
  if (!m) return;
  switch (msg.t) {
    case 'start':
      if (!m.host || runner) return;
      // 受け取るのは選べる設定だけ
      startGame(
        { length: msg.rules?.length === 'tonpuu' ? 'tonpuu' : 'hanchan', aka: msg.rules?.aka !== false },
        parseCpuLevel(msg.cpu),
        parseTimeKey(msg.time),
      );
      break;
    case 'action':
      m.agent?.answer(msg.id, msg.action);
      break;
    case 'ack':
      m.agent?.ack(msg.id);
      broadcastState();
      break;
  }
}

function onClose(ws: WebSocket, self: { member?: Member }) {
  const m = self.member;
  if (!m || m.ws !== ws) return;
  m.ws = null;
  if (!runner) {
    // 対局前なら部屋から外す（ホストは次の人に引き継ぐ）
    members.splice(members.indexOf(m), 1);
    if (m.host && members.length) members[0].host = true;
    console.log(`退出: ${m.name}`);
  }
  broadcastLobby();
}

// ───────────── 起動 ─────────────

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('画面がビルドされていません。先に `npm run build`（または `npm start`）を実行してください。');
  process.exit(1);
}

const server = createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  const self: { member?: Member } = {};
  ws.on('message', (data) => onMessage(ws, data.toString(), self));
  ws.on('close', () => onClose(ws, self));
});

server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  ポート ${PORT} はすでに使われています。`);
    console.error('  前に起動したサーバーが動いていないか確認し、そのターミナルで Ctrl+C を押して止めてください。');
    console.error(`  別のポートで起動するには：PORT=${PORT + 1} npm start`);
    console.error('');
    process.exit(1);
  }
  throw e;
});
// WebSocket 側にも同じエラーが届くので、ここでは何もしない（上で案内する）
wss.on('error', () => {});

server.listen(PORT, '0.0.0.0', () => {
  const addrs = lanAddresses();
  console.log('');
  console.log('  margin 麻雀 LAN サーバーを起動しました');
  console.log('');
  console.log(`  このPC:        http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  同じWi-Fiの人: http://${a}:${PORT}`);
  console.log('');
  console.log('  終了するには Ctrl+C');
  console.log('');
});
