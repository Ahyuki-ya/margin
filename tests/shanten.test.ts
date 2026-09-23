// 高速な向聴数計算を、素朴な全探索と突き合わせる
import { describe, expect, it } from 'vitest';
import { NUM_KINDS } from '../src/engine/tile.ts';
import { standardShanten, type Counts } from '../src/engine/hand.ts';
import { Rng } from '../src/engine/rng.ts';

/** 以前の実装（遅いが素直な全探索）。正解として使う */
function naiveShanten(c: Counts, meldCount: number): number {
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

describe('向聴数（高速版）', () => {
  it('ランダムな手牌 5000 通りで全探索と一致する', () => {
    const rng = new Rng(42);
    for (let n = 0; n < 5000; n++) {
      const meldCount = rng.int(4);
      const size = 13 - meldCount * 3 + rng.int(2); // 3n+1 枚または 3n+2 枚
      const wall = rng.shuffle(Array.from({ length: 136 }, (_, i) => i));
      // 同じ色に偏った手も混ぜる
      const pool = n % 3 === 0 ? wall.filter((t) => t >> 2 < 9 || t >> 2 >= 27) : wall;
      const c: Counts = new Array(NUM_KINDS).fill(0);
      for (const t of pool.slice(0, size)) c[t >> 2]++;
      expect(standardShanten(c.slice(), meldCount), JSON.stringify({ c, meldCount })).toBe(naiveShanten(c.slice(), meldCount));
    }
  });
});
