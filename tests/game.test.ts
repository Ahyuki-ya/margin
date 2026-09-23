import { describe, expect, it } from 'vitest';
import { Game } from '../src/engine/game.ts';
import { replay, type GameLog, LOG_FORMAT, LOG_VERSION } from '../src/engine/log.ts';
import { Rng } from '../src/engine/rng.ts';
import type { Action, Seat } from '../src/engine/types.ts';
import { viewFor } from '../src/engine/view.ts';
import { GreedyAgent } from '../src/ai/greedy.ts';

/**
 * 選べる行動から一様ランダムに選ぶ打ち手で最後まで対局する。
 * リーチ・鳴き・槓・見逃しなどあらゆる分岐を通すための試験用。
 */
function playRandomGame(
  seed: number,
  rules = {},
  check?: (g: Game) => void,
  /** 向聴数で打つ確率（残りはあらゆる行動から一様ランダム） */
  greedyRate = 0.5,
): { game: Game; log: GameLog; counts: Record<string, number> } {
  const game = new Game({ seed, rules });
  const rng = new Rng(seed ^ 0x5bd1e995);
  const greedy = new GreedyAgent(() => rng.next());
  const log: GameLog = {
    format: LOG_FORMAT,
    version: LOG_VERSION,
    seed,
    rules: game.rules,
    players: [],
    startedAt: '',
    entries: [],
  };
  const counts: Record<string, number> = {};
  let steps = 0;
  while (!game.isOver()) {
    if (++steps > 20000) throw new Error('終わらない');
    if (game.phase === 'roundEnd') {
      const r = game.result!;
      const key = r.type === 'win' ? `win:${r.wins.length}` : `draw:${r.reason}`;
      counts[key] = (counts[key] ?? 0) + 1;
      log.entries.push({ next: true });
      game.nextRound();
      continue;
    }
    for (const seat of game.pendingSeats()) {
      const legal = game.legalActions(seat);
      assert(legal.length > 0, '選べる行動がない');
      // 和了は常に選び、それ以外はランダム（和了がほぼ起きないと検査にならないため）
      const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
      let a: Action;
      if (win && rng.next() < 0.9) a = win;
      else if (rng.next() < greedyRate) a = greedy.decide(viewFor(game, seat), legal);
      else a = legal[rng.int(legal.length)];
      log.entries.push({ s: seat as Seat, a });
      game.apply(seat, a);
      const key = a.type === 'discard' && a.riichi ? 'riichi' : a.type;
      counts[key] = (counts[key] ?? 0) + 1;
      check?.(game);
      if (game.phase !== 'response' && game.phase !== 'chankan') break;
    }
  }
  return { game, log, counts };
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** 毎手番の検査（expect は遅いので普通の比較で行う） */
function checkInvariants(g: Game) {
  // 点数の合計は常に一定
  const total = g.players.reduce((s, p) => s + p.score, 0) + g.riichiSticks * 1000;
  assert(total === 100000, `点数の合計が ${total}`);
  if (g.phase === 'gameEnd' || g.phase === 'roundEnd') return;
  // 手牌の枚数：鳴き・槓を考慮して 13 枚相当か 14 枚相当
  g.players.forEach((p, i) => {
    const n = p.hand.length + p.melds.length * 3;
    const isActing = g.phase === 'turn' && g.current === i;
    assert(n === (isActing ? 14 : 13), `席 ${i} の手牌が ${n} 枚相当`);
  });
  // 牌が重複していない
  const seen = new Set<number>();
  for (const p of g.players) {
    for (const t of [...p.hand, ...p.melds.flatMap((m) => m.tiles), ...p.discards.filter((d) => d.calledBy === undefined).map((d) => d.tile)]) {
      assert(!seen.has(t), `牌 ${t} が重複`);
      seen.add(t);
    }
  }
}

describe('対局の進行', () => {
  it('ランダムな行動で 100 半荘を最後まで打てる（点数の保存・手牌枚数・重複なし）', () => {
    const total: Record<string, number> = {};
    for (let seed = 1; seed <= 100; seed++) {
      const { game, counts } = playRandomGame(seed, {}, checkInvariants);
      expect(game.standings).toHaveLength(4);
      const pts = game.standings!.reduce((s, x) => s + x.points, 0);
      expect(Math.abs(pts)).toBeLessThan(1e-6);
      for (const [k, v] of Object.entries(counts)) total[k] = (total[k] ?? 0) + v;
    }
    // リーチ・鳴き・槓・流局などが実際に起きていること
    for (const k of ['pon', 'chi', 'minkan', 'ankan', 'kakan', 'ron', 'tsumo', 'riichi', 'draw:exhaustive']) {
      expect(total[k] ?? 0, k).toBeGreaterThan(0);
    }
    console.log('行動・結果の回数', total);
  }, 300_000);

  it('向聴数で打つ CPU 同士でも点数の保存などが保たれる', () => {
    const total: Record<string, number> = {};
    for (let seed = 500; seed < 520; seed++) {
      const { counts } = playRandomGame(seed, {}, checkInvariants, 1);
      for (const [k, v] of Object.entries(counts)) total[k] = (total[k] ?? 0) + v;
    }
    expect(total['riichi']).toBeGreaterThan(10);
    expect(total['win:1']).toBeGreaterThan(50);
  }, 120_000);

  it('牌譜を再生すると同じ結果になる', () => {
    for (let seed = 1000; seed < 1020; seed++) {
      const { game, log } = playRandomGame(seed, { length: 'tonpuu' });
      const re = replay(JSON.parse(JSON.stringify(log)));
      expect(re.standings).toEqual(game.standings);
    }
  }, 60_000);

  it('東風戦・赤なしでも動く', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { game } = playRandomGame(seed, { length: 'tonpuu', aka: false }, checkInvariants);
      expect(game.isOver()).toBe(true);
    }
  }, 60_000);
});
