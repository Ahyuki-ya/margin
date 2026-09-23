// CPU 同士の自己対戦。将来の強化学習でデータを集める土台。
//
//   npm run selfplay -- --games 100 --cpu strong,strong,greedy,greedy --out logs/selfplay
//
// 重みを変えた版を比べるとき：--cpu strong,strongB,strong,strongB --paramsB '{"pushDanger":3}' --mirror
//   --mirror は同じ牌山で席を 1 つずらした対局も打ち、配牌の運の偏りを打ち消す
//
// 牌譜は 1 行 1 対局の JSON Lines で保存する（--out を省略すると保存しない）。

import { mkdirSync, createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { Agent } from '../src/ai/agent.ts';
import { makeCpu, parseCpuLevel } from '../src/ai/index.ts';
import { StrongAgent } from '../src/ai/strong.ts';
import { Game } from '../src/engine/game.ts';
import { createLog } from '../src/engine/log.ts';
import { Rng } from '../src/engine/rng.ts';
import type { Action, Seat } from '../src/engine/types.ts';
import { viewFor } from '../src/engine/view.ts';

const { values } = parseArgs({
  options: {
    games: { type: 'string', default: '20' },
    cpu: { type: 'string', default: 'greedy,greedy,greedy,greedy' },
    seed: { type: 'string', default: '1' },
    length: { type: 'string', default: 'hanchan' },
    out: { type: 'string' },
    paramsB: { type: 'string', default: '{}' },
    mirror: { type: 'boolean', default: false },
  },
});

const games = Number(values.games);
const kinds = values.cpu!.split(',');
if (kinds.length !== 4) throw new Error('--cpu は 4 つ指定してください（例: greedy,greedy,random,random）');
const baseSeed = Number(values.seed);

let out: ReturnType<typeof createWriteStream> | undefined;
if (values.out) {
  mkdirSync(values.out, { recursive: true });
  const file = join(values.out, `selfplay-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
  out = createWriteStream(file);
  console.log(`牌譜の保存先: ${file}`);
}

// 席ごとの成績（席の並びによる有利不利を避けるため、対局ごとに打ち手を回す）
const stats = kinds.map(() => ({
  games: 0,
  rankSum: 0,
  points: 0,
  top: 0,
  rounds: 0,
  wins: 0,
  winPoints: 0,
  dealIns: 0,
  riichi: 0,
  called: 0,
}));
const t0 = performance.now();

for (let g = 0; g < games; g++) {
  const seed = (baseSeed + (values.mirror ? g >> 1 : g)) >>> 0;
  const rng = new Rng(seed ^ 0x9e3779b9);
  const rand = () => rng.next();
  const makeAgent = (k: string): Agent =>
    k === 'strongB' ? new StrongAgent(rand, JSON.parse(values.paramsB!)) : makeCpu(parseCpuLevel(k), rand);
  // 打ち手 i が座る席 = (i + g) % 4
  const agents: Agent[] = new Array(4);
  const owner: number[] = new Array(4);
  kinds.forEach((k, i) => {
    const seat = (i + g) % 4;
    agents[seat] = makeAgent(k);
    owner[seat] = i;
  });
  const game = new Game({ seed, rules: { length: values.length === 'tonpuu' ? 'tonpuu' : 'hanchan' } });
  const log = createLog(
    game,
    agents.map((a, s) => ({ name: `${kinds[owner[s]]}#${owner[s]}`, kind: a.kind })),
  );
  while (!game.isOver()) {
    if (game.phase === 'roundEnd') {
      const r = game.result!;
      for (let seat = 0; seat < 4; seat++) {
        const st = stats[owner[seat]];
        const p = game.players[seat];
        st.rounds++;
        if (p.discards.some((d) => d.riichi)) st.riichi++;
        if (p.melds.some((m) => m.type !== 'ankan')) st.called++;
      }
      if (r.type === 'win') {
        for (const w of r.wins) {
          stats[owner[w.seat]].wins++;
          stats[owner[w.seat]].winPoints += w.gain;
        }
        const from = r.wins[0].from;
        if (from !== undefined) stats[owner[from]].dealIns++;
      }
      log.entries.push({ next: true });
      game.nextRound();
      continue;
    }
    for (const seat of game.pendingSeats()) {
      const legal = game.legalActions(seat);
      const a = legal.length === 1 ? legal[0] : (agents[seat].decide(viewFor(game, seat), legal) as Action);
      log.entries.push({ s: seat as Seat, a });
      game.apply(seat, a);
      if (game.phase !== 'response' && game.phase !== 'chankan') break;
    }
  }
  log.finishedAt = new Date().toISOString();
  log.standings = game.standings;
  out?.write(JSON.stringify(log) + '\n');
  for (const st of game.standings!) {
    const s = stats[owner[st.seat]];
    s.games++;
    s.rankSum += st.rank;
    s.points += st.points;
    if (st.rank === 1) s.top++;
  }
}

out?.end();
const sec = (performance.now() - t0) / 1000;
console.log(`${games} 対局 / ${sec.toFixed(1)} 秒（${((sec / games) * 1000).toFixed(0)} ms/対局）`);
const pct = (a: number, b: number) => `${((a / b) * 100).toFixed(1)}%`.padStart(6);
console.log('打ち手        平均順位 トップ率 平均pt   和了率 放銃率 平均打点 リーチ率 副露率');
// 同じ打ち手の種類はまとめて集計する
for (const k of [...new Set(kinds)]) {
  const s = kinds
    .map((x, i) => (x === k ? stats[i] : null))
    .filter((x) => x !== null)
    .reduce((a, b) => {
      for (const key of Object.keys(a) as (keyof typeof a)[]) a[key] += b[key];
      return a;
    }, { ...stats[0], games: 0, rankSum: 0, points: 0, top: 0, rounds: 0, wins: 0, winPoints: 0, dealIns: 0, riichi: 0, called: 0 });
  console.log(
    [
      k.padEnd(12),
      (s.rankSum / s.games).toFixed(3).padStart(7),
      pct(s.top, s.games),
      (s.points / s.games).toFixed(1).padStart(7),
      pct(s.wins, s.rounds),
      pct(s.dealIns, s.rounds),
      String(Math.round(s.winPoints / Math.max(1, s.wins))).padStart(7),
      pct(s.riichi, s.rounds),
      pct(s.called, s.rounds),
    ].join('  '),
  );
}
