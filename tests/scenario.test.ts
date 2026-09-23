// 牌山を指定して、特定のルールの場面を再現するテスト
import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game.ts';
import { isRedTile, kindOf, parseTiles, type Tile } from '../src/engine/tile.ts';
import type { Action, Seat } from '../src/engine/types.ts';

/**
 * 牌山を組み立てる（親は席 0）。
 * hands: 各席の配牌 13 枚、draws: ツモ順に並べた牌、dora: ドラ表示牌
 */
function buildWall(hands: string[], draws: string, dora = '9s'): Tile[] {
  const used = new Set<Tile>();
  const take = (s: string): Tile[] =>
    parseTiles(s).map((t) => {
      const k = kindOf(t);
      const red = isRedTile(t);
      for (let c = 0; c < 4; c++) {
        const id = k * 4 + c;
        if (!used.has(id) && isRedTile(id) === red) {
          used.add(id);
          return id;
        }
      }
      throw new Error(`${s} の牌が足りません`);
    });
  const wall: (Tile | undefined)[] = new Array(136).fill(undefined);
  const hs = hands.map(take);
  hs.forEach((h, i) => expect(h, `席 ${i} の配牌`).toHaveLength(13));
  for (let r = 0; r < 3; r++) {
    for (let seat = 0; seat < 4; seat++) {
      for (let j = 0; j < 4; j++) wall[r * 16 + seat * 4 + j] = hs[seat][r * 4 + j];
    }
  }
  for (let seat = 0; seat < 4; seat++) wall[48 + seat] = hs[seat][12];
  take(draws).forEach((t, i) => (wall[52 + i] = t));
  wall[122] = take(dora)[0];
  // 残りの牌で埋める（赤 5 は使わず、普通の牌を優先して並べる）
  const rest: Tile[] = [];
  for (let id = 0; id < 136; id++) if (!used.has(id)) rest.push(id);
  let p = 0;
  for (let i = 0; i < 136; i++) if (wall[i] === undefined) wall[i] = rest[p++];
  return wall as Tile[];
}

function newGame(hands: string[], draws: string, opts: { dora?: string; scores?: number[] } = {}) {
  return new Game({ seed: 1, walls: [buildWall(hands, draws, opts.dora)], scores: opts.scores });
}

function act(g: Game, seat: number, pred: (a: Action) => boolean) {
  const a = g.legalActions(seat as Seat).find(pred);
  if (!a) throw new Error(`席 ${seat} に該当する行動がありません: ${JSON.stringify(g.legalActions(seat as Seat))}`);
  g.apply(seat as Seat, a);
}

const code = (s: string) => kindOf(parseTiles(s)[0]);

/** 指定した種類の牌を捨てる */
function discard(g: Game, seat: number, tile: string, riichi = false) {
  act(g, seat, (a) => a.type === 'discard' && kindOf(a.tile) === code(tile) && !!a.riichi === riichi);
}

/** 応答待ちの全員が見送る */
function passAll(g: Game) {
  while (g.phase === 'response' || g.phase === 'chankan') {
    for (const s of g.pendingSeats()) g.apply(s, { type: 'pass' });
  }
}

/** ツモ切りして、応答は全員見送る */
function tsumogiri(g: Game, seat: number) {
  expect(g.current).toBe(seat);
  act(g, seat, (a) => a.type === 'discard' && a.tile === g.drawnTile && !a.riichi);
  passAll(g);
}

const canRon = (g: Game, seat: number) => g.legalActions(seat as Seat).some((a) => a.type === 'ron');

// 席 1 は 23m 待ち（1m-4m）。4m ならタンヤオがつく
const S1_TANYAO = '23m456p678p234s55s';
// ほかの席は対子のない、鳴けない手
const S0 = '1m9m2p5p8p1s6s9s1z2z3z4z6z'; // 么九牌 9 種（九種九牌の確認にも使う）
const S2 = '1p9p1s7s9s5z7z8m6m9m4z3z2z';
const S3 = '9m1m7p9p8s1s1z2z3z5z6z7z3p';

describe('フリテン', () => {
  it('自分の捨て牌に待ち牌があるとロンできない', () => {
    // 席 1 が 1m をツモ切り → 席 2 の 4m はロンできない
    const g = newGame([S0, S1_TANYAO, S2, S3], '4z 1m 4m');
    tsumogiri(g, 0);
    // 1m でもツモ和了はできるが、あえてツモ切りしてフリテンにする
    expect(g.legalActions(1).some((a) => a.type === 'tsumo')).toBe(true);
    tsumogiri(g, 1);
    discard(g, 2, '4m');
    expect(g.phase).toBe('turn');
    expect(g.current).toBe(3);
  });

  it('見逃すと自分が次に捨てるまでロンできない（同巡内フリテン）', () => {
    // 席 2 の 4m を見逃す → 席 3 の 4m もロンできない → 自分が捨てた後の 4m はロンできる
    const g = newGame([S0, S1_TANYAO, S2, S3], '4z 5z 4m 4m 6z 7z 1z 4m');
    tsumogiri(g, 0);
    tsumogiri(g, 1);
    discard(g, 2, '4m');
    expect(canRon(g, 1)).toBe(true);
    g.apply(1, { type: 'pass' });
    discard(g, 3, '4m');
    expect(g.phase).toBe('turn'); // 席 1 には選択肢が出ない
    tsumogiri(g, 0);
    tsumogiri(g, 1);
    tsumogiri(g, 2);
    discard(g, 3, '4m');
    expect(canRon(g, 1)).toBe(true);
  });
});

describe('リーチ', () => {
  it('ダブル立直・一発・供託', () => {
    const g = newGame([S0, S1_TANYAO, S2, S3], '4z 5z 4m');
    tsumogiri(g, 0);
    act(g, 1, (a) => a.type === 'discard' && a.riichi === true && kindOf(a.tile) === code('5z'));
    passAll(g);
    expect(g.players[1].riichi).toBe(true);
    expect(g.riichiSticks).toBe(1);
    discard(g, 2, '4m');
    act(g, 1, (a) => a.type === 'ron');
    const r = g.result!;
    expect(r.type).toBe('win');
    if (r.type !== 'win') return;
    const names = r.wins[0].score.yaku.map((y) => y.name);
    expect(names).toEqual(expect.arrayContaining(['ダブル立直', '一発', '断幺九']));
    // 供託 1000 点も受け取る
    expect(r.wins[0].gain).toBe(r.deltas[1]);
    expect(r.deltas[2]).toBe(-(r.deltas[1] - 1000));
    expect(g.riichiSticks).toBe(0);
  });

  it('リーチ宣言牌でロンされたらリーチは不成立で供託もない', () => {
    // 席 1 は国士無双の聴牌になる 4m 切りでリーチ宣言 → 4m 待ちの席 2 がロン
    const S1 = '4m9m1p9p1s9s5z6z7z1z2z3z4z';
    const S2_WAIT = '23m456p678p234s66s';
    const g = newGame([S0, S1, S2_WAIT, S3], '4z 5z');
    tsumogiri(g, 0);
    discard(g, 1, '4m', true);
    act(g, 2, (a) => a.type === 'ron');
    expect(g.players[1].riichi).toBe(false);
    expect(g.riichiSticks).toBe(0);
    const r = g.result!;
    expect(r.type === 'win' && r.wins[0].seat).toBe(2);
    expect(r.deltas.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('ダブロン', () => {
  it('2 人がロンし、供託は放銃者から見て近い方が受け取る', () => {
    // 席 1 と席 3 が 4m 待ち。席 1 はリーチして供託を出す。席 2 の 4m に 2 人がロン
    const S3_WAIT = '23m456s678s234p77p';
    const g = newGame([S0, S1_TANYAO, S2, S3_WAIT], '4z 5z 4m');
    tsumogiri(g, 0);
    act(g, 1, (a) => a.type === 'discard' && a.riichi === true);
    passAll(g);
    discard(g, 2, '4m');
    expect(g.pendingSeats().sort()).toEqual([1, 3]);
    g.apply(1, { type: 'ron' });
    g.apply(3, { type: 'ron' });
    const r = g.result!;
    expect(r.type).toBe('win');
    if (r.type !== 'win') return;
    expect(r.wins.map((w) => w.seat)).toEqual([3, 1]); // 席 2 の下家（席 3）が先
    const w3 = r.wins[0];
    const w1 = r.wins[1];
    // 供託は席 3 が受け取る
    expect(w3.gain % 1000).toBe(0);
    expect(r.deltas[2]).toBe(-(w3.gain - 1000) - w1.gain);
    expect(r.deltas.reduce((a, b) => a + b, 0)).toBe(1000);
  });
});

describe('包（パオ）', () => {
  it('大三元の 3 つ目を鳴かせた人がツモの支払いを全額負う', () => {
    // 席 1 が白・發・中を順にポン。中を捨てた席 3 が包。最後に 5p を単騎でツモ
    const S1 = '5z5z6z6z7z7z2m3m4m5p8s9s1s';
    const P0 = '1m9m2p5p8p1s6s9s1z2z3z4z3m';
    const P2 = '1p9p7s8m6m9m4z3z2z4p7p2s5s';
    const P3 = '7p9p8s1z2z3z3p6p5s8m2p4s9s';
    const g = newGame([P0, S1, P2, P3], '5z 1p 6z 1z 7z 2z 3z 4z 5p', { dora: '9s' });
    // 席 0：白をツモって切る → 席 1 ポン → 8s 切り
    discard(g, 0, '5z');
    act(g, 1, (a) => a.type === 'pon');
    passAll(g);
    discard(g, 1, '8s');
    passAll(g);
    // 席 2：1p ツモ切り、席 3：發をツモって切る → 席 1 ポン → 9s 切り
    tsumogiri(g, 2);
    discard(g, 3, '6z');
    act(g, 1, (a) => a.type === 'pon');
    passAll(g);
    discard(g, 1, '9s');
    passAll(g);
    // 席 2：1z ツモ切り、席 3：中をツモって切る → 席 1 ポン（包は席 3）→ 1s 切り
    tsumogiri(g, 2);
    discard(g, 3, '7z');
    act(g, 1, (a) => a.type === 'pon');
    passAll(g);
    expect(g.players[1].pao?.seat).toBe(3);
    discard(g, 1, '1s');
    passAll(g);
    tsumogiri(g, 2);
    tsumogiri(g, 3);
    tsumogiri(g, 0);
    act(g, 1, (a) => a.type === 'tsumo');
    const r = g.result!;
    expect(r.type).toBe('win');
    if (r.type !== 'win') return;
    expect(r.wins[0].score.yaku.map((y) => y.name)).toContain('大三元');
    expect(r.wins[0].pao).toBe(3);
    expect(r.deltas).toEqual([0, 32000, 0, -32000]);
  });
});

describe('流局', () => {
  it('九種九牌を選ぶと途中流局で親が続く', () => {
    const g = newGame([S0, S1_TANYAO, S2, S3], '5z');
    act(g, 0, (a) => a.type === 'kyuushu');
    const r = g.result!;
    expect(r.type === 'draw' && r.reason).toBe('kyuushu');
    g.nextRound();
    expect(g.kyoku).toBe(0);
    expect(g.honba).toBe(1);
  });
});
