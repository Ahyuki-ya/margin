// 卓の描画と操作。CPU 対戦でも LAN 対戦でも同じものを使う。
// 状態（TableState）を受け取って丸ごと描き直すだけで、ゲームの進行は持たない。

import { compareTiles, kindName, kindOf, WIND_NAMES, type Tile } from '../engine/tile.ts';
import type { Action, DrawReason, Meld, RoundResult, Seat } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import { tileSvg } from './tiles.ts';

import type { Prompt } from '../ai/prompt.ts';
export type { Prompt };

export interface TableState {
  view: PlayerView;
  names: string[];
  prompt: Prompt | null;
  /** 局の結果の確認待ち（番号） */
  ack: number | null;
  /** 確認済みで他のプレイヤーを待っている */
  waiting?: boolean;
}

export interface TableHandlers {
  onAction(promptId: number, action: Action): void;
  onAck(ackId: number): void;
  onExit(): void;
  /** 牌譜の保存（終局後） */
  onSaveLog?(): void;
}

interface Settings {
  autoWin: boolean;
  noCall: boolean;
}

const SETTINGS_KEY = 'margin.settings';

function loadSettings(): Settings {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}');
    return { autoWin: !!s.autoWin, noCall: !!s.noCall };
  } catch {
    return { autoWin: false, noCall: false };
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境では無視
  }
}

const DRAW_NAMES: Record<DrawReason, string> = {
  exhaustive: '流局',
  kyuushu: '九種九牌',
  suufon: '四風連打',
  suucha: '四家立直',
  suukaikan: '四開槓',
  sanchahou: '三家和',
};

const ACTION_LABEL: Record<string, string> = {
  tsumo: 'ツモ',
  ron: 'ロン',
  pon: 'ポン',
  chi: 'チー',
  minkan: 'カン',
  ankan: 'カン',
  kakan: 'カン',
  kyuushu: '九種九牌',
  pass: 'スキップ',
};

export function roundLabel(v: PlayerView): string {
  return `${WIND_NAMES[v.roundWind]}${v.kyoku + 1}局`;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export class TableUI {
  private root: HTMLElement;
  private handlers: TableHandlers;
  private state: TableState | null = null;
  private settings = loadSettings();
  private riichiMode = false;
  /** 複数の選び方がある鳴き・槓の選択中 */
  private choosing: Action['type'] | null = null;
  private answeredPrompt = -1;
  private answeredAck = -1;
  /** タッチ操作では 1 回目のタップで選び、2 回目で捨てる（誤操作防止） */
  private selectedTile: Tile | null = null;
  private readonly twoTap = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  private elTop: HTMLElement;
  private elBoard: HTMLElement;
  private elAnn: HTMLElement;
  private elActions: HTMLElement;
  private elHand: HTMLElement;
  private elModal: HTMLElement;

  constructor(root: HTMLElement, handlers: TableHandlers) {
    this.root = root;
    this.handlers = handlers;
    root.innerHTML = `
      <div class="game">
        <div class="topbar"></div>
        <div class="board-wrap"><div class="board"><div class="board-content"></div><div class="ann-layer"></div></div></div>
        <div class="actions"></div>
        <div class="myhand"></div>
        <div class="modal hidden"></div>
      </div>`;
    this.elTop = root.querySelector('.topbar')!;
    this.elBoard = root.querySelector('.board-content')!;
    this.elAnn = root.querySelector('.ann-layer')!;
    this.elActions = root.querySelector('.actions')!;
    this.elHand = root.querySelector('.myhand')!;
    this.elModal = root.querySelector('.modal')!;
    root.addEventListener('click', (e) => this.onClick(e));
  }

  destroy() {
    this.root.innerHTML = '';
  }

  // ───────────── 描画 ─────────────

  render(state: TableState) {
    const prev = this.state;
    this.state = state;
    if (!state.prompt || state.prompt.id !== prev?.prompt?.id) {
      this.riichiMode = false;
      this.choosing = null;
      this.selectedTile = null;
    }
    this.autoRespond();
    this.renderTop();
    this.renderBoard();
    this.renderActions();
    this.renderHand();
    this.renderModal();
  }

  /** 設定に応じて自動で答える（自動和了・鳴きなし） */
  private autoRespond() {
    const p = this.state?.prompt;
    if (!p || p.id === this.answeredPrompt) return;
    const win = p.legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
    if (this.settings.autoWin && win) {
      this.send(win);
      return;
    }
    const onlyCalls = p.legal.every((a) => ['pon', 'chi', 'minkan', 'pass'].includes(a.type));
    if (this.settings.noCall && onlyCalls) this.send({ type: 'pass' });
  }

  private rel(seat: number): number {
    return (seat - this.state!.view.seat + 4) % 4;
  }

  private renderTop() {
    const v = this.state!.view;
    this.elTop.innerHTML = `
      <button class="btn-small" data-cmd="exit" title="タイトルへ戻る">≡</button>
      <span class="round">${roundLabel(v)} ${v.honba}本場</span>
      <span class="chip">供託 ${v.riichiSticks}</span>
      <span class="spacer"></span>
      <label class="toggle"><input type="checkbox" data-setting="autoWin" ${this.settings.autoWin ? 'checked' : ''}>自動和了</label>
      <label class="toggle"><input type="checkbox" data-setting="noCall" ${this.settings.noCall ? 'checked' : ''}>鳴きなし</label>`;
  }

  private renderBoard() {
    const { view: v, names } = this.state!;
    const aka = v.rules.aka;
    const pend = v.pendingTile;
    let html = '';
    for (let seat = 0; seat < 4; seat++) {
      const p = v.players[seat];
      const r = this.rel(seat);
      const lastIdx = pend && pend.from === seat && !pend.kan ? p.discards.length - 1 : -1;
      const river = p.discards
        .map((d, i) => {
          if (d.calledBy !== undefined) return '';
          const cls = ['tile', d.riichi ? 'yoko' : '', d.tsumogiri ? 'tsumogiri' : '', i === lastIdx ? 'last' : ''].join(' ');
          return `<div class="${cls}">${tileSvg(d.tile, aka, d.riichi)}</div>`;
        })
        .join('');
      const edge =
        r === 0
          ? ''
          : `<div class="edge">
              <div class="backs">${'<div class="tile back"></div>'.repeat(p.handCount)}</div>
              <div class="melds">${p.melds.map((m) => this.meldHtml(m, seat, aka)).join('')}</div>
            </div>`;
      const isTurn = (v.phase === 'turn' && v.current === seat) || (pend && pend.from === seat);
      const wind = WIND_NAMES[p.seatWind - 27];
      html += `
        <div class="side rel-${r}">
          <div class="river">${river}</div>
          ${edge}
          ${p.riichi ? '<div class="stick"></div>' : ''}
          <div class="seatinfo ${isTurn ? 'active' : ''} ${seat === v.dealer ? 'dealer' : ''}">
            <div class="line1"><span class="wind">${wind}</span><span class="score">${p.score}</span></div>
            <div class="pname">${escapeHtml(names[seat] ?? '')}</div>
          </div>
        </div>`;
    }
    const dora = [0, 1, 2, 3, 4]
      .map((i) => (i < v.doraIndicators.length ? `<div class="tile">${tileSvg(v.doraIndicators[i], aka)}</div>` : '<div class="tile back"></div>'))
      .join('');
    html += `
      <div class="center">
        <div class="c-round">${roundLabel(v)}</div>
        <div class="c-sub">${v.honba}本場　供託${v.riichiSticks}</div>
        <div class="c-dora">${dora}</div>
        <div class="c-rest">残り ${v.liveRemaining}</div>
      </div>`;
    this.elBoard.innerHTML = html;
  }

  private meldHtml(m: Meld, owner: number, aka: boolean): string {
    // 鳴いた相手の方向の牌を横にする（上家=左、対面=中央、下家=右）
    const tiles = m.tiles.slice();
    if (m.type === 'ankan') {
      return `<div class="meld">${tiles
        .map((t, i) => (i === 0 || i === 3 ? '<div class="tile back"></div>' : `<div class="tile">${tileSvg(t, aka)}</div>`))
        .join('')}</div>`;
    }
    const called = m.calledTile!;
    const rest = tiles.filter((t) => t !== called).sort(compareTiles);
    const dir = (m.from! - owner + 4) % 4; // 1: 下家, 2: 対面, 3: 上家
    let order: { t: Tile; yoko: boolean }[] = rest.map((t) => ({ t, yoko: false }));
    const pos = dir === 3 ? 0 : dir === 2 ? 1 : order.length;
    order.splice(pos, 0, { t: called, yoko: true });
    if (m.type === 'kakan') {
      // 加槓の牌は横向きの牌に重ねる代わりに、隣に横向きで並べる
      const added = order.pop()!;
      order.splice(pos + 1, 0, { t: added.t, yoko: true });
    }
    return `<div class="meld">${order.map((o) => `<div class="tile ${o.yoko ? 'yoko' : ''}">${tileSvg(o.t, aka, o.yoko)}</div>`).join('')}</div>`;
  }

  private renderActions() {
    const p = this.state!.prompt;
    if (!p || p.id === this.answeredPrompt) {
      this.elActions.innerHTML = '';
      return;
    }
    const legal = p.legal;
    const aka = this.state!.view.rules.aka;
    const buttons: string[] = [];
    if (this.choosing) {
      const opts = legal.map((a, i) => ({ a, i })).filter(({ a }) => sameGroup(a.type, this.choosing!));
      for (const { a, i } of opts) {
        buttons.push(`<button class="btn choice" data-act="${i}">${ACTION_LABEL[a.type]} ${this.actionTiles(a, aka)}</button>`);
      }
      buttons.push(`<button class="btn ghost" data-cmd="cancel">戻る</button>`);
      this.elActions.innerHTML = buttons.join('');
      return;
    }
    const groups = new Map<string, number[]>();
    legal.forEach((a, i) => {
      if (a.type === 'discard') return;
      const g = groupOf(a.type);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push(i);
    });
    const order = ['tsumo', 'ron', 'kan', 'pon', 'chi', 'kyuushu', 'pass'];
    for (const g of order) {
      const idx = groups.get(g);
      if (!idx) continue;
      const cls = g === 'tsumo' || g === 'ron' ? 'btn win' : g === 'pass' ? 'btn ghost' : 'btn';
      const label = ACTION_LABEL[legal[idx[0]].type];
      if (idx.length === 1) buttons.push(`<button class="${cls}" data-act="${idx[0]}">${label}</button>`);
      else buttons.push(`<button class="${cls}" data-choose="${legal[idx[0]].type}">${label}</button>`);
    }
    if (legal.some((a) => a.type === 'discard' && a.riichi)) {
      buttons.splice(
        buttons.length - (groups.has('pass') ? 1 : 0),
        0,
        `<button class="btn riichi ${this.riichiMode ? 'on' : ''}" data-cmd="riichi">${this.riichiMode ? 'リーチ取消' : 'リーチ'}</button>`,
      );
    }
    this.elActions.innerHTML = buttons.join('');
  }

  private actionTiles(a: Action, aka: boolean): string {
    let tiles: Tile[] = [];
    if (a.type === 'pon' || a.type === 'chi') tiles = [...a.tiles];
    else if (a.type === 'kakan') tiles = [a.tile];
    else if (a.type === 'ankan') return `<span class="mini-label">${kindName(a.kind)}</span>`;
    return `<span class="mini">${tiles.map((t) => `<span class="tile">${tileSvg(t, aka)}</span>`).join('')}</span>`;
  }

  private renderHand() {
    const { view: v, prompt } = this.state!;
    const me = v.players[v.seat];
    const aka = v.rules.aka;
    const hand = (me.hand ?? []).slice();
    const drawn = v.drawnTile;
    const rest = drawn !== undefined ? removeOnce(hand, drawn) : hand;
    rest.sort(compareTiles);
    const active = prompt && prompt.id !== this.answeredPrompt ? prompt.legal : [];
    const discardable = new Set<Tile>();
    for (const a of active) {
      if (a.type === 'discard' && !!a.riichi === this.riichiMode) discardable.add(a.tile);
    }
    const tileBtn = (t: Tile, extra = '') => {
      const ok = discardable.has(t);
      const dim = discardable.size > 0 && !ok;
      const sel = ok && this.selectedTile === t;
      return `<button class="tile hand-tile ${extra} ${ok ? 'can' : ''} ${dim ? 'dim' : ''} ${sel ? 'sel' : ''}" ${ok ? `data-discard="${t}"` : 'tabindex="-1"'} aria-label="${kindName(kindOf(t))}">${tileSvg(t, aka)}</button>`;
    };
    const handHtml = rest.map((t) => tileBtn(t)).join('') + (drawn !== undefined ? `<span class="gap"></span>${tileBtn(drawn, 'drawn')}` : '');
    const melds = me.melds.map((m) => this.meldHtml(m, v.seat, aka)).join('');
    this.elHand.innerHTML = `<div class="hand-row">${handHtml}</div><div class="my-melds">${melds}</div>`;
  }

  private renderModal() {
    const { view: v, names, ack, waiting } = this.state!;
    const aka = v.rules.aka;
    if (v.phase === 'gameEnd' && v.standings) {
      const rows = v.standings
        .map(
          (s) => `<tr class="${s.seat === v.seat ? 'me' : ''}"><td>${s.rank}位</td><td>${escapeHtml(names[s.seat])}</td><td class="num">${s.score}</td><td class="num">${s.points > 0 ? '+' : ''}${s.points.toFixed(1)}</td></tr>`,
        )
        .join('');
      this.showModal(`
        <h2>終局</h2>
        <table class="standings"><thead><tr><th>順位</th><th>名前</th><th>持ち点</th><th>ポイント</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="modal-buttons">
          ${this.handlers.onSaveLog ? '<button class="btn ghost" data-cmd="savelog">牌譜を保存</button>' : ''}
          <button class="btn" data-cmd="exit">タイトルへ</button>
        </div>`);
      return;
    }
    if (v.phase !== 'roundEnd' || !v.result) {
      this.hideModal();
      return;
    }
    const body = resultHtml(v, v.result, names, aka);
    const acked = ack === null || ack === this.answeredAck;
    const btn = acked
      ? `<div class="waiting">${waiting ? '他のプレイヤーを待っています…' : ''}</div>`
      : `<button class="btn" data-cmd="ack">次へ</button>`;
    this.showModal(`${body}<div class="modal-buttons">${btn}</div>`);
  }

  private showModal(html: string) {
    this.elModal.innerHTML = `<div class="modal-card">${html}</div>`;
    this.elModal.classList.remove('hidden');
  }

  private hideModal() {
    this.elModal.classList.add('hidden');
    this.elModal.innerHTML = '';
  }

  /** 「ポン」「リーチ」などの吹き出し */
  announce(seat: Seat, text: string) {
    if (!this.state) return;
    const el = document.createElement('div');
    el.className = `ann rel-${this.rel(seat)}`;
    el.textContent = text;
    this.elAnn.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  // ───────────── 操作 ─────────────

  private send(a: Action) {
    const p = this.state?.prompt;
    if (!p || p.id === this.answeredPrompt) return;
    this.answeredPrompt = p.id;
    this.riichiMode = false;
    this.choosing = null;
    this.handlers.onAction(p.id, a);
  }

  private onClick(e: Event) {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-discard],[data-cmd],[data-choose],[data-setting]');
    if (!target || !this.state) return;
    const legal = this.state.prompt?.legal ?? [];
    if (target.dataset.setting) {
      const key = target.dataset.setting as keyof Settings;
      this.settings[key] = (target as HTMLInputElement).checked;
      saveSettings(this.settings);
      this.render(this.state);
      return;
    }
    if (target.dataset.act !== undefined) {
      this.send(legal[Number(target.dataset.act)]);
      this.render(this.state);
      return;
    }
    if (target.dataset.discard !== undefined) {
      const t = Number(target.dataset.discard);
      const a = legal.find((x) => x.type === 'discard' && x.tile === t && !!x.riichi === this.riichiMode);
      if (!a) return;
      if (this.twoTap && this.selectedTile !== t) {
        this.selectedTile = t;
        this.renderHand();
        return;
      }
      this.selectedTile = null;
      this.send(a);
      this.render(this.state);
      return;
    }
    if (target.dataset.choose) {
      this.choosing = target.dataset.choose as Action['type'];
      this.renderActions();
      return;
    }
    switch (target.dataset.cmd) {
      case 'riichi':
        this.riichiMode = !this.riichiMode;
        this.selectedTile = null;
        this.renderActions();
        this.renderHand();
        break;
      case 'cancel':
        this.choosing = null;
        this.renderActions();
        break;
      case 'ack':
        if (this.state.ack !== null) {
          this.answeredAck = this.state.ack;
          this.handlers.onAck(this.state.ack);
          this.renderModal();
        }
        break;
      case 'savelog':
        this.handlers.onSaveLog?.();
        break;
      case 'exit':
        if (this.state.view.phase === 'gameEnd' || confirm('対局をやめてタイトルに戻りますか？')) this.handlers.onExit();
        break;
    }
  }
}

function groupOf(t: Action['type']): string {
  return t === 'ankan' || t === 'kakan' || t === 'minkan' ? 'kan' : t;
}

function sameGroup(a: Action['type'], b: Action['type']): boolean {
  return groupOf(a) === groupOf(b);
}

function removeOnce(tiles: Tile[], t: Tile): Tile[] {
  const i = tiles.indexOf(t);
  if (i < 0) return tiles;
  return [...tiles.slice(0, i), ...tiles.slice(i + 1)];
}

function tilesRow(tiles: Tile[], aka: boolean, cls = ''): string {
  return `<div class="tiles-row ${cls}">${tiles.map((t) => `<div class="tile">${tileSvg(t, aka)}</div>`).join('')}</div>`;
}

function deltasHtml(v: PlayerView, deltas: number[], names: string[]): string {
  const rows = [0, 1, 2, 3]
    .map((s) => {
      const d = deltas[s];
      const cls = d > 0 ? 'plus' : d < 0 ? 'minus' : '';
      return `<tr class="${s === v.seat ? 'me' : ''}"><td>${WIND_NAMES[v.players[s].seatWind - 27]}</td><td>${escapeHtml(names[s])}</td><td class="num">${v.players[s].score - d}</td><td class="num ${cls}">${d > 0 ? '+' : ''}${d || ''}</td><td class="num">${v.players[s].score}</td></tr>`;
    })
    .join('');
  return `<table class="deltas"><tbody>${rows}</tbody></table>`;
}

export function resultHtml(v: PlayerView, res: RoundResult, names: string[], aka: boolean): string {
  if (res.type === 'draw') {
    let body = `<h2>${DRAW_NAMES[res.reason]}</h2>`;
    if (res.reason === 'exhaustive') {
      body += `<div class="tenpai-list">${[0, 1, 2, 3]
        .map((s) => `<span class="${res.tenpai[s] ? 'tenpai' : 'noten'}">${escapeHtml(names[s])}：${res.tenpai[s] ? '聴牌' : 'ノーテン'}${res.nagashi.includes(s as Seat) ? '（流し満貫）' : ''}</span>`)
        .join('')}</div>`;
      for (let s = 0; s < 4; s++) {
        const h = res.hands[s];
        if (h) body += `<div class="reveal"><span class="who">${escapeHtml(names[s])}</span>${tilesRow([...h].sort(compareTiles), aka, 'small')}</div>`;
      }
    }
    return body + deltasHtml(v, res.deltas, names);
  }
  let body = '';
  for (const w of res.wins) {
    const how = w.from === undefined ? 'ツモ' : `ロン（${escapeHtml(names[w.from])}から）`;
    const sc = w.score;
    const pointText = sc.yakuman
      ? sc.limitName
      : `${sc.fu}符 ${sc.han}翻${sc.limitName ? ` ${sc.limitName}` : ''}`;
    const yaku = sc.yaku
      .map((y) => `<li><span>${y.name}</span><span>${y.yakuman ? (y.yakuman > 1 ? `${y.yakuman}倍役満` : '役満') : `${y.han}翻`}</span></li>`)
      .join('');
    const handTiles = [...w.hand].sort(compareTiles);
    const melds = w.melds.map((m) => tilesRow(m.tiles, aka, 'small meld-row')).join('');
    body += `
      <div class="win-block">
        <h2>${escapeHtml(names[w.seat])} ${how}</h2>
        <div class="win-hand">${tilesRow(handTiles, aka, 'small')}<span class="gap"></span>${tilesRow([w.winTile], aka, 'small win-tile')}${melds}</div>
        <div class="dora-line">ドラ表示 ${tilesRow(v.doraIndicators, aka, 'tiny')}${w.uraIndicators.length ? ` 裏 ${tilesRow(w.uraIndicators, aka, 'tiny')}` : ''}</div>
        <ul class="yaku">${yaku}</ul>
        <div class="points">${pointText}　<strong>${w.gain}点</strong>${w.pao !== undefined ? `（包：${escapeHtml(names[w.pao])}）` : ''}</div>
      </div>`;
  }
  return body + deltasHtml(v, res.deltas, names);
}
