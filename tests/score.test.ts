import { describe, expect, it } from 'vitest';
import { evaluateWin, payments, type WinContext } from '../src/engine/score.ts';
import { EAST, SOUTH, kindOf, parseTiles } from '../src/engine/tile.ts';
import type { Meld } from '../src/engine/types.ts';
import { isTenpai, shanten, toCounts, waitingKinds } from '../src/engine/hand.ts';

/** テスト用に和了の状況を組み立てる。hand は和了牌を含む */
function ctx(hand: string, win: string, over: Partial<WinContext> = {}): WinContext {
  const tiles = parseTiles(hand);
  const winTile = parseTiles(win)[0];
  // parseTiles は独立に ID を割り当てるので、手牌の中から同じ種類の牌を和了牌として使う
  const wt = tiles.find((t) => kindOf(t) === kindOf(winTile))!;
  return {
    hand: tiles,
    melds: [],
    winTile: wt,
    tsumo: false,
    seatWind: SOUTH,
    roundWind: EAST,
    riichi: false,
    doubleRiichi: false,
    ippatsu: false,
    haitei: false,
    houtei: false,
    rinshan: false,
    chankan: false,
    tenhou: false,
    chiihou: false,
    doraIndicators: parseTiles('7z'), // ドラ = 白
    uraIndicators: [],
    aka: true,
    kuitan: true,
    yakumanCompound: true,
    ...over,
  };
}

function meld(type: Meld['type'], s: string, used: string): Meld {
  // 手牌と ID が重ならないよう、使用済みの牌を先に確保してから割り当てる
  const all = parseTiles(used + s);
  const tiles = all.slice(parseTiles(used).length);
  return { type, tiles, calledTile: type === 'ankan' ? undefined : tiles[0], from: type === 'ankan' ? undefined : 0 };
}

const names = (r: ReturnType<typeof evaluateWin>) => r!.yaku.map((y) => y.name);

describe('点数計算', () => {
  it('立直・門前ツモ・平和 20符3翻（子 700-1300）', () => {
    const r = evaluateWin(ctx('234m456p678s23s99m4s', '4s', { tsumo: true, riichi: true }));
    expect(names(r)).toEqual(['立直', '門前清自摸和', '平和']);
    expect(r!.fu).toBe(20);
    expect(r!.han).toBe(3);
    const p = payments(r!.basePoints, false, true);
    expect([p.nonDealerPays, p.dealerPays]).toEqual([700, 1300]);
  });

  it('門前ロンの平和 30符', () => {
    const r = evaluateWin(ctx('234m456p678s23s99m1s', '1s'));
    expect(names(r)).toEqual(['平和']);
    expect(r!.fu).toBe(30);
    expect(payments(r!.basePoints, false, false).total).toBe(1000);
  });

  it('喰いタン 30符1翻 1000点', () => {
    const c = ctx('345m678s44s66m6m', '6m', { melds: [meld('pon', '222p', '345m678s44s666m')] });
    const r = evaluateWin(c);
    expect(names(r)).toEqual(['断幺九']);
    expect(r!.fu).toBe(30);
    expect(payments(r!.basePoints, false, false).total).toBe(1000);
  });

  it('喰いタンなしのルールでは副露したタンヤオは役なし', () => {
    const c = ctx('345m678s44s66m6m', '6m', { kuitan: false, melds: [meld('pon', '222p', '345m678s44s666m')] });
    expect(evaluateWin(c)).toBeNull();
  });

  it('役牌・暗刻・嵌張の符計算 40符1翻 1300点', () => {
    const r = evaluateWin(ctx('777z123m456p13s99s2s', '2s'));
    expect(names(r)).toEqual(['役牌 中']);
    expect(r!.fu).toBe(40);
    expect(payments(r!.basePoints, false, false).total).toBe(1300);
  });

  it('七対子 25符2翻 1600点', () => {
    const r = evaluateWin(ctx('11m33m55p77p99s22z4z4z', '4z'));
    expect(names(r)).toContain('七対子');
    expect(r!.fu).toBe(25);
    expect(payments(r!.basePoints, false, false).total).toBe(1600);
  });

  it('二盃口は七対子より高く取る', () => {
    const r = evaluateWin(ctx('223344m556677p88s', '8s'));
    expect(names(r)).toContain('二盃口');
    expect(names(r)).not.toContain('七対子');
  });

  it('清一色（副露）5翻 満貫 8000点', () => {
    const c = ctx('234m456m777m99m', '9m', { melds: [meld('chi', '789m', '234m456m777m99m')] });
    const r = evaluateWin(c);
    expect(names(r)).toContain('清一色');
    expect(r!.limitName).toBe('満貫');
    expect(payments(r!.basePoints, false, false).total).toBe(8000);
  });

  it('一気通貫・三色同順', () => {
    const a = evaluateWin(ctx('123456789m234p55s', '5s', { riichi: true }));
    expect(names(a)).toContain('一気通貫');
    const b = evaluateWin(ctx('123m123p123s789m55s', '5s', { riichi: true }));
    expect(names(b)).toContain('三色同順');
  });

  it('対々和・三暗刻（シャンポンのロンは明刻扱い）', () => {
    const r = evaluateWin(ctx('111m999p555s22z33z3z', '3z', { melds: [] }));
    // 111m 999p 555s は暗刻、南(22z)は対子、北3z をロン → 明刻
    expect(names(r)).toContain('三暗刻');
    expect(names(r)).not.toContain('四暗刻');
  });

  it('四暗刻（ツモ）は役満', () => {
    const r = evaluateWin(ctx('111m999p555s22z33z3z', '3z', { tsumo: true }));
    expect(names(r)).toContain('四暗刻');
    expect(r!.yakuman).toBe(1);
    expect(payments(r!.basePoints, false, true).total).toBe(32000);
  });

  it('国士無双 子 32000 / 親 48000', () => {
    const r = evaluateWin(ctx('19m19p19s1234567z1m', '1m'));
    expect(names(r)).toEqual(['国士無双']);
    expect(payments(r!.basePoints, false, false).total).toBe(32000);
    expect(payments(r!.basePoints, true, false).total).toBe(48000);
  });

  it('大三元＋字一色は複合でダブル役満', () => {
    const r = evaluateWin(ctx('555z666z777z111z2z2z', '2z', { tsumo: true }));
    expect(names(r)).toEqual(expect.arrayContaining(['大三元', '字一色', '四暗刻']));
    expect(r!.yakuman).toBe(3);
  });

  it('役がなければ null', () => {
    // 西家・東場で南の刻子は役牌ではない
    const c = ctx('123m456p11z22z2z', '2z', { seatWind: 29, melds: [meld('chi', '789s', '123m456p11z222z')] });
    expect(evaluateWin(c)).toBeNull();
  });

  it('ドラ・赤ドラ・裏ドラを数える', () => {
    const r = evaluateWin(
      ctx('234m406p678s23s99m4s', '4s', {
        riichi: true,
        doraIndicators: parseTiles('8m'), // ドラ 9m
        uraIndicators: parseTiles('1m'), // 裏ドラ 2m
      }),
    );
    expect(r!.dora).toBe(2);
    expect(r!.akadora).toBe(1);
    expect(r!.uradora).toBe(1);
  });

  it('跳満・倍満の基本点', () => {
    const r = evaluateWin(ctx('11122233344455m', '5m', { tsumo: true, riichi: true }));
    // 清一色・門前ツモ・立直など → 倍満以上
    expect(r!.basePoints).toBeGreaterThanOrEqual(4000);
  });
});

describe('待ち・向聴数', () => {
  it('九蓮宝燈の 9 面待ち', () => {
    const c = toCounts(parseTiles('1112345678999m'));
    expect(waitingKinds(c, false)).toHaveLength(9);
  });

  it('聴牌判定と向聴数', () => {
    expect(isTenpai(toCounts(parseTiles('234m456p678s23s99m')), false)).toBe(true);
    expect(shanten(toCounts(parseTiles('234m456p678s23s99m')), 0)).toBe(0);
    expect(shanten(toCounts(parseTiles('19m19p19s1234567z')), 0)).toBe(0);
    expect(shanten(toCounts(parseTiles('147m258p369s1234z')), 0)).toBeGreaterThan(3);
  });
});
