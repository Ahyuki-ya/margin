import type { Kind, Tile } from './tile.ts';

export type Seat = 0 | 1 | 2 | 3;
export const SEATS: readonly Seat[] = [0, 1, 2, 3];

export type MeldType = 'chi' | 'pon' | 'minkan' | 'ankan' | 'kakan';

export interface Meld {
  type: MeldType;
  /** 面子を構成する牌（鳴いた牌も含む） */
  tiles: Tile[];
  /** 他家から鳴いた牌（暗槓では undefined） */
  calledTile?: Tile;
  /** 鳴いた相手の席 */
  from?: Seat;
}

/** プレイヤーが選べる行動 */
export type Action =
  | { type: 'discard'; tile: Tile; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ankan'; kind: Kind }
  | { type: 'kakan'; tile: Tile }
  | { type: 'kyuushu' }
  | { type: 'ron' }
  | { type: 'pon'; tiles: [Tile, Tile] }
  | { type: 'chi'; tiles: [Tile, Tile] }
  | { type: 'minkan' }
  | { type: 'pass' };

export type ActionType = Action['type'];

export interface DiscardInfo {
  tile: Tile;
  /** ツモ切りか */
  tsumogiri: boolean;
  /** リーチ宣言牌か */
  riichi: boolean;
  /** 鳴かれた場合、鳴いた席 */
  calledBy?: Seat;
}

export type AbortReason = 'kyuushu' | 'suufon' | 'suucha' | 'suukaikan' | 'sanchahou';
export type DrawReason = 'exhaustive' | AbortReason;

export interface YakuItem {
  name: string;
  han: number;
  /** 役満のとき倍数（通常役では 0） */
  yakuman?: number;
}

export interface ScoreResult {
  yaku: YakuItem[];
  han: number;
  fu: number;
  /** 役満の倍数（0 なら通常役） */
  yakuman: number;
  /** 基本点（fu × 2^(han+2)、満貫以上は固定値） */
  basePoints: number;
  /** 満貫・跳満などの名称（それ未満は空文字） */
  limitName: string;
  dora: number;
  uradora: number;
  akadora: number;
}

export interface WinInfo {
  seat: Seat;
  /** ロンなら放銃者、ツモなら undefined */
  from?: Seat;
  hand: Tile[];
  melds: Meld[];
  winTile: Tile;
  score: ScoreResult;
  /** この和了で受け取る点数（本場・供託を含む） */
  gain: number;
  uraIndicators: Tile[];
  /** 包（パオ）の責任者 */
  pao?: Seat;
}

export type RoundResult =
  | {
      type: 'win';
      wins: WinInfo[];
      deltas: [number, number, number, number];
      renchan: boolean;
    }
  | {
      type: 'draw';
      reason: DrawReason;
      /** 流局時に聴牌していたか（途中流局では空） */
      tenpai: boolean[];
      /** 公開する手牌（聴牌者など） */
      hands: (Tile[] | null)[];
      nagashi: Seat[];
      deltas: [number, number, number, number];
      renchan: boolean;
    };

export interface FinalStanding {
  seat: Seat;
  rank: number;
  score: number;
  /** ウマ・オカ込みの最終ポイント */
  points: number;
}
