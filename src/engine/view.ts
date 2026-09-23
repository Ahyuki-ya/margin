// プレイヤーから見える情報だけを取り出す（他家の手牌は隠す）。
// 画面の描画・LAN 通信・CPU の入力に共通で使う。

import type { Game, Phase } from './game.ts';
import type { Rules } from './rules.ts';
import type { Kind, Tile } from './tile.ts';
import type { DiscardInfo, FinalStanding, Meld, RoundResult, Seat } from './types.ts';

export interface PlayerPublic {
  /** 自分の手牌のみ。他家は null */
  hand: Tile[] | null;
  handCount: number;
  melds: Meld[];
  discards: DiscardInfo[];
  score: number;
  riichi: boolean;
  seatWind: Kind;
}

export interface PlayerView {
  seat: Seat;
  phase: Phase;
  rules: Rules;
  roundWind: number;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  dealer: Seat;
  current: Seat;
  liveRemaining: number;
  doraIndicators: Tile[];
  /** 自分の手番でツモった牌 */
  drawnTile?: Tile;
  /** 応答待ちの牌 */
  pendingTile?: { tile: Tile; from: Seat; kan: boolean };
  players: PlayerPublic[];
  result?: RoundResult;
  standings?: FinalStanding[];
}

export function viewFor(game: Game, seat: Seat): PlayerView {
  return {
    seat,
    phase: game.phase,
    rules: game.rules,
    roundWind: game.roundWind,
    kyoku: game.kyoku,
    honba: game.honba,
    riichiSticks: game.riichiSticks,
    dealer: game.dealer,
    current: game.current,
    liveRemaining: game.liveRemaining,
    doraIndicators: game.doraIndicators,
    drawnTile: game.phase === 'turn' && game.current === seat ? game.drawnTile : undefined,
    pendingTile: game.pendingTile,
    players: game.players.map((p, i) => ({
      hand: i === seat ? p.hand.slice() : null,
      handCount: p.hand.length,
      melds: p.melds.map((m) => ({ ...m, tiles: m.tiles.slice() })),
      discards: p.discards.map((d) => ({ ...d })),
      score: p.score,
      riichi: p.riichi,
      seatWind: game.seatWind(i as Seat),
    })),
    result: game.result,
    standings: game.standings,
  };
}
