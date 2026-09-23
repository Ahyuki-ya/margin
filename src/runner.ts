// 対局の進行役。Game（ルール）と Agent（打ち手）をつなぎ、牌譜を記録する。
// ブラウザでの CPU 対戦と、LAN サーバーの両方で使う。

import type { Agent } from './ai/agent.ts';
import { Game } from './engine/game.ts';
import { createLog, type GameLog } from './engine/log.ts';
import type { Rules } from './engine/rules.ts';
import type { Action, Seat } from './engine/types.ts';
import { viewFor } from './engine/view.ts';

export interface RunnerOptions {
  seed: number;
  rules?: Partial<Rules>;
  agents: Agent[];
  names: string[];
  /** 状態が変わるたびに呼ばれる（画面の更新・通信） */
  onUpdate?: (game: Game, last?: { seat: Seat; action: Action }) => void;
  /** CPU の行動の前に入れる待ち時間（ミリ秒） */
  cpuDelay?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class GameRunner {
  readonly game: Game;
  readonly log: GameLog;
  private opts: RunnerOptions;
  private stopped = false;

  constructor(opts: RunnerOptions) {
    this.opts = opts;
    this.game = new Game({ seed: opts.seed, rules: opts.rules });
    this.log = createLog(
      this.game,
      opts.agents.map((a, i) => ({ name: opts.names[i], kind: a.kind })),
    );
  }

  stop() {
    this.stopped = true;
  }

  async run(): Promise<GameLog> {
    const { game, opts } = this;
    opts.onUpdate?.(game);
    while (!game.isOver() && !this.stopped) {
      if (game.phase === 'roundEnd') {
        await Promise.all(opts.agents.map((a, i) => a.acknowledge?.(viewFor(game, i as Seat))));
        if (this.stopped) break;
        this.log.entries.push({ next: true });
        game.nextRound();
        opts.onUpdate?.(game);
        continue;
      }
      const seats = game.pendingSeats();
      await Promise.all(
        seats.map(async (seat) => {
          const agent = opts.agents[seat];
          const legal = game.legalActions(seat);
          // 選択肢が 1 つしかなければ自動で選ぶ（リーチ後のツモ切りなど）
          let action: Action;
          if (legal.length === 1) {
            if (opts.cpuDelay && !agent.kind.startsWith('human')) await sleep(opts.cpuDelay);
            action = legal[0];
          } else {
            if (opts.cpuDelay && agent.kind.startsWith('cpu')) await sleep(opts.cpuDelay);
            action = await agent.decide(viewFor(game, seat), legal);
          }
          if (this.stopped) return;
          this.log.entries.push({ s: seat, a: action });
          game.apply(seat, action);
          opts.onUpdate?.(game, { seat, action });
        }),
      );
    }
    this.log.finishedAt = new Date().toISOString();
    this.log.standings = game.standings;
    return this.log;
  }
}
