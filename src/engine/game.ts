// 対局の進行を管理するステートマシン
//
// 使い方:
//   const g = new Game({ seed, rules });
//   while (!g.isOver()) {
//     if (g.phase === 'roundEnd') { g.nextRound(); continue; }
//     for (const seat of g.pendingSeats()) g.apply(seat, choose(g.legalActions(seat)));
//   }
//
// 画面に何も依存しないので、ブラウザでも Node（LAN サーバー・自己対戦）でも同じように動く。
// 乱数は種から決まるので、seed と apply した行動の列（牌譜）があれば対局を完全に再現できる。

import { countYaochuKinds, isAgari, isTenpai, toCounts, waitingKinds, type Counts } from './hand.ts';
import { Rng } from './rng.ts';
import { withDefaults, type Rules } from './rules.ts';
import { evaluateWin, payments, type WinContext } from './score.ts';
import {
  compareTiles,
  EAST,
  isDragon,
  isRedTile,
  isWind,
  isYaochu,
  kindOf,
  NUM_TILES,
  suitOf,
  numOf,
  type Kind,
  type Tile,
} from './tile.ts';
import type {
  AbortReason,
  Action,
  DiscardInfo,
  FinalStanding,
  Meld,
  RoundResult,
  ScoreResult,
  Seat,
  WinInfo,
} from './types.ts';

export type Phase = 'turn' | 'response' | 'chankan' | 'roundEnd' | 'gameEnd';

export interface PlayerState {
  hand: Tile[];
  melds: Meld[];
  discards: DiscardInfo[];
  score: number;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  /** 同巡内・リーチ後の見逃しによるフリテン */
  tempFuriten: boolean;
  riichiFuriten: boolean;
  /** 流し満貫の条件を満たしているか */
  nagashi: boolean;
  /** 喰い替えで捨てられない種類 */
  kuikae: Kind[];
  /** 包（パオ）: 役満を確定させた鳴きをさせた相手 */
  pao?: { seat: Seat; yaku: string };
}

/** 捨て牌・槓に対する他家の応答待ち */
interface PendingResponse {
  tile: Tile;
  from: Seat;
  /** 各席の選べる行動 */
  options: Map<Seat, Action[]>;
  responses: Map<Seat, Action>;
  /** 槍槓（加槓・暗槓）への応答か */
  kan?: { type: 'kakan' | 'ankan' };
}

export interface GameOptions {
  seed: number;
  rules?: Partial<Rules>;
}

const LIVE_WALL_END = 122; // 136 - 王牌 14 枚
const DORA_BASE = 122;
const URA_BASE = 127;
const RINSHAN_BASE = 132;

export class Game {
  readonly rules: Rules;
  readonly seed: number;
  private rng: Rng;

  players: PlayerState[];
  /** 0: 東場, 1: 南場, 2: 西場, 3: 北場 */
  roundWind = 0;
  /** 局（0..3）。親の席と同じ */
  kyoku = 0;
  honba = 0;
  riichiSticks = 0;
  phase: Phase = 'turn';

  wall: Tile[] = [];
  private livePtr = 0;
  kanCount = 0;
  /** めくられたドラ表示牌の数 */
  doraCount = 1;
  /** 明槓・加槓の後、打牌時にめくるドラの数 */
  private pendingDora = 0;
  /** 誰が槓したか（四開槓の判定用） */
  private kanBy: Seat[] = [];

  current: Seat = 0;
  /** 直前にツモった牌（鳴いた直後は undefined） */
  drawnTile: Tile | undefined;
  /** 嶺上牌をツモった直後か */
  private rinshanDraw = false;
  /** 鳴いた直後の打牌待ちか */
  private afterCall = false;
  /** 第一巡で、まだ誰も鳴いていないか（ダブルリーチ・天和・地和・九種九牌・四風連打） */
  private firstGoAround = true;
  /** 他家の応答待ち */
  private pending: PendingResponse | undefined;
  /** リーチ宣言中（宣言牌が通れば成立） */
  private riichiDeclaring: Seat | undefined;

  result: RoundResult | undefined;
  standings: FinalStanding[] | undefined;
  /** 開始した局の数 */
  roundCount = 0;

  constructor(opts: GameOptions) {
    this.rules = withDefaults(opts.rules);
    this.seed = opts.seed >>> 0;
    this.rng = new Rng(this.seed);
    this.players = [0, 1, 2, 3].map(() => this.emptyPlayer(this.rules.startPoints));
    this.startRound();
  }

  private emptyPlayer(score: number): PlayerState {
    return {
      hand: [],
      melds: [],
      discards: [],
      score,
      riichi: false,
      doubleRiichi: false,
      ippatsu: false,
      tempFuriten: false,
      riichiFuriten: false,
      nagashi: true,
      kuikae: [],
    };
  }

  // ───────────── 基本情報 ─────────────

  get dealer(): Seat {
    return this.kyoku as Seat;
  }

  seatWind(seat: Seat): Kind {
    return EAST + ((seat - this.dealer + 4) % 4);
  }

  get roundWindKind(): Kind {
    return EAST + this.roundWind;
  }

  /** 残りのツモ牌（王牌を除く） */
  get liveRemaining(): number {
    return LIVE_WALL_END - this.kanCount - this.livePtr;
  }

  get doraIndicators(): Tile[] {
    return this.wall.slice(DORA_BASE, DORA_BASE + this.doraCount);
  }

  get uraIndicators(): Tile[] {
    return this.wall.slice(URA_BASE, URA_BASE + this.doraCount);
  }

  /** 応答待ちの対象になっている牌（捨て牌・槓の牌） */
  get pendingTile(): { tile: Tile; from: Seat; kan: boolean } | undefined {
    if (!this.pending) return undefined;
    return { tile: this.pending.tile, from: this.pending.from, kan: !!this.pending.kan };
  }

  isOver(): boolean {
    return this.phase === 'gameEnd';
  }

  // ───────────── 局の開始 ─────────────

  private startRound() {
    this.roundCount++;
    this.wall = this.rng.shuffle(Array.from({ length: NUM_TILES }, (_, i) => i));
    this.livePtr = 0;
    this.kanCount = 0;
    this.doraCount = 1;
    this.pendingDora = 0;
    this.kanBy = [];
    this.firstGoAround = true;
    this.pending = undefined;
    this.riichiDeclaring = undefined;
    this.result = undefined;
    this.afterCall = false;
    this.rinshanDraw = false;
    this.players = this.players.map((p) => this.emptyPlayer(p.score));
    // 親から 4 枚ずつ 3 回、最後に 1 枚ずつ配る
    for (let r = 0; r < 3; r++) {
      for (let i = 0; i < 4; i++) {
        const seat = (this.dealer + i) % 4;
        for (let j = 0; j < 4; j++) this.players[seat].hand.push(this.wall[this.livePtr++]);
      }
    }
    for (let i = 0; i < 4; i++) {
      const seat = (this.dealer + i) % 4;
      this.players[seat].hand.push(this.wall[this.livePtr++]);
    }
    for (const p of this.players) p.hand.sort(compareTiles);
    this.phase = 'turn';
    this.current = this.dealer;
    this.draw(this.dealer, false);
  }

  private draw(seat: Seat, rinshan: boolean) {
    let tile: Tile;
    if (rinshan) {
      tile = this.wall[RINSHAN_BASE + this.kanCount - 1];
    } else {
      tile = this.wall[this.livePtr++];
    }
    const p = this.players[seat];
    p.hand.push(tile);
    this.drawnTile = tile;
    this.rinshanDraw = rinshan;
    this.afterCall = false;
    this.current = seat;
    this.phase = 'turn';
  }

  // ───────────── 行動の候補 ─────────────

  /** 行動を待っている席 */
  pendingSeats(): Seat[] {
    if (this.phase === 'turn') return [this.current];
    if (this.phase === 'response' || this.phase === 'chankan') {
      const pend = this.pending!;
      return [...pend.options.keys()].filter((s) => !pend.responses.has(s));
    }
    return [];
  }

  legalActions(seat: Seat): Action[] {
    if (this.phase === 'turn') return seat === this.current ? this.turnActions(seat) : [];
    if (this.phase === 'response' || this.phase === 'chankan') {
      const pend = this.pending!;
      if (pend.responses.has(seat)) return [];
      return pend.options.get(seat) ?? [];
    }
    return [];
  }

  private turnActions(seat: Seat): Action[] {
    const p = this.players[seat];
    const out: Action[] = [];
    if (this.afterCall) {
      for (const t of p.hand) {
        if (!p.kuikae.includes(kindOf(t))) out.push({ type: 'discard', tile: t });
      }
      return out;
    }
    const drawn = this.drawnTile!;
    // ツモ和了
    if (this.winScore(seat, drawn, true, false)) out.push({ type: 'tsumo' });
    // 九種九牌
    if (this.rules.abortiveDraws && this.firstGoAround && p.discards.length === 0 && countYaochuKinds(toCounts(p.hand)) >= 9) {
      out.push({ type: 'kyuushu' });
    }
    // 槓（合計 4 回まで、ツモ牌が残っているときだけ）
    if (this.kanCount < 4 && this.liveRemaining > 0) {
      const counts = toCounts(p.hand);
      for (let k = 0; k < 34; k++) {
        if (counts[k] === 4 && (!p.riichi || this.canAnkanInRiichi(seat, k))) {
          out.push({ type: 'ankan', kind: k });
        }
      }
      if (!p.riichi) {
        for (const m of p.melds) {
          if (m.type !== 'pon') continue;
          const t = p.hand.find((x) => kindOf(x) === kindOf(m.tiles[0]));
          if (t !== undefined) out.push({ type: 'kakan', tile: t });
        }
      }
    }
    // 打牌
    if (p.riichi) {
      out.push({ type: 'discard', tile: drawn });
      return out;
    }
    const menzen = p.melds.every((m) => m.type === 'ankan');
    const canRiichi = menzen && p.score >= 1000 && this.liveRemaining >= 4;
    // 同じ種類の牌も 1 枚ずつ別の行動として並べる（ツモ切りかどうかを区別するため）
    for (const t of p.hand) {
      out.push({ type: 'discard', tile: t });
    }
    if (canRiichi) {
      for (const t of p.hand) {
        const rest = removeOne(p.hand, t);
        if (isTenpai(toCounts(rest), p.melds.length > 0, this.usedCounts(rest, p.melds))) {
          out.push({ type: 'discard', tile: t, riichi: true });
        }
      }
    }
    return out;
  }

  private usedCounts(hand: Tile[], melds: Meld[]): Counts {
    return toCounts([...hand, ...melds.flatMap((m) => m.tiles)]);
  }

  /** リーチ後の暗槓：ツモ牌での槓で、待ちも面子構成も変わらない場合だけ許す */
  private canAnkanInRiichi(seat: Seat, kind: Kind): boolean {
    const p = this.players[seat];
    if (kindOf(this.drawnTile!) !== kind) return false;
    const before = removeOne(p.hand, this.drawnTile!);
    const c = toCounts(before);
    const waits = waitingKinds(c, true);
    const after = toCounts(p.hand.filter((t) => kindOf(t) !== kind));
    const waitsAfter = waitingKinds(after, true);
    if (waits.length !== waitsAfter.length || waits.some((w, i) => w !== waitsAfter[i])) return false;
    // すべての和了形でその牌が刻子として使われていること
    for (const w of waits) {
      c[w]++;
      c[kind] -= 3;
      const ok = isAgari(c, true);
      c[kind] += 3;
      c[w]--;
      if (!ok) return false;
    }
    return true;
  }

  // ───────────── 行動の適用 ─────────────

  apply(seat: Seat, action: Action) {
    if (this.phase === 'turn') {
      if (seat !== this.current) throw new Error(`席 ${seat} の手番ではありません`);
      this.assertLegal(seat, action);
      this.applyTurn(seat, action);
    } else if (this.phase === 'response' || this.phase === 'chankan') {
      const pend = this.pending!;
      if (!pend.options.has(seat) || pend.responses.has(seat)) throw new Error(`席 ${seat} は応答できません`);
      this.assertLegal(seat, action);
      pend.responses.set(seat, action);
      if (pend.responses.size === pend.options.size) this.resolveResponses();
    } else {
      throw new Error(`現在（${this.phase}）は行動できません`);
    }
  }

  private assertLegal(seat: Seat, action: Action) {
    const legal = this.legalActions(seat);
    if (!legal.some((a) => sameAction(a, action))) {
      throw new Error(`不正な行動: ${JSON.stringify(action)}`);
    }
  }

  private applyTurn(seat: Seat, action: Action) {
    const p = this.players[seat];
    switch (action.type) {
      case 'tsumo':
        this.settleWins([seat], undefined, this.drawnTile!, false);
        return;
      case 'kyuushu':
        this.abort('kyuushu');
        return;
      case 'ankan': {
        const tiles = p.hand.filter((t) => kindOf(t) === action.kind);
        p.hand = p.hand.filter((t) => kindOf(t) !== action.kind);
        p.melds.push({ type: 'ankan', tiles });
        this.onKan(seat);
        // 暗槓のドラは即めくり
        this.doraCount++;
        // 国士無双だけは暗槓を槍槓できる
        this.startChankan(seat, tiles[0], 'ankan');
        return;
      }
      case 'kakan': {
        const kind = kindOf(action.tile);
        const meld = p.melds.find((m) => m.type === 'pon' && kindOf(m.tiles[0]) === kind)!;
        meld.type = 'kakan';
        meld.tiles.push(action.tile);
        p.hand = removeOne(p.hand, action.tile);
        this.onKan(seat);
        this.pendingDora++;
        this.startChankan(seat, action.tile, 'kakan');
        return;
      }
      case 'discard':
        this.discard(seat, action.tile, !!action.riichi);
        return;
      default:
        throw new Error(`手番では選べない行動: ${action.type}`);
    }
  }

  private onKan(seat: Seat) {
    this.kanCount++;
    this.kanBy.push(seat);
    this.firstGoAround = false;
    for (const q of this.players) q.ippatsu = false;
  }

  private startChankan(seat: Seat, tile: Tile, type: 'kakan' | 'ankan') {
    const options = new Map<Seat, Action[]>();
    for (const other of otherSeats(seat)) {
      if (!this.canRon(other, tile)) continue;
      if (type === 'ankan' && !this.isKokushiWait(other)) continue;
      if (this.winScore(other, tile, false, true)) options.set(other, [{ type: 'ron' }, { type: 'pass' }]);
    }
    if (options.size === 0) {
      this.draw(seat, true);
      return;
    }
    this.pending = { tile, from: seat, options, responses: new Map(), kan: { type } };
    this.phase = 'chankan';
  }

  private isKokushiWait(seat: Seat): boolean {
    const p = this.players[seat];
    if (p.melds.length) return false;
    const c = toCounts(p.hand);
    return waitingKinds(c, false).every((k) => isYaochu(k)) && c.filter((n, k) => n > 0 && !isYaochu(k)).length === 0;
  }

  private discard(seat: Seat, tile: Tile, riichi: boolean) {
    const p = this.players[seat];
    const tsumogiri = tile === this.drawnTile && !this.afterCall;
    p.hand = removeOne(p.hand, tile);
    p.hand.sort(compareTiles);
    p.discards.push({ tile, tsumogiri, riichi });
    p.kuikae = [];
    p.tempFuriten = false;
    if (p.riichi) p.ippatsu = false;
    if (!isYaochu(kindOf(tile))) p.nagashi = false;
    if (riichi) {
      this.riichiDeclaring = seat;
      p.doubleRiichi = this.firstGoAround && p.discards.length === 1;
    }
    // 明槓・加槓のドラは打牌時にめくる
    this.doraCount += this.pendingDora;
    this.pendingDora = 0;
    this.drawnTile = undefined;
    this.rinshanDraw = false;
    this.afterCall = false;

    // 他家の応答（ロン・ポン・チー・大明槓）
    const options = new Map<Seat, Action[]>();
    const last = this.liveRemaining === 0;
    for (const other of otherSeats(seat)) {
      const acts: Action[] = [];
      if (this.canRon(other, tile) && this.winScore(other, tile, false, false)) acts.push({ type: 'ron' });
      const q = this.players[other];
      if (!last && !q.riichi) {
        const kind = kindOf(tile);
        const same = q.hand.filter((t) => kindOf(t) === kind);
        if (same.length >= 2) {
          for (const pair of pairChoices(same)) {
            if (this.hasDiscardAfterCall(other, pair, tile, 'pon')) acts.push({ type: 'pon', tiles: pair });
          }
        }
        if (same.length >= 3 && this.kanCount < 4) acts.push({ type: 'minkan' });
        if (other === (seat + 1) % 4) {
          for (const pair of this.chiChoices(other, tile)) acts.push({ type: 'chi', tiles: pair });
        }
      }
      if (acts.length) {
        acts.push({ type: 'pass' });
        options.set(other, acts);
      }
    }
    if (options.size === 0) {
      this.afterDiscardPassed(seat);
      return;
    }
    this.pending = { tile, from: seat, options, responses: new Map() };
    this.phase = 'response';
  }

  private chiChoices(seat: Seat, tile: Tile): [Tile, Tile][] {
    const k = kindOf(tile);
    if (k >= 27) return [];
    const n = numOf(k);
    const hand = this.players[seat].hand;
    const out: [Tile, Tile][] = [];
    const patterns: [number, number][] = [];
    if (n >= 3) patterns.push([-2, -1]);
    if (n >= 2 && n <= 8) patterns.push([-1, 1]);
    if (n <= 7) patterns.push([1, 2]);
    for (const [a, b] of patterns) {
      const as = uniqueTiles(hand.filter((t) => kindOf(t) === k + a));
      const bs = uniqueTiles(hand.filter((t) => kindOf(t) === k + b));
      for (const x of as) {
        for (const y of bs) {
          const pair: [Tile, Tile] = [x, y];
          if (this.hasDiscardAfterCall(seat, pair, tile, 'chi')) out.push(pair);
        }
      }
    }
    return out;
  }

  /** 喰い替えの禁止牌 */
  private kuikaeKinds(pair: [Tile, Tile], tile: Tile, type: 'chi' | 'pon'): Kind[] {
    const k = kindOf(tile);
    if (type === 'pon') return [k];
    const ks = [kindOf(pair[0]), kindOf(pair[1]), k].sort((a, b) => a - b);
    const out = [k];
    // 両面で鳴いたとき、反対側の筋も禁止
    if (k === ks[0] && numOf(ks[2]) <= 8 && suitOf(ks[2] + 1) === suitOf(k)) out.push(ks[2] + 1);
    if (k === ks[2] && numOf(ks[0]) >= 2) out.push(ks[0] - 1);
    return out;
  }

  private hasDiscardAfterCall(seat: Seat, pair: [Tile, Tile], tile: Tile, type: 'chi' | 'pon'): boolean {
    const forbidden = this.kuikaeKinds(pair, tile, type);
    const rest = removeOne(removeOne(this.players[seat].hand, pair[0]), pair[1]);
    return rest.some((t) => !forbidden.includes(kindOf(t)));
  }

  /** フリテンでないか（形・役は別に判定） */
  private canRon(seat: Seat, tile: Tile): boolean {
    const p = this.players[seat];
    const c = toCounts(p.hand);
    const waits = waitingKinds(c, p.melds.length > 0);
    if (!waits.includes(kindOf(tile))) return false;
    if (p.tempFuriten || p.riichiFuriten) return false;
    if (p.discards.some((d) => waits.includes(kindOf(d.tile)))) return false;
    return true;
  }

  /** 和了したときの点数（役がなければ null） */
  private winScore(seat: Seat, tile: Tile, tsumo: boolean, chankan: boolean): ScoreResult | null {
    const p = this.players[seat];
    const hand = tsumo ? p.hand : [...p.hand, tile];
    if (!isAgari(toCounts(hand), p.melds.length > 0)) return null;
    const noDiscardsYet = this.firstGoAround && p.discards.length === 0;
    const ctx: WinContext = {
      hand,
      melds: p.melds,
      winTile: tile,
      tsumo,
      seatWind: this.seatWind(seat),
      roundWind: this.roundWindKind,
      riichi: p.riichi,
      doubleRiichi: p.doubleRiichi,
      ippatsu: p.riichi && p.ippatsu,
      haitei: tsumo && !this.rinshanDraw && this.liveRemaining === 0,
      houtei: !tsumo && !chankan && this.liveRemaining === 0,
      rinshan: tsumo && this.rinshanDraw,
      chankan,
      tenhou: tsumo && noDiscardsYet && seat === this.dealer,
      chiihou: tsumo && noDiscardsYet && seat !== this.dealer && !this.rinshanDraw,
      doraIndicators: this.doraIndicators,
      uraIndicators: p.riichi ? this.uraIndicators : [],
      aka: this.rules.aka,
      kuitan: this.rules.kuitan,
      yakumanCompound: this.rules.yakumanCompound,
    };
    return evaluateWin(ctx);
  }

  private resolveResponses() {
    const pend = this.pending!;
    this.pending = undefined;
    const from = pend.from;
    const order = otherSeats(from); // 下家から順（頭ハネの優先順）
    const rons = order.filter((s) => pend.responses.get(s)?.type === 'ron');

    // ロンの権利を見逃した人はフリテン
    for (const [s, acts] of pend.options) {
      if (acts.some((a) => a.type === 'ron') && pend.responses.get(s)?.type !== 'ron') {
        const q = this.players[s];
        q.tempFuriten = true;
        if (q.riichi) q.riichiFuriten = true;
      }
    }

    if (rons.length > 0) {
      if (rons.length === 3 && this.rules.abortiveDraws) {
        this.abort('sanchahou');
        return;
      }
      if (this.riichiDeclaring === from) {
        // 宣言牌でロンされたらリーチは不成立
        this.players[from].doubleRiichi = false;
        this.riichiDeclaring = undefined;
      }
      this.settleWins(rons, from, pend.tile, !!pend.kan);
      return;
    }

    if (pend.kan) {
      // 槍槓なし → 嶺上牌をツモ
      this.draw(from, true);
      return;
    }

    // 鳴きの優先順位：ポン・カン > チー
    this.establishRiichi();
    for (const s of order) {
      const a = pend.responses.get(s);
      if (a?.type === 'pon' || a?.type === 'minkan') {
        this.call(s, from, pend.tile, a);
        return;
      }
    }
    for (const s of order) {
      const a = pend.responses.get(s);
      if (a?.type === 'chi') {
        this.call(s, from, pend.tile, a);
        return;
      }
    }
    this.afterDiscardPassed(from, true);
  }

  private establishRiichi() {
    const s = this.riichiDeclaring;
    if (s === undefined) return;
    this.riichiDeclaring = undefined;
    const p = this.players[s];
    p.riichi = true;
    p.ippatsu = true;
    p.score -= 1000;
    this.riichiSticks++;
  }

  private call(seat: Seat, from: Seat, tile: Tile, action: Action) {
    const p = this.players[seat];
    const discarder = this.players[from];
    const last = discarder.discards[discarder.discards.length - 1];
    last.calledBy = seat;
    discarder.nagashi = false;
    this.firstGoAround = false;
    for (const q of this.players) q.ippatsu = false;
    const kind = kindOf(tile);

    if (action.type === 'minkan') {
      const own = p.hand.filter((t) => kindOf(t) === kind);
      p.hand = p.hand.filter((t) => kindOf(t) !== kind);
      p.melds.push({ type: 'minkan', tiles: [...own, tile], calledTile: tile, from });
      this.checkPao(seat, from, kind);
      this.onKan(seat);
      this.pendingDora++;
      this.draw(seat, true);
      return;
    }
    if (action.type !== 'pon' && action.type !== 'chi') throw new Error('不正な鳴き');
    const pair = action.tiles;
    p.hand = removeOne(removeOne(p.hand, pair[0]), pair[1]);
    p.melds.push({ type: action.type, tiles: [...pair, tile].sort(compareTiles), calledTile: tile, from });
    p.kuikae = this.kuikaeKinds(pair, tile, action.type);
    if (action.type === 'pon') this.checkPao(seat, from, kind);
    this.current = seat;
    this.drawnTile = undefined;
    this.afterCall = true;
    this.rinshanDraw = false;
    this.phase = 'turn';
  }

  /** 大三元・大四喜の包 */
  private checkPao(seat: Seat, from: Seat, kind: Kind) {
    const p = this.players[seat];
    const kouKinds = p.melds.filter((m) => m.type !== 'chi').map((m) => kindOf(m.tiles[0]));
    if (isDragon(kind) && kouKinds.filter(isDragon).length === 3) p.pao = { seat: from, yaku: '大三元' };
    if (isWind(kind) && kouKinds.filter(isWind).length === 4) p.pao = { seat: from, yaku: '大四喜' };
  }

  /** 捨て牌が誰にも取られずに通った後の処理 */
  private afterDiscardPassed(from: Seat, riichiAlreadyChecked = false) {
    if (!riichiAlreadyChecked) this.establishRiichi();
    this.phase = 'turn';
    if (this.rules.abortiveDraws) {
      // 四家立直
      if (this.players.every((p) => p.riichi)) {
        this.abort('suucha');
        return;
      }
      // 四風連打
      if (this.firstGoAround && this.players.every((p) => p.discards.length === 1)) {
        const kinds = this.players.map((p) => kindOf(p.discards[0].tile));
        if (isWind(kinds[0]) && kinds.every((k) => k === kinds[0])) {
          this.abort('suufon');
          return;
        }
      }
      // 四開槓（1 人で 4 回槓した場合は四槓子の可能性があるので続行）
      if (this.kanCount >= 4 && new Set(this.kanBy).size > 1) {
        this.abort('suukaikan');
        return;
      }
    }
    // 1 巡したら第一巡の扱いを終える
    if (this.firstGoAround && from === (this.dealer + 3) % 4) this.firstGoAround = false;
    if (this.liveRemaining === 0) {
      this.exhaustiveDraw();
      return;
    }
    this.draw(((from + 1) % 4) as Seat, false);
  }

  // ───────────── 精算 ─────────────

  private settleWins(winners: Seat[], from: Seat | undefined, tile: Tile, chankan: boolean) {
    const tsumo = from === undefined;
    const deltas: [number, number, number, number] = [0, 0, 0, 0];
    const wins: WinInfo[] = [];
    // 本場・供託は放銃者から見て最も近い和了者（ツモなら和了者）が受け取る
    const stickTaker = winners[0];
    for (const w of winners) {
      const p = this.players[w];
      const score = this.winScore(w, tile, tsumo, chankan)!;
      const dealer = w === this.dealer;
      const before = deltas.slice();
      const honba = w === stickTaker ? this.honba : 0;
      const pao = p.pao && score.yaku.some((y) => y.name === p.pao!.yaku) ? p.pao.seat : undefined;
      const paoBase = pao !== undefined ? 8000 : 0;
      const otherBase = score.basePoints - paoBase;

      if (tsumo) {
        if (pao !== undefined) {
          // 包の役満分は責任者が全額
          const amount = payments(paoBase, dealer, false).total;
          deltas[pao] -= amount + honba * 300;
          deltas[w] += amount + honba * 300;
        }
        if (otherBase > 0) {
          const pay = payments(otherBase, dealer, true);
          for (const s of otherSeats(w)) {
            const amount = s === this.dealer ? pay.dealerPays : pay.nonDealerPays;
            const hb = pao === undefined ? honba * 100 : 0;
            deltas[s] -= amount + hb;
            deltas[w] += amount + hb;
          }
        }
      } else {
        const total = payments(score.basePoints, dealer, false).total;
        if (pao !== undefined && pao !== from) {
          const half = payments(paoBase, dealer, false).total / 2;
          deltas[pao] -= half;
          deltas[from!] -= total - half + honba * 300;
        } else {
          deltas[from!] -= total + honba * 300;
        }
        deltas[w] += total + honba * 300;
      }
      if (w === stickTaker) {
        deltas[w] += this.riichiSticks * 1000;
      }
      wins.push({
        seat: w,
        from,
        hand: tsumo ? removeOne(p.hand, tile) : p.hand.slice(),
        melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
        winTile: tile,
        score,
        gain: deltas[w] - before[w],
        uraIndicators: p.riichi ? this.uraIndicators : [],
        pao,
      });
    }
    this.riichiSticks = 0;
    for (let i = 0; i < 4; i++) this.players[i].score += deltas[i];
    this.result = { type: 'win', wins, deltas, renchan: winners.includes(this.dealer) };
    this.phase = 'roundEnd';
  }

  private abort(reason: AbortReason) {
    // 四家立直は afterDiscardPassed で成立済み。それ以外で宣言中のリーチは不成立
    this.riichiDeclaring = undefined;
    this.result = {
      type: 'draw',
      reason,
      tenpai: [],
      hands: this.players.map((p, i) => (reason === 'kyuushu' && i === this.current ? p.hand.slice() : null)),
      nagashi: [],
      deltas: [0, 0, 0, 0],
      renchan: true,
    };
    this.phase = 'roundEnd';
  }

  private exhaustiveDraw() {
    const tenpai = this.players.map((p) => isTenpai(toCounts(p.hand), p.melds.length > 0, this.usedCounts(p.hand, p.melds)));
    const deltas: [number, number, number, number] = [0, 0, 0, 0];
    const nagashi = this.rules.nagashiMangan
      ? ([0, 1, 2, 3] as Seat[]).filter((s) => this.players[s].nagashi && this.players[s].discards.length > 0)
      : [];
    if (nagashi.length > 0) {
      for (const w of nagashi) {
        const pay = payments(2000, w === this.dealer, true);
        for (const s of otherSeats(w)) {
          const amount = s === this.dealer ? pay.dealerPays : pay.nonDealerPays;
          deltas[s] -= amount;
          deltas[w] += amount;
        }
      }
    } else {
      const n = tenpai.filter(Boolean).length;
      if (n > 0 && n < 4) {
        for (let i = 0; i < 4; i++) deltas[i] = tenpai[i] ? 3000 / n : -3000 / (4 - n);
      }
    }
    for (let i = 0; i < 4; i++) this.players[i].score += deltas[i];
    this.result = {
      type: 'draw',
      reason: 'exhaustive',
      tenpai,
      hands: this.players.map((p, i) => (tenpai[i] ? p.hand.slice() : null)),
      nagashi,
      deltas,
      renchan: tenpai[this.dealer],
    };
    this.phase = 'roundEnd';
  }

  // ───────────── 局の移行・終局 ─────────────

  /** 順位（同点は起家に近い方が上） */
  ranking(): Seat[] {
    return ([0, 1, 2, 3] as Seat[]).sort((a, b) => this.players[b].score - this.players[a].score || a - b);
  }

  /** 局の結果を確認した後に呼ぶ。終局なら phase が gameEnd になる */
  nextRound() {
    if (this.phase !== 'roundEnd' || !this.result) throw new Error('局が終わっていません');
    const res = this.result;
    const renchan = res.renchan;
    const pos = this.roundWind * 4 + this.kyoku;
    const lastPos = this.rules.length === 'hanchan' ? 7 : 3;
    const maxPos = this.rules.extension ? lastPos + 4 : lastPos;
    const scores = this.players.map((p) => p.score);
    const top = this.ranking()[0];
    const someoneReturned = scores.some((s) => s >= this.rules.returnPoints);

    let end = false;
    if (this.rules.tobi && scores.some((s) => s < 0)) end = true;
    else if (pos >= lastPos) {
      if (renchan) {
        // アガリ止め・テンパイ止め（親がトップで返し点以上）
        if (top === this.dealer && scores[this.dealer] >= this.rules.returnPoints) end = true;
        // 延長戦では誰かが返し点に届いた時点で終了
        if (pos > lastPos && someoneReturned) end = true;
      } else if (someoneReturned || pos >= maxPos) {
        end = true;
      }
    }

    if (end) {
      this.finishGame();
      return;
    }
    if (renchan) {
      this.honba++;
    } else {
      this.honba = res.type === 'draw' ? this.honba + 1 : 0;
      this.kyoku++;
      if (this.kyoku === 4) {
        this.kyoku = 0;
        this.roundWind++;
      }
    }
    this.startRound();
  }

  private finishGame() {
    const order = this.ranking();
    // 残った供託はトップが受け取る
    this.players[order[0]].score += this.riichiSticks * 1000;
    this.riichiSticks = 0;
    const oka = ((this.rules.returnPoints - this.rules.startPoints) * 4) / 1000;
    this.standings = order.map((seat, rank) => {
      const score = this.players[seat].score;
      const base = (score - this.rules.returnPoints) / 1000;
      return { seat, rank: rank + 1, score, points: round1(base + this.rules.uma[rank] + (rank === 0 ? oka : 0)) };
    });
    this.phase = 'gameEnd';
  }
}

// ───────────── 補助関数 ─────────────

const round1 = (x: number) => Math.round(x * 10) / 10;

export function otherSeats(seat: Seat): Seat[] {
  return [1, 2, 3].map((d) => ((seat + d) % 4) as Seat);
}

function removeOne(tiles: Tile[], tile: Tile): Tile[] {
  const i = tiles.indexOf(tile);
  if (i < 0) throw new Error(`牌 ${tile} が手牌にありません`);
  return [...tiles.slice(0, i), ...tiles.slice(i + 1)];
}

/** 同じ種類・同じ赤かどうかで重複を除いた牌（選択肢を減らすため） */
function uniqueTiles(tiles: Tile[]): Tile[] {
  const seen = new Set<string>();
  const out: Tile[] = [];
  for (const t of [...tiles].sort(compareTiles)) {
    const key = `${kindOf(t)}:${isRedTile(t)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** ポンに使う 2 枚の選び方（赤を含むかどうかで区別） */
function pairChoices(same: Tile[]): [Tile, Tile][] {
  const reds = same.filter(isRedTile);
  const normals = same.filter((t) => !isRedTile(t));
  const out: [Tile, Tile][] = [];
  if (normals.length >= 2) out.push([normals[0], normals[1]]);
  if (reds.length >= 1 && normals.length >= 1) out.push([reds[0], normals[0]]);
  return out;
}

export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case 'discard':
      return a.tile === (b as typeof a).tile && !!a.riichi === !!(b as typeof a).riichi;
    case 'ankan':
      return a.kind === (b as typeof a).kind;
    case 'kakan':
      return a.tile === (b as typeof a).tile;
    case 'pon':
    case 'chi': {
      const x = [...a.tiles].sort((p, q) => p - q);
      const y = [...(b as typeof a).tiles].sort((p, q) => p - q);
      return x[0] === y[0] && x[1] === y[1];
    }
    default:
      return true;
  }
}
