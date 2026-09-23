// 役の判定と点数計算

import { decompose, isChiitoitsu, isKokushi, toCounts, type Counts } from './hand.ts';
import {
  doraFromIndicator,
  HAKU,
  HATSU,
  CHUN,
  isDragon,
  isHonor,
  isRedTile,
  isTerminal,
  isWind,
  isYaochu,
  kindOf,
  numOf,
  suitOf,
  type Kind,
  type Tile,
} from './tile.ts';
import type { Meld, ScoreResult, YakuItem } from './types.ts';

export interface WinContext {
  /** 和了時の手牌（副露を除く。和了牌を含む） */
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  tsumo: boolean;
  seatWind: Kind;
  roundWind: Kind;
  riichi: boolean;
  doubleRiichi: boolean;
  ippatsu: boolean;
  haitei: boolean;
  houtei: boolean;
  rinshan: boolean;
  chankan: boolean;
  tenhou: boolean;
  chiihou: boolean;
  doraIndicators: Tile[];
  /** リーチしていない場合は空にする */
  uraIndicators: Tile[];
  aka: boolean;
  kuitan: boolean;
  yakumanCompound: boolean;
}

type WaitShape = 'ryanmen' | 'kanchan' | 'penchan' | 'tanki' | 'shanpon';

interface Mentsu {
  type: 'shuntsu' | 'koutsu' | 'kantsu';
  kind: Kind;
  /** 副露、またはロンで完成した刻子 */
  open: boolean;
  /** 副露した面子か（門前判定用） */
  called: boolean;
}

interface Interpretation {
  mentsu: Mentsu[];
  pair: Kind;
  wait: WaitShape;
}

const meldToMentsu = (m: Meld): Mentsu => {
  const kind = Math.min(...m.tiles.map(kindOf));
  switch (m.type) {
    case 'chi':
      return { type: 'shuntsu', kind, open: true, called: true };
    case 'pon':
      return { type: 'koutsu', kind, open: true, called: true };
    case 'ankan':
      return { type: 'kantsu', kind, open: false, called: false };
    default:
      return { type: 'kantsu', kind, open: true, called: true };
  }
};

/** 和了牌をどの面子で受けたかの解釈をすべて列挙する */
function interpretations(counts: Counts, melds: Meld[], winKind: Kind, tsumo: boolean): Interpretation[] {
  const meldMentsu = melds.map(meldToMentsu);
  const out: Interpretation[] = [];
  for (const d of decompose(counts)) {
    const closed: Mentsu[] = d.blocks.map((b) => ({ type: b.type, kind: b.kind, open: false, called: false }));
    const seen = new Set<string>();
    const add = (wait: WaitShape, openIndex: number) => {
      const key = `${wait}:${openIndex >= 0 ? `${closed[openIndex].type}${closed[openIndex].kind}` : ''}`;
      if (seen.has(key)) return;
      seen.add(key);
      const ms = closed.map((m, i) => (i === openIndex ? { ...m, open: true } : m));
      out.push({ mentsu: [...ms, ...meldMentsu], pair: d.pair, wait });
    };
    if (d.pair === winKind) add('tanki', -1);
    closed.forEach((m, i) => {
      if (m.type === 'koutsu' && m.kind === winKind) {
        // ロンで完成した刻子は明刻扱い
        add('shanpon', tsumo ? -1 : i);
      } else if (m.type === 'shuntsu' && winKind >= m.kind && winKind <= m.kind + 2) {
        const pos = winKind - m.kind;
        const n = numOf(m.kind);
        let wait: WaitShape;
        if (pos === 1) wait = 'kanchan';
        else if (pos === 0) wait = n === 7 ? 'penchan' : 'ryanmen';
        else wait = n === 1 ? 'penchan' : 'ryanmen';
        add(wait, -1);
      }
    });
  }
  return out;
}

export function basePointsFor(han: number, fu: number, yakuman: number): { base: number; name: string } {
  if (yakuman > 0) return { base: 8000 * yakuman, name: yakuman === 1 ? '役満' : `${yakuman}倍役満` };
  if (han >= 13) return { base: 8000, name: '数え役満' };
  if (han >= 11) return { base: 6000, name: '三倍満' };
  if (han >= 8) return { base: 4000, name: '倍満' };
  if (han >= 6) return { base: 3000, name: '跳満' };
  const base = fu * 2 ** (han + 2);
  if (han >= 5 || base >= 2000) return { base: 2000, name: '満貫' };
  return { base, name: '' };
}
const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

/** 和了点の支払い（本場・供託を除く） */
export interface Payment {
  /** ツモ和了で親が払う点（親のツモでは 0） */
  dealerPays: number;
  /** ツモ和了で子が払う点 */
  nonDealerPays: number;
  /** 合計（ロンなら放銃者の支払い） */
  total: number;
}

export function payments(base: number, dealer: boolean, tsumo: boolean): Payment {
  if (!tsumo) {
    const total = ceil100(base * (dealer ? 6 : 4));
    return { dealerPays: 0, nonDealerPays: 0, total };
  }
  if (dealer) {
    const each = ceil100(base * 2);
    return { dealerPays: 0, nonDealerPays: each, total: each * 3 };
  }
  const d = ceil100(base * 2);
  const nd = ceil100(base);
  return { dealerPays: d, nonDealerPays: nd, total: d + nd * 2 };
}

function countDora(ctx: WinContext): { dora: number; ura: number; aka: number } {
  const all = [...ctx.hand, ...ctx.melds.flatMap((m) => m.tiles)];
  const kinds = all.map(kindOf);
  const count = (indicators: Tile[]) =>
    indicators.reduce((sum, ind) => {
      const d = doraFromIndicator(kindOf(ind));
      return sum + kinds.filter((k) => k === d).length;
    }, 0);
  return {
    dora: count(ctx.doraIndicators),
    ura: count(ctx.uraIndicators),
    aka: ctx.aka ? all.filter(isRedTile).length : 0,
  };
}

const GREEN = new Set<Kind>([19, 20, 21, 23, 25, HATSU]); // 2,3,4,6,8索 と 發

/** 役を判定して点数を返す。役がなければ null */
export function evaluateWin(ctx: WinContext): ScoreResult | null {
  const counts = toCounts(ctx.hand);
  const winKind = kindOf(ctx.winTile);
  const menzen = ctx.melds.every((m) => m.type === 'ankan');
  const allKinds: Kind[] = [...ctx.hand.map(kindOf), ...ctx.melds.flatMap((m) => m.tiles.map(kindOf))];

  const candidates: ScoreResult[] = [];
  const dora = countDora(ctx);

  // 状況役（手の形によらない役）
  const situational: YakuItem[] = [];
  if (ctx.doubleRiichi) situational.push({ name: 'ダブル立直', han: 2 });
  else if (ctx.riichi) situational.push({ name: '立直', han: 1 });
  if (ctx.ippatsu) situational.push({ name: '一発', han: 1 });
  if (menzen && ctx.tsumo) situational.push({ name: '門前清自摸和', han: 1 });
  if (ctx.haitei) situational.push({ name: '海底摸月', han: 1 });
  if (ctx.houtei) situational.push({ name: '河底撈魚', han: 1 });
  if (ctx.rinshan) situational.push({ name: '嶺上開花', han: 1 });
  if (ctx.chankan) situational.push({ name: '槍槓', han: 1 });

  // 形によらない役満
  const baseYakuman: YakuItem[] = [];
  if (ctx.tenhou) baseYakuman.push({ name: '天和', han: 0, yakuman: 1 });
  if (ctx.chiihou) baseYakuman.push({ name: '地和', han: 0, yakuman: 1 });
  if (allKinds.every(isHonor)) baseYakuman.push({ name: '字一色', han: 0, yakuman: 1 });
  if (allKinds.every(isTerminal)) baseYakuman.push({ name: '清老頭', han: 0, yakuman: 1 });
  if (allKinds.every((k) => GREEN.has(k))) baseYakuman.push({ name: '緑一色', han: 0, yakuman: 1 });
  const kanCount = ctx.melds.filter((m) => m.type !== 'chi' && m.type !== 'pon').length;
  if (kanCount === 4) baseYakuman.push({ name: '四槓子', han: 0, yakuman: 1 });

  const finishYakuman = (list: YakuItem[]) => {
    if (list.length === 0) return;
    let items = list;
    if (!ctx.yakumanCompound) items = [list[0]];
    const yakuman = items.reduce((s, y) => s + (y.yakuman ?? 0), 0);
    const { base, name } = basePointsFor(0, 0, yakuman);
    candidates.push({
      yaku: items,
      han: 0,
      fu: 0,
      yakuman,
      basePoints: base,
      limitName: name,
      dora: 0,
      uradora: 0,
      akadora: 0,
    });
  };

  const finishNormal = (yaku: YakuItem[], fu: number) => {
    if (yaku.length === 0) return;
    let han = yaku.reduce((s, y) => s + y.han, 0);
    const doraItems: YakuItem[] = [];
    if (dora.dora) doraItems.push({ name: 'ドラ', han: dora.dora });
    if (dora.aka) doraItems.push({ name: '赤ドラ', han: dora.aka });
    if (dora.ura) doraItems.push({ name: '裏ドラ', han: dora.ura });
    han += dora.dora + dora.aka + dora.ura;
    const { base, name } = basePointsFor(han, fu, 0);
    candidates.push({
      yaku: [...yaku, ...doraItems],
      han,
      fu,
      yakuman: 0,
      basePoints: base,
      limitName: name,
      dora: dora.dora,
      uradora: dora.ura,
      akadora: dora.aka,
    });
  };

  // 国士無双
  if (ctx.melds.length === 0 && isKokushi(counts)) {
    finishYakuman([...baseYakuman, { name: '国士無双', han: 0, yakuman: 1 }]);
  }

  // 七対子
  if (ctx.melds.length === 0 && isChiitoitsu(counts)) {
    if (baseYakuman.length) {
      finishYakuman(baseYakuman);
    } else {
      const yaku = [...situational, { name: '七対子', han: 2 }];
      if (allKinds.every((k) => !isYaochu(k))) yaku.push({ name: '断幺九', han: 1 });
      if (allKinds.every(isYaochu)) yaku.push({ name: '混老頭', han: 2 });
      yaku.push(...flushYaku(allKinds, true));
      finishNormal(yaku, 25);
    }
  }

  // 一般形
  for (const it of interpretations(counts, ctx.melds, winKind, ctx.tsumo)) {
    const yakuman = [...baseYakuman, ...standardYakuman(it, ctx, menzen, counts, winKind)];
    if (yakuman.length) {
      finishYakuman(yakuman);
      continue;
    }
    const yaku = [...situational, ...standardYaku(it, ctx, menzen, allKinds)];
    const isPinfu = yaku.some((y) => y.name === '平和');
    finishNormal(yaku, calcFu(it, ctx, menzen, isPinfu));
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.basePoints - a.basePoints || b.han - a.han || b.fu - a.fu);
  return candidates[0];
}

function flushYaku(kinds: Kind[], menzen: boolean): YakuItem[] {
  const suits = new Set(kinds.filter((k) => !isHonor(k)).map(suitOf));
  if (suits.size !== 1) return [];
  const hasHonor = kinds.some(isHonor);
  if (hasHonor) return [{ name: '混一色', han: menzen ? 3 : 2 }];
  return [{ name: '清一色', han: menzen ? 6 : 5 }];
}

const mentsuKinds = (m: Mentsu): Kind[] => (m.type === 'shuntsu' ? [m.kind, m.kind + 1, m.kind + 2] : [m.kind]);

function standardYakuman(it: Interpretation, ctx: WinContext, menzen: boolean, counts: Counts, winKind: Kind): YakuItem[] {
  const out: YakuItem[] = [];
  const kou = it.mentsu.filter((m) => m.type !== 'shuntsu');
  const ankou = kou.filter((m) => !m.open).length;
  if (ankou === 4) out.push({ name: '四暗刻', han: 0, yakuman: 1 });
  const dragonKou = kou.filter((m) => isDragon(m.kind)).length;
  if (dragonKou === 3) out.push({ name: '大三元', han: 0, yakuman: 1 });
  const windKou = kou.filter((m) => isWind(m.kind)).length;
  if (windKou === 4) out.push({ name: '大四喜', han: 0, yakuman: 1 });
  else if (windKou === 3 && isWind(it.pair)) out.push({ name: '小四喜', han: 0, yakuman: 1 });
  // 九蓮宝燈：門前・副露なしで 1112345678999 + 同色 1 枚
  if (menzen && ctx.melds.length === 0) {
    const suit = suitOf(winKind);
    if (suit < 3) {
      const base = suit * 9;
      const need = [3, 1, 1, 1, 1, 1, 1, 1, 3];
      let ok = true;
      let total = 0;
      for (let i = 0; i < 9; i++) {
        if (counts[base + i] < need[i]) ok = false;
        total += counts[base + i];
      }
      if (ok && total === 14) out.push({ name: '九蓮宝燈', han: 0, yakuman: 1 });
    }
  }
  return out;
}

function standardYaku(it: Interpretation, ctx: WinContext, menzen: boolean, allKinds: Kind[]): YakuItem[] {
  const yaku: YakuItem[] = [];
  const ms = it.mentsu;
  const shun = ms.filter((m) => m.type === 'shuntsu');
  const kou = ms.filter((m) => m.type !== 'shuntsu');
  const isValuePair = (k: Kind) => isDragon(k) || k === ctx.seatWind || k === ctx.roundWind;

  // 平和
  if (menzen && shun.length === 4 && !isValuePair(it.pair) && it.wait === 'ryanmen') {
    yaku.push({ name: '平和', han: 1 });
  }
  // 断幺九
  if ((menzen || ctx.kuitan) && allKinds.every((k) => !isYaochu(k))) yaku.push({ name: '断幺九', han: 1 });
  // 一盃口・二盃口
  if (menzen) {
    const keys = shun.map((m) => m.kind).sort((a, b) => a - b);
    let pairs = 0;
    for (let i = 0; i + 1 < keys.length; i++) {
      if (keys[i] === keys[i + 1]) {
        pairs++;
        i++;
      }
    }
    if (pairs === 2) yaku.push({ name: '二盃口', han: 3 });
    else if (pairs === 1) yaku.push({ name: '一盃口', han: 1 });
  }
  // 役牌
  for (const m of kou) {
    if (m.kind === HAKU) yaku.push({ name: '役牌 白', han: 1 });
    if (m.kind === HATSU) yaku.push({ name: '役牌 發', han: 1 });
    if (m.kind === CHUN) yaku.push({ name: '役牌 中', han: 1 });
    if (m.kind === ctx.seatWind) yaku.push({ name: '自風牌', han: 1 });
    if (m.kind === ctx.roundWind) yaku.push({ name: '場風牌', han: 1 });
  }
  // 混全帯幺九・純全帯幺九・混老頭
  const blocksKinds = [...ms.map(mentsuKinds), [it.pair]];
  const allBlocksYaochu = blocksKinds.every((ks) => ks.some(isYaochu));
  if (allKinds.every(isYaochu)) {
    yaku.push({ name: '混老頭', han: 2 });
  } else if (allBlocksYaochu && shun.length > 0) {
    if (allKinds.some(isHonor)) yaku.push({ name: '混全帯幺九', han: menzen ? 2 : 1 });
    else yaku.push({ name: '純全帯幺九', han: menzen ? 3 : 2 });
  }
  // 一気通貫
  for (let s = 0; s < 3; s++) {
    const b = s * 9;
    if ([b, b + 3, b + 6].every((k) => shun.some((m) => m.kind === k))) {
      yaku.push({ name: '一気通貫', han: menzen ? 2 : 1 });
      break;
    }
  }
  // 三色同順・三色同刻
  for (let n = 0; n < 9; n++) {
    if (n <= 6 && [0, 9, 18].every((b) => shun.some((m) => m.kind === b + n))) {
      yaku.push({ name: '三色同順', han: menzen ? 2 : 1 });
      break;
    }
  }
  for (let n = 0; n < 9; n++) {
    if ([0, 9, 18].every((b) => kou.some((m) => m.kind === b + n))) {
      yaku.push({ name: '三色同刻', han: 2 });
      break;
    }
  }
  // 対々和・三暗刻・三槓子
  if (kou.length === 4) yaku.push({ name: '対々和', han: 2 });
  if (kou.filter((m) => !m.open).length === 3) yaku.push({ name: '三暗刻', han: 2 });
  if (ms.filter((m) => m.type === 'kantsu').length === 3) yaku.push({ name: '三槓子', han: 2 });
  // 小三元
  if (kou.filter((m) => isDragon(m.kind)).length === 2 && isDragon(it.pair)) yaku.push({ name: '小三元', han: 2 });
  // 混一色・清一色
  yaku.push(...flushYaku(allKinds, menzen));

  // 状況役だけでなく手役もあるかは呼び出し側で合算して判定する
  return yaku;
}

function calcFu(it: Interpretation, ctx: WinContext, menzen: boolean, pinfu: boolean): number {
  if (pinfu) return ctx.tsumo ? 20 : 30;
  let fu = 20;
  if (menzen && !ctx.tsumo) fu += 10;
  if (ctx.tsumo) fu += 2;
  for (const m of it.mentsu) {
    if (m.type === 'shuntsu') continue;
    let f = m.type === 'kantsu' ? 8 : 2;
    if (!m.open) f *= 2;
    if (isYaochu(m.kind)) f *= 2;
    fu += f;
  }
  if (isDragon(it.pair)) fu += 2;
  if (it.pair === ctx.seatWind) fu += 2;
  if (it.pair === ctx.roundWind) fu += 2;
  if (it.wait === 'kanchan' || it.wait === 'penchan' || it.wait === 'tanki') fu += 2;
  fu = Math.ceil(fu / 10) * 10;
  // 喰い平和形（副露して符が 20 のまま）は 30 符
  if (fu === 20) fu = 30;
  return fu;
}
