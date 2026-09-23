// 少しだけ考える CPU：向聴数（聴牌までの距離）が最も小さくなる牌を捨てる。
// 聴牌したらリーチし、和了できれば和了する。鳴きは役牌のポンだけ。

import { shanten, toCounts } from '../engine/hand.ts';
import { isDragon, isYaochu, kindOf, type Tile } from '../engine/tile.ts';
import type { Action } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { Agent } from './agent.ts';

export class GreedyAgent implements Agent {
  readonly kind = 'cpu:greedy';
  private rand: () => number;

  constructor(rand: () => number = Math.random) {
    this.rand = rand;
  }

  decide(view: PlayerView, legal: Action[]): Action {
    const win = legal.find((a) => a.type === 'tsumo' || a.type === 'ron');
    if (win) return win;
    const me = view.players[view.seat];
    const hand = me.hand ?? [];
    const meldCount = me.melds.length;

    // 役牌のポン（自風・場風・三元牌）
    const pon = legal.find((a) => a.type === 'pon');
    if (pon && pon.type === 'pon') {
      const k = kindOf(pon.tiles[0]);
      const valuable = isDragon(k) || k === me.seatWind || k === 27 + view.roundWind;
      if (valuable) return pon;
    }
    if (legal.some((a) => a.type === 'pass')) return { type: 'pass' };

    const discards = legal.filter((a): a is Extract<Action, { type: 'discard' }> => a.type === 'discard');
    if (discards.length === 0) return legal[0];

    // リーチできるなら、リーチ後の向聴数が 0 になる牌でリーチ
    const riichi = discards.filter((a) => a.riichi);
    if (riichi.length) return riichi[Math.floor(this.rand() * riichi.length)];

    let best: typeof discards = [];
    let bestScore = Infinity;
    for (const a of discards) {
      if (a.riichi) continue;
      const rest = removeTile(hand, a.tile);
      // 向聴数が同じなら么九牌・孤立牌を優先して捨てる
      const s = shanten(toCounts(rest), meldCount) * 10 + (isYaochu(kindOf(a.tile)) ? 0 : 1);
      if (s < bestScore) {
        bestScore = s;
        best = [a];
      } else if (s === bestScore) {
        best.push(a);
      }
    }
    return best[Math.floor(this.rand() * best.length)];
  }
}

function removeTile(hand: Tile[], t: Tile): Tile[] {
  const i = hand.indexOf(t);
  return [...hand.slice(0, i), ...hand.slice(i + 1)];
}
