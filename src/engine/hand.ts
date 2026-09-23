// 手牌の形の判定（和了形・待ち・分解）

import { isYaochu, kindOf, NUM_KINDS, YAOCHU_KINDS, type Kind, type Tile } from './tile.ts';

export type Counts = number[];

export function toCounts(tiles: readonly Tile[]): Counts {
  const c = new Array<number>(NUM_KINDS).fill(0);
  for (const t of tiles) c[kindOf(t)]++;
  return c;
}

export interface Block {
  type: 'shuntsu' | 'koutsu';
  /** 順子なら先頭の種類、刻子なら種類 */
  kind: Kind;
}

export interface Decomposition {
  pair: Kind;
  blocks: Block[];
}

/** 面子だけに分解できるか（雀頭なし、合計が 3 の倍数） */
function canFormMentsu(c: Counts, start: number): boolean {
  let i = start;
  while (i < NUM_KINDS && c[i] === 0) i++;
  if (i >= NUM_KINDS) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canFormMentsu(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    const ok = canFormMentsu(c, i);
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 一般形（4 面子 1 雀頭。副露分は除いた枚数）で和了形か */
export function isStandardAgari(c: Counts): boolean {
  let total = 0;
  for (let i = 0; i < NUM_KINDS; i++) total += c[i];
  if (total % 3 !== 2) return false;
  for (let p = 0; p < NUM_KINDS; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      const ok = canFormMentsu(c, 0);
      c[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}

export function isChiitoitsu(c: Counts): boolean {
  let pairs = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    if (c[i] === 2) pairs++;
    else if (c[i] !== 0) return false;
  }
  return pairs === 7;
}

export function isKokushi(c: Counts): boolean {
  let hasPair = false;
  let total = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    total += c[i];
    if (isYaochu(i)) {
      if (c[i] === 0) return false;
      if (c[i] === 2) hasPair = true;
      else if (c[i] !== 1) return false;
    } else if (c[i] !== 0) {
      return false;
    }
  }
  return total === 14 && hasPair;
}

/** 和了形か（七対子・国士無双は副露なしのときだけ） */
export function isAgari(c: Counts, hasMelds: boolean): boolean {
  if (isStandardAgari(c)) return true;
  if (hasMelds) return false;
  return isChiitoitsu(c) || isKokushi(c);
}

/** 3n+1 枚の手牌の待ち（和了形になる牌の種類）。形だけで判定し、役の有無は見ない */
export function waitingKinds(c: Counts, hasMelds: boolean): Kind[] {
  const out: Kind[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (c[k] >= 4) continue;
    // 和了牌は、手牌にある牌か同じ色で 2 つ以内の数牌に限られる（国士無双は么九牌すべて）
    if (c[k] === 0 && !(!hasMelds && isYaochu(k)) && !hasNeighbor(c, k)) continue;
    c[k]++;
    if (isAgari(c, hasMelds)) out.push(k);
    c[k]--;
  }
  return out;
}

function hasNeighbor(c: Counts, k: Kind): boolean {
  if (k >= 27) return false;
  const n = k % 9;
  for (let d = -2; d <= 2; d++) {
    const m = n + d;
    if (d !== 0 && m >= 0 && m <= 8 && c[k + d] > 0) return true;
  }
  return false;
}

/**
 * 聴牌しているか。待ち牌を自分の手牌と副露で 4 枚とも使い切っている場合（5 枚目待ち）は聴牌とみなさない。
 * @param usedCounts 手牌と副露に含まれる牌の枚数
 */
export function isTenpai(c: Counts, hasMelds: boolean, usedCounts: Counts = c): boolean {
  return waitingKinds(c, hasMelds).some((k) => usedCounts[k] < 4);
}

/** 一般形のすべての分解を列挙する */
export function decompose(c: Counts): Decomposition[] {
  const results: Decomposition[] = [];
  const blocks: Block[] = [];
  const rec = (pair: Kind, start: number) => {
    let i = start;
    while (i < NUM_KINDS && c[i] === 0) i++;
    if (i >= NUM_KINDS) {
      results.push({ pair, blocks: blocks.slice() });
      return;
    }
    if (c[i] >= 3) {
      c[i] -= 3;
      blocks.push({ type: 'koutsu', kind: i });
      rec(pair, i);
      blocks.pop();
      c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      blocks.push({ type: 'shuntsu', kind: i });
      rec(pair, i);
      blocks.pop();
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
  };
  for (let p = 0; p < NUM_KINDS; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      rec(p, 0);
      c[p] += 2;
    }
  }
  return results;
}

/** 九種九牌の条件（么九牌が 9 種類以上）を満たすか */
export function countYaochuKinds(c: Counts): number {
  return YAOCHU_KINDS.filter((k) => c[k] > 0).length;
}

/**
 * 向聴数（あと何枚替えれば聴牌か。0 = 聴牌、-1 = 和了）。
 * CPU の思考や将来の学習用の特徴量に使う。
 */
export function shanten(c: Counts, meldCount: number): number {
  let best = standardShanten(c, meldCount);
  if (meldCount === 0) {
    best = Math.min(best, chiitoitsuShanten(c), kokushiShanten(c));
  }
  return best;
}

export function chiitoitsuShanten(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let i = 0; i < NUM_KINDS; i++) {
    if (c[i] > 0) kinds++;
    if (c[i] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

export function kokushiShanten(c: Counts): number {
  let kinds = 0;
  let pair = false;
  for (const k of YAOCHU_KINDS) {
    if (c[k] > 0) kinds++;
    if (c[k] >= 2) pair = true;
  }
  return 13 - kinds - (pair ? 1 : 0);
}

export function standardShanten(c: Counts, meldCount: number): number {
  let best = 8;
  const need = 4 - meldCount;
  // 面子・塔子を数え上げる素朴な探索
  const search = (i: number, mentsu: number, taatsu: number, hasPair: boolean) => {
    while (i < NUM_KINDS && c[i] === 0) i++;
    if (i >= NUM_KINDS) {
      let t = Math.min(taatsu, need - mentsu);
      const s = 2 * (need - mentsu) - t - (hasPair ? 1 : 0);
      if (s < best) best = s;
      return;
    }
    // 刻子
    if (c[i] >= 3 && mentsu < need) {
      c[i] -= 3;
      search(i, mentsu + 1, taatsu, hasPair);
      c[i] += 3;
    }
    // 順子
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0 && mentsu < need) {
      c[i]--;
      c[i + 1]--;
      c[i + 2]--;
      search(i, mentsu + 1, taatsu, hasPair);
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
    }
    // 雀頭
    if (c[i] >= 2 && !hasPair) {
      c[i] -= 2;
      search(i, mentsu, taatsu, true);
      c[i] += 2;
    }
    // 対子を塔子として
    if (c[i] >= 2) {
      c[i] -= 2;
      search(i, mentsu, taatsu + 1, hasPair);
      c[i] += 2;
    }
    // 両面・辺張
    if (i < 27 && i % 9 <= 7 && c[i + 1] > 0) {
      c[i]--;
      c[i + 1]--;
      search(i, mentsu, taatsu + 1, hasPair);
      c[i]++;
      c[i + 1]++;
    }
    // 嵌張
    if (i < 27 && i % 9 <= 6 && c[i + 2] > 0) {
      c[i]--;
      c[i + 2]--;
      search(i, mentsu, taatsu + 1, hasPair);
      c[i]++;
      c[i + 2]++;
    }
    // 孤立牌として捨てる
    c[i]--;
    search(i, mentsu, taatsu, hasPair);
    c[i]++;
  };
  search(0, 0, 0, false);
  return best;
}
