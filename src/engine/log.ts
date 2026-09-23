// 牌譜（対局の完全な記録）
//
// 乱数の種と、全員の行動を起きた順に並べたもの。これを再生すれば対局を完全に再現できる。
// 学習に使う特徴量は、後から牌譜を再生しながら計算する（特徴量の設計を変えてもデータが無駄にならない）。

import { Game } from './game.ts';
import type { Rules } from './rules.ts';
import type { Action, FinalStanding, Seat } from './types.ts';

export const LOG_FORMAT = 'margin-log';
export const LOG_VERSION = 1;

export type LogEntry =
  /** 行動 */
  | { s: Seat; a: Action }
  /** 局の結果を確認して次の局へ */
  | { next: true };

export interface LogPlayer {
  name: string;
  /** 'human' | 'cpu:random' など */
  kind: string;
}

export interface GameLog {
  format: typeof LOG_FORMAT;
  version: typeof LOG_VERSION;
  seed: number;
  rules: Rules;
  players: LogPlayer[];
  startedAt: string;
  finishedAt?: string;
  entries: LogEntry[];
  standings?: FinalStanding[];
}

export function createLog(game: Game, players: LogPlayer[]): GameLog {
  return {
    format: LOG_FORMAT,
    version: LOG_VERSION,
    seed: game.seed,
    rules: game.rules,
    players,
    startedAt: new Date().toISOString(),
    entries: [],
  };
}

/**
 * 牌譜を再生する。onStep は各行動の直前に呼ばれる（学習データの抽出に使う）。
 */
export function replay(log: GameLog, onStep?: (game: Game, entry: LogEntry) => void): Game {
  const game = new Game({ seed: log.seed, rules: log.rules });
  for (const e of log.entries) {
    onStep?.(game, e);
    if ('next' in e) game.nextRound();
    else game.apply(e.s, e.a);
  }
  return game;
}
