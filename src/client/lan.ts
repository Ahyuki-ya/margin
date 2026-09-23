// LAN 対戦のブラウザ側。ホストのサーバーと WebSocket でつながる。

import type { GameLog } from '../engine/log.ts';
import type { ClientMsg, CpuLevel, LobbyMember, ServerMsg } from '../net/protocol.ts';
import { announceText } from './announce.ts';
import { downloadLog } from './local.ts';
import { TableUI } from './table.ts';

const TOKEN_KEY = 'margin.lan.token';
const NAME_KEY = 'margin.lan.name';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 保存できない環境では無視
  }
}

/** 再接続で同じ席に戻るための合言葉（ブラウザごと） */
function getToken(): string {
  let t = storageGet(TOKEN_KEY);
  if (!t) {
    t = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    storageSet(TOKEN_KEY, t);
  }
  return t;
}

export function savedName(): string {
  return storageGet(NAME_KEY) ?? '';
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function startLan(root: HTMLElement, name: string, onExit: () => void) {
  storageSet(NAME_KEY, name);
  const token = getToken();
  let ws: WebSocket | null = null;
  let table: TableUI | null = null;
  let lastLog: GameLog | null = null;
  let closedByUser = false;
  let lobby: { members: LobbyMember[]; host: boolean; running: boolean } | null = null;
  /** 終局画面を閉じてロビーに戻ったか */
  let inLobby = true;
  let lastAnnounced: string | null = null;
  let gameOver = false;
  /** 他の人に伝えるアドレス（サーバーが教えてくれる LAN の IP） */
  let joinUrls: string[] = [];
  fetch('api/info', { cache: 'no-store' })
    .then((r) => r.json())
    .then((info) => {
      joinUrls = Array.isArray(info?.urls) ? info.urls.map(String) : [];
      if (inLobby) renderLobby();
    })
    .catch(() => {});

  const sendMsg = (m: ClientMsg) => {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  };

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => sendMsg({ t: 'hello', token, name });
    ws.onmessage = (e) => onMessage(JSON.parse(e.data) as ServerMsg);
    ws.onclose = () => {
      if (closedByUser) return;
      showStatus('ホストとの接続が切れました。再接続しています…');
      setTimeout(connect, 2000);
    };
  };

  const leave = () => {
    closedByUser = true;
    ws?.close();
    table?.destroy();
    table = null;
    onExit();
  };

  const showStatus = (msg: string) => {
    let el = document.querySelector<HTMLElement>('.status-toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'status-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout((el as unknown as { _t?: number })._t);
    (el as unknown as { _t?: number })._t = window.setTimeout(() => el!.classList.remove('show'), 3000);
  };

  const renderLobby = () => {
    if (!lobby) return;
    table?.destroy();
    table = null;
    const rows = lobby.members
      .map(
        (m) =>
          `<li>${escapeHtml(m.name)}${m.host ? ' <span class="badge">ホスト</span>' : ''}${m.you ? ' <span class="badge you">あなた</span>' : ''}${m.online ? '' : ' <span class="badge off">切断中</span>'}</li>`,
      )
      .join('');
    const empty = 4 - lobby.members.length;
    const hostControls = lobby.host
      ? `
        <div class="form-row"><span>対局</span>
          <label><input type="radio" name="len" value="hanchan" checked> 半荘戦</label>
          <label><input type="radio" name="len" value="tonpuu"> 東風戦</label></div>
        <div class="form-row"><span>赤ドラ</span>
          <label><input type="radio" name="aka" value="1" checked> あり</label>
          <label><input type="radio" name="aka" value="0"> なし</label></div>
        <div class="form-row"><span>CPU</span>
          <label><input type="radio" name="cpu" value="random" checked> よわい（ランダム）</label>
          <label><input type="radio" name="cpu" value="greedy"> ふつう</label></div>
        <button class="btn big" data-lobby="start" ${lobby.running ? 'disabled' : ''}>対局開始</button>`
      : `<p class="note">${lobby.running ? '対局中です。' : 'ホストが対局を始めるのを待っています…'}</p>`;
    root.innerHTML = `
      <div class="screen">
        <div class="card">
          <h1>LAN 対戦</h1>
          <p class="note">同じ Wi-Fi の人は、次のアドレスをブラウザで開けば参加できます。</p>
          ${(joinUrls.length ? joinUrls : [location.origin]).map((u) => `<p class="addr">${escapeHtml(u)}</p>`).join('')}
          <h3>参加者（${lobby.members.length} / 4）</h3>
          <ul class="members">${rows}</ul>
          ${empty > 0 ? `<p class="note">空いている ${empty} 席は CPU が入ります。</p>` : ''}
          ${hostControls}
          <button class="btn ghost" data-lobby="leave">タイトルへ</button>
        </div>
      </div>`;
    root.querySelector('[data-lobby="start"]')?.addEventListener('click', () => {
      const len = (root.querySelector('input[name="len"]:checked') as HTMLInputElement).value as 'hanchan' | 'tonpuu';
      const aka = (root.querySelector('input[name="aka"]:checked') as HTMLInputElement).value === '1';
      const cpu = (root.querySelector('input[name="cpu"]:checked') as HTMLInputElement).value as CpuLevel;
      sendMsg({ t: 'start', rules: { length: len, aka }, cpu });
    });
    root.querySelector('[data-lobby="leave"]')?.addEventListener('click', leave);
  };

  const onMessage = (msg: ServerMsg) => {
    switch (msg.t) {
      case 'lobby':
        lobby = { members: msg.members, host: msg.host, running: msg.running };
        if (inLobby || !table) renderLobby();
        break;
      case 'state': {
        if (!table) {
          inLobby = false;
          lastAnnounced = null;
          table = new TableUI(root, {
            onAction: (id, action) => sendMsg({ t: 'action', id, action }),
            onAck: (id) => sendMsg({ t: 'ack', id }),
            onExit: () => {
              if (gameOver || !lobby?.running) {
                inLobby = true;
                renderLobby();
              } else {
                leave();
              }
            },
            onSaveLog: () => lastLog && downloadLog(lastLog),
          });
        }
        gameOver = msg.view.phase === 'gameEnd';
        table.render({ view: msg.view, names: msg.names, prompt: msg.prompt, ack: msg.ack, waiting: msg.waiting });
        if (msg.last) {
          const key = JSON.stringify(msg.last) + msg.view.players.map((p) => p.discards.length).join();
          const text = announceText(msg.last.action);
          if (text && key !== lastAnnounced) table.announce(msg.last.seat, text);
          lastAnnounced = key;
        }
        break;
      }
      case 'log':
        lastLog = msg.log;
        break;
      case 'error':
        showStatus(msg.message);
        break;
    }
  };

  root.innerHTML = '<div class="screen"><div class="card"><p>ホストに接続しています…</p></div></div>';
  connect();
}
