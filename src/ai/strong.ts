// ルールベースの「つよい」CPU
//
// 1. 牌効率：向聴数が最小になる打牌のうち、有効牌の残り枚数が最も多いものを選ぶ
// 2. 手の価値：ドラ・赤・役牌の対子を残す。鳴いた手は役（役牌・タンヤオ・混一色）に向かう
// 3. 守備：リーチなどの脅威があれば牌ごとの危険度を推定し、向聴数と手の価値から押し引きを決める
// 4. リーチ：待ちの残り枚数・フリテンを見て判断。役があって高い手はダマ
// 5. 鳴き：向聴数が進み、役の見込みがあるときだけ
//
// 数値（重み・しきい値）は自己対戦で調整する前提の初期値。

import { countYaochuKinds, shanten, toCounts, waitingKinds, type Counts } from '../engine/hand.ts';
import { evaluateWin } from '../engine/score.ts';
import {
  doraFromIndicator,
  isDragon,
  isHonor,
  isRedTile,
  isYaochu,
  kindOf,
  numOf,
  suitOf,
  type Kind,
  type Tile,
} from '../engine/tile.ts';
import type { Action, Meld, Seat } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { Agent } from './agent.ts';

type DiscardAction = Extract<Action, { type: 'discard' }>;

/** 調整できる重み */
export interface StrongParams {
  /** ドラを捨てるときの減点（有効牌何枚分か） */
  doraKeep: number;
  /** 役牌の対子を崩すときの減点 */
  yakuhaiPairKeep: number;
  /** 鳴いた手で役に向かわない牌を持つときの減点 */
  planKeep: number;
  /** 押すときの危険度の重み */
  pushDanger: number;
  /** 1 向聴で押す手の価値（翻数の目安） */
  pushValue1: number;
  /** 聴牌でも降りる危険度（安い手のとき） */
  foldDangerTenpai: number;
  /** 何向聴以上なら（手の価値によらず）降りるか */
  foldShanten: number;
  /** 鳴いた相手（3 副露）をどれだけ警戒するか（リーチ = 1） */
  openThreat: number;
  /** 役牌以外の鳴きを許す、鳴いた後の向聴数の上限 */
  callMaxShanten: number;
  /** 門前でこの向聴数以下なら、役牌以外は鳴かずにリーチを目指す */
  menzenKeepShanten: number;
  /** この基本点以上ならリーチせずダマにする（2000 = 満貫） */
  damaBase: number;
}

// 自己対戦（ミラー対局 1600 局）で比べて決めた値
export const DEFAULT_STRONG: StrongParams = {
  doraKeep: 2,
  yakuhaiPairKeep: 3,
  planKeep: 6,
  pushDanger: 1.5,
  pushValue1: 2,
  foldDangerTenpai: 20,
  foldShanten: 2,
  openThreat: 0.6,
  callMaxShanten: 1,
  menzenKeepShanten: 2,
  damaBase: 2000,
};

/** 自分から見た局面の情報をまとめたもの */
interface Ctx {
  view: PlayerView;
  seat: Seat;
  hand: Tile[];
  melds: Meld[];
  counts: Counts;
  meldCount: number;
  menzen: boolean;
  /** 自分から見えている枚数（手牌・河・副露・ドラ表示） */
  visible: Counts;
  doraKinds: Kind[];
  seatWind: Kind;
  roundWind: Kind;
  threats: Threat[];
}

interface Threat {
  seat: Seat;
  /** 脅威の強さ（リーチ = 1） */
  weight: number;
  /** 現物（安全な牌の種類） */
  safe: Set<Kind>;
  /** 捨てた牌の種類（筋の判定に使う） */
  discarded: Set<Kind>;
  yakuhai: Set<Kind>;
}

export class StrongAgent implements Agent {
  readonly kind = 'cpu:strong';
  private params: StrongParams;
  private rand: () => number;

  constructor(rand: () => number = Math.random, params: Partial<StrongParams> = {}) {
    this.rand = rand;
    this.params = { ...DEFAULT_STRONG, ...params };
  }

  decide(view: PlayerView, legal: Action[]): Action {
    // 和了できるなら必ず和了
    const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
    if (win) return win;
    const ctx = makeCtx(view, this.params);

    if (legal.some((a) => a.type === 'pass')) return this.respond(ctx, legal);

    // 九種九牌：国士無双を狙えるほど么九牌がなければ流す
    const kyuushu = legal.find((a) => a.type === 'kyuushu');
    if (kyuushu && countYaochuKinds(ctx.counts) < 11) return kyuushu;

    const kan = this.chooseKan(ctx, legal);
    if (kan) return kan;
    return this.chooseDiscard(ctx, legal);
  }

  // ───────────── 打牌 ─────────────

  private chooseDiscard(ctx: Ctx, legal: Action[]): Action {
    const discards = legal.filter((a): a is DiscardAction => a.type === 'discard');
    const plain = pickRepresentatives(discards.filter((a) => !a.riichi));
    const riichi = pickRepresentatives(discards.filter((a) => a.riichi));
    const P = this.params;

    const currentShanten = shanten(ctx.counts, ctx.meldCount);
    const cands = plain.map((a) => this.evalDiscard(ctx, a.tile));

    // 押し引き
    const threat = ctx.threats.reduce((s, t) => s + t.weight, 0);
    let mode: 'attack' | 'careful' | 'fold' = 'attack';
    if (threat > 0) {
      const value = handValue(ctx);
      if (currentShanten >= P.foldShanten) mode = 'fold';
      else if (currentShanten === 1) mode = value >= P.pushValue1 ? 'careful' : 'fold';
      else mode = 'careful';
    }

    let best: (typeof cands)[number];
    if (mode === 'fold') {
      best = minBy(cands, (c) => c.danger * 100 + c.shanten * 10 - c.ukeire * 0.01);
    } else {
      const w = mode === 'careful' ? P.pushDanger : 0;
      best = minBy(cands, (c) => c.shanten * 1000 - c.ukeire - c.value + c.danger * w);
      // 聴牌していても、安くて危険な牌しか押せないなら降りる
      if (mode === 'careful' && best.shanten === 0 && best.danger >= P.foldDangerTenpai && handValue(ctx) <= 1) {
        best = minBy(cands, (c) => c.danger * 100 + c.shanten * 10 - c.ukeire * 0.01);
      }
    }

    // リーチ判断
    if (riichi.length > 0 && best.shanten === 0) {
      const r = this.chooseRiichi(ctx, riichi, best.tile, mode);
      if (r) return r;
    }
    return plain.find((a) => a.tile === best.tile) ?? discards[0];
  }

  private evalDiscard(ctx: Ctx, tile: Tile) {
    const k = kindOf(tile);
    const c = ctx.counts.slice();
    c[k]--;
    const sh = shanten(c, ctx.meldCount);
    let ukeire = 0;
    for (let x = 0; x < 34; x++) {
      const rest = 4 - ctx.visible[x];
      if (rest <= 0 || c[x] >= 4) continue;
      c[x]++;
      const s2 = shanten(c, ctx.meldCount);
      c[x]--;
      if (s2 < sh) ukeire += rest * this.waitWeight(ctx, c, x, sh);
    }
    return { tile, kind: k, shanten: sh, ukeire, value: this.keepValue(ctx, k, tile), danger: dangerOf(ctx, k) };
  }

  /** 聴牌の待ちで、役がなく和了れない牌は数えない（鳴いた手のとき） */
  private waitWeight(ctx: Ctx, c13: Counts, w: Kind, sh: number): number {
    if (sh !== 0 || ctx.menzen) return 1;
    return hasYakuOnRon(ctx, c13, w) ? 1 : 0;
  }

  /** その牌を捨てると失う価値（有効牌の枚数に換算。大きいほど残したい） */
  private keepValue(ctx: Ctx, k: Kind, tile: Tile): number {
    const P = this.params;
    let v = 0;
    const doraHits = ctx.doraKinds.filter((d) => d === k).length;
    v += doraHits * P.doraKeep;
    if (isRedTile(tile) && ctx.view.rules.aka) v += P.doraKeep;
    const yakuhai = isDragon(k) || k === ctx.seatWind || k === ctx.roundWind;
    if (yakuhai && ctx.counts[k] >= 2) v += P.yakuhaiPairKeep;
    // 鳴いた手は役に向かう牌を残す
    const plan = openPlan(ctx);
    if (plan === 'tanyao' && isYaochu(k)) v -= P.planKeep;
    if (typeof plan === 'number' && !isHonor(k) && suitOf(k) !== plan) v -= P.planKeep;
    // 序盤の孤立した字牌・端牌は早めに切る（数牌の方が伸びやすい）
    if (isHonor(k) && ctx.counts[k] === 1 && !yakuhai) v -= 0.5;
    return v;
  }

  private chooseRiichi(ctx: Ctx, riichi: DiscardAction[], dama: Tile, mode: string): Action | null {
    const own = new Set(ctx.view.players[ctx.seat].discards.map((d) => kindOf(d.tile)));
    let best: { a: DiscardAction; score: number } | null = null;
    for (const a of riichi) {
      const c = ctx.counts.slice();
      c[kindOf(a.tile)]--;
      const waits = waitingKinds(c, ctx.meldCount > 0);
      const live = waits.reduce((s, w) => s + Math.max(0, 4 - ctx.visible[w]), 0);
      const furiten = waits.some((w) => own.has(w) || w === kindOf(a.tile));
      let score = live * (furiten ? 0.3 : 1);
      if (mode === 'careful') score -= dangerOf(ctx, kindOf(a.tile)) * this.params.pushDanger * 0.3;
      if (!best || score > best.score) best = { a, score };
    }
    if (!best || best.score <= 0) return null;
    // 役があって満貫以上ならダマで十分
    const c = ctx.counts.slice();
    c[kindOf(dama)]--;
    const waits = waitingKinds(c, false);
    const damaBase = Math.min(...waits.map((w) => ronBase(ctx, c, w)));
    if (damaBase >= this.params.damaBase && kindOf(best.a.tile) === kindOf(dama)) return null;
    return best.a;
  }

  // ───────────── 槓 ─────────────

  private chooseKan(ctx: Ctx, legal: Action[]): Action | null {
    const threat = ctx.threats.length > 0;
    for (const a of legal) {
      if (a.type === 'ankan') {
        const c = ctx.counts.slice();
        c[a.kind] -= 4;
        const before = Math.min(...[...new Set(ctx.hand)].map((t) => shantenAfter(ctx.counts, kindOf(t), ctx.meldCount)));
        const after = shanten(c, ctx.meldCount + 1);
        // 槓しても向聴数が悪くならないなら槓（リーチ中は合法なら常に）
        if (ctx.view.players[ctx.seat].riichi || after <= before) return a;
      }
      if (a.type === 'kakan' && !threat) return a;
    }
    return null;
  }

  // ───────────── 鳴き ─────────────

  private respond(ctx: Ctx, legal: Action[]): Action {
    const pass: Action = { type: 'pass' };
    const s0 = shanten(ctx.counts, ctx.meldCount);
    const threat = ctx.threats.length > 0;
    if (threat && s0 >= this.params.foldShanten) return pass;
    const tile = ctx.view.pendingTile?.tile;
    if (tile === undefined) return pass;
    const k = kindOf(tile);
    const yakuhai = isDragon(k) || k === ctx.seatWind || k === ctx.roundWind;

    let best: { a: Action; s1: number } | null = null;
    for (const a of legal) {
      if (a.type !== 'pon' && a.type !== 'chi') continue;
      const c = ctx.counts.slice();
      c[kindOf(a.tiles[0])]--;
      c[kindOf(a.tiles[1])]--;
      // 鳴いた後の最善の打牌での向聴数
      let s1 = 99;
      for (let d = 0; d < 34; d++) {
        if (c[d] === 0 || d === k) continue;
        c[d]--;
        s1 = Math.min(s1, shanten(c, ctx.meldCount + 1));
        c[d]++;
      }
      if (s1 >= s0) continue;
      const meldKinds = [...a.tiles.map(kindOf), k];
      const ok = (a.type === 'pon' && yakuhai) || this.callKeepsYaku(ctx, c, meldKinds);
      if (!ok) continue;
      // 門前で 1 向聴以内なら、役牌以外ではリーチを目指して鳴かない
      if (ctx.menzen && s0 <= this.params.menzenKeepShanten && !(a.type === 'pon' && yakuhai)) continue;
      if (!(a.type === 'pon' && yakuhai) && s1 > this.params.callMaxShanten) continue;
      if (!best || s1 < best.s1) best = { a, s1 };
    }
    return best?.a ?? pass;
  }

  /** 鳴いた後も役の見込みがあるか（役牌の副露・タンヤオ・混一色） */
  private callKeepsYaku(ctx: Ctx, rest: Counts, newMeld: Kind[]): boolean {
    const meldKinds = [...ctx.melds.flatMap((m) => m.tiles.map(kindOf)), ...newMeld];
    // すでに役牌を鳴いている
    for (const m of ctx.melds) {
      const k = kindOf(m.tiles[0]);
      if (m.type !== 'chi' && (isDragon(k) || k === ctx.seatWind || k === ctx.roundWind)) return true;
    }
    // タンヤオ：鳴いた牌がすべて中張牌で、手の么九牌が 2 枚以下
    if (ctx.view.rules.kuitan && meldKinds.every((x) => !isYaochu(x))) {
      let y = 0;
      for (let x = 0; x < 34; x++) if (isYaochu(x)) y += rest[x];
      if (y <= 2) return true;
    }
    // 混一色・清一色：鳴いた牌が 1 色（＋字牌）で、ほかの色が 2 枚以下
    const suits = new Set(meldKinds.filter((x) => !isHonor(x)).map(suitOf));
    if (suits.size === 1) {
      const s = [...suits][0];
      let off = 0;
      for (let x = 0; x < 27; x++) if (suitOf(x) !== s) off += rest[x];
      if (off <= 2) return true;
    }
    return false;
  }
}

// ───────────── 局面の分析 ─────────────

function makeCtx(view: PlayerView, params: StrongParams): Ctx {
  const seat = view.seat;
  const me = view.players[seat];
  const hand = me.hand ?? [];
  const visible = toCounts(hand);
  for (const p of view.players) {
    for (const d of p.discards) if (d.calledBy === undefined) visible[kindOf(d.tile)]++;
    for (const m of p.melds) for (const t of m.tiles) visible[kindOf(t)]++;
  }
  for (const t of view.doraIndicators) visible[kindOf(t)]++;
  // 応答待ちの牌は河に置かれている扱い（鳴き判断のときは手にない）
  const ctx: Ctx = {
    view,
    seat,
    hand,
    melds: me.melds,
    counts: toCounts(hand),
    meldCount: me.melds.length,
    menzen: me.melds.every((m) => m.type === 'ankan'),
    visible: visible.map((v) => Math.min(v, 4)),
    doraKinds: view.doraIndicators.map((t) => doraFromIndicator(kindOf(t))),
    seatWind: me.seatWind,
    roundWind: 27 + view.roundWind,
    threats: [],
  };
  ctx.threats = findThreats(ctx, params);
  return ctx;
}

function findThreats(ctx: Ctx, params: StrongParams): Threat[] {
  const { view } = ctx;
  const out: Threat[] = [];
  view.players.forEach((p, i) => {
    if (i === ctx.seat) return;
    const openMelds = p.melds.filter((m) => m.type !== 'ankan').length;
    let weight = 0;
    if (p.riichi) weight = 1;
    else if (openMelds >= 3) weight = params.openThreat;
    else if (openMelds >= 2 && meldDora(ctx, p.melds) >= 2) weight = params.openThreat * 0.7;
    if (weight === 0 && !p.riichi) return;
    if (weight === 0) return;
    if (i === view.dealer) weight *= 1.3;
    const discarded = new Set(p.discards.map((d) => kindOf(d.tile)));
    const safe = new Set(discarded);
    // リーチ後に他家が捨てて通った牌も現物（おおよその判定）
    const riichiIdx = p.discards.findIndex((d) => d.riichi);
    if (p.riichi && riichiIdx >= 0) {
      view.players.forEach((q, j) => {
        if (j === i) return;
        q.discards.forEach((d, idx) => {
          if (idx > riichiIdx) safe.add(kindOf(d.tile));
        });
      });
    }
    const seatWind = p.seatWind;
    const yakuhai = new Set<Kind>([31, 32, 33, seatWind, ctx.roundWind]);
    out.push({ seat: i as Seat, weight, safe, discarded, yakuhai });
  });
  return out;
}

function meldDora(ctx: Ctx, melds: Meld[]): number {
  let n = 0;
  for (const m of melds) {
    for (const t of m.tiles) {
      if (ctx.doraKinds.includes(kindOf(t))) n++;
      if (isRedTile(t) && ctx.view.rules.aka) n++;
    }
  }
  return n;
}

/** 危険度（放銃率の目安、%）を脅威の重みで合計したもの */
function dangerOf(ctx: Ctx, k: Kind): number {
  let total = 0;
  for (const th of ctx.threats) total += th.weight * dangerVs(ctx, th, k);
  return total;
}

function dangerVs(ctx: Ctx, th: Threat, k: Kind): number {
  if (th.safe.has(k)) return 0;
  let d: number;
  if (isHonor(k)) {
    const seen = ctx.visible[k];
    d = seen >= 3 ? 0.5 : seen === 2 ? 1.5 : seen === 1 ? 3 : 5;
    if (th.yakuhai.has(k)) d *= 1.3;
  } else {
    const n = numOf(k);
    const has = (m: number) => m >= 1 && m <= 9 && th.discarded.has(k - n + m);
    let suji: 'full' | 'half' | 'none';
    if (n <= 3) suji = has(n + 3) ? 'full' : 'none';
    else if (n >= 7) suji = has(n - 3) ? 'full' : 'none';
    else suji = has(n - 3) && has(n + 3) ? 'full' : has(n - 3) || has(n + 3) ? 'half' : 'none';
    const edge = n === 1 || n === 9 ? 0 : n === 2 || n === 8 ? 1 : n === 3 || n === 7 ? 2 : 3;
    const base = [5, 8, 10, 12][edge];
    const sujiBase = [1.5, 2.5, 3.5, 4][edge];
    d = suji === 'full' ? sujiBase : suji === 'half' ? 7 : base;
    // 壁：両面待ちの形が作れない（隣の牌が 4 枚見えている）
    const wallLow = n <= 2 || ctx.visible[k - 1] >= 4;
    const wallHigh = n >= 8 || ctx.visible[k + 1] >= 4;
    if (wallLow && wallHigh) d *= 0.4;
  }
  if (ctx.doraKinds.includes(k)) d *= 1.3;
  return d;
}

/** 手の価値の目安（翻数） */
function handValue(ctx: Ctx): number {
  let v = 0;
  const all = [...ctx.hand, ...ctx.melds.flatMap((m) => m.tiles)];
  for (const t of all) {
    v += ctx.doraKinds.filter((d) => d === kindOf(t)).length;
    if (isRedTile(t) && ctx.view.rules.aka) v++;
  }
  if (ctx.menzen) v += 1; // リーチできる
  const c = toCounts(all);
  for (const k of [31, 32, 33, ctx.seatWind, ctx.roundWind]) if (c[k] >= 3) v++;
  if (ctx.view.players[ctx.seat].seatWind === 27) v += 1; // 親は点数が 1.5 倍
  return v;
}

/** 鳴いた手の方針：'tanyao'・色（混一色）・null（役牌などで決まっている or 門前） */
function openPlan(ctx: Ctx): 'tanyao' | number | null {
  if (ctx.menzen) return null;
  for (const m of ctx.melds) {
    const k = kindOf(m.tiles[0]);
    if (m.type !== 'chi' && (isDragon(k) || k === ctx.seatWind || k === ctx.roundWind)) return null;
  }
  const kinds = ctx.melds.flatMap((m) => m.tiles.map(kindOf));
  if (kinds.every((k) => !isYaochu(k))) return 'tanyao';
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  if (suits.size === 1) return [...suits][0];
  return null;
}

/** 13 枚の手で w をロンしたときに役があるか */
function hasYakuOnRon(ctx: Ctx, c13: Counts, w: Kind): boolean {
  return ronBase(ctx, c13, w) > 0;
}

/** ロン和了の基本点（役がなければ 0） */
function ronBase(ctx: Ctx, c13: Counts, w: Kind): number {
  const hand: Tile[] = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < c13[k]; i++) hand.push(k * 4 + ((i + 1) % 4));
  const winTile = w * 4 + 3;
  hand.push(winTile);
  const r = evaluateWin({
    hand,
    melds: ctx.melds,
    winTile,
    tsumo: false,
    seatWind: ctx.seatWind,
    roundWind: ctx.roundWind,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    tenhou: false,
    chiihou: false,
    doraIndicators: ctx.view.doraIndicators,
    uraIndicators: [],
    aka: false,
    kuitan: ctx.view.rules.kuitan,
    yakumanCompound: ctx.view.rules.yakumanCompound,
  });
  return r ? r.basePoints : 0;
}

function shantenAfter(c: Counts, k: Kind, meldCount: number): number {
  const x = c.slice();
  x[k]--;
  return shanten(x, meldCount);
}

/** 同じ種類の打牌は 1 つにまとめる（赤 5 は最後まで残す） */
function pickRepresentatives(acts: DiscardAction[]): DiscardAction[] {
  const byKind = new Map<Kind, DiscardAction>();
  for (const a of acts) {
    const k = kindOf(a.tile);
    const cur = byKind.get(k);
    if (!cur || (isRedTile(cur.tile) && !isRedTile(a.tile))) byKind.set(k, a);
  }
  return [...byKind.values()];
}

function minBy<T>(xs: T[], f: (x: T) => number): T {
  let best = xs[0];
  let bv = f(best);
  for (const x of xs.slice(1)) {
    const v = f(x);
    if (v < bv) {
      bv = v;
      best = x;
    }
  }
  return best;
}
