// 最初の CPU：和了できるときは和了し、それ以外はランダムに捨てる。鳴き・リーチはしない。

import type { Action } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { Agent } from './agent.ts';

export class RandomAgent implements Agent {
  readonly kind = 'cpu:random';
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  decide(_view: PlayerView, legal: Action[]): Action {
    const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
    if (win) return win;
    const discards = legal.filter((a) => a.type === 'discard' && !a.riichi);
    if (discards.length) return discards[Math.floor(this.rand() * discards.length)];
    return legal.find((a) => a.type === 'pass') ?? legal[0];
  }
}
