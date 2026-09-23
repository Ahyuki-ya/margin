import { describe, expect, it } from 'vitest';
import { makeCpu, type CpuLevel } from '../src/ai/index.ts';
import { Game } from '../src/engine/game.ts';
import { Rng } from '../src/engine/rng.ts';
import type { Seat } from '../src/engine/types.ts';
import { viewFor } from '../src/engine/view.ts';

/** CPU 同士で最後まで打ち、選んだ行動が常に合法で、点数が保存されることを確かめる */
function play(levels: CpuLevel[], seed: number) {
  const rng = new Rng(seed);
  const agents = levels.map((l) => makeCpu(l, () => rng.next()));
  const g = new Game({ seed, rules: { length: 'tonpuu' } });
  while (!g.isOver()) {
    if (g.phase === 'roundEnd') {
      g.nextRound();
      continue;
    }
    for (const s of g.pendingSeats()) {
      const legal = g.legalActions(s);
      const a = agents[s].decide(viewFor(g, s as Seat), legal);
      if (a instanceof Promise) throw new Error('CPU は同期で答える');
      g.apply(s, a); // 不正な行動なら例外になる
      const total = g.players.reduce((x, p) => x + p.score, 0) + g.riichiSticks * 1000;
      if (total !== 100000) throw new Error(`点数の合計が ${total}`);
      if (g.phase !== 'response' && g.phase !== 'chankan') break;
    }
  }
  return g;
}

describe('CPU', () => {
  it('つよい CPU 同士で東風戦を 20 回打ち切れる', () => {
    for (let seed = 1; seed <= 20; seed++) expect(play(['strong', 'strong', 'strong', 'strong'], seed).isOver()).toBe(true);
  }, 120_000);

  it('強さの違う CPU が混ざっても打ち切れる', () => {
    for (let seed = 100; seed < 110; seed++) expect(play(['strong', 'greedy', 'random', 'strong'], seed).isOver()).toBe(true);
  }, 120_000);
});
