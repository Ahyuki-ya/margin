// LAN 対戦でブラウザとホストのサーバーがやり取りするメッセージ

import type { Rules } from '../engine/rules.ts';
import type { Action, Seat } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { GameLog } from '../engine/log.ts';
import type { Prompt, TimeKey } from '../ai/prompt.ts';

import type { CpuLevel } from '../ai/index.ts';
export type { CpuLevel };

export type ClientMsg =
  /** 接続時の名乗り。token はブラウザごとに保存しておき、再接続で同じ席に戻るのに使う */
  | { t: 'hello'; token: string; name: string }
  | { t: 'start'; rules: Partial<Rules>; cpu: CpuLevel; time?: TimeKey }
  | { t: 'action'; id: number; action: Action }
  | { t: 'ack'; id: number };

export interface LobbyMember {
  name: string;
  online: boolean;
  you: boolean;
  host: boolean;
}

export type ServerMsg =
  | { t: 'lobby'; members: LobbyMember[]; host: boolean; running: boolean }
  | {
      t: 'state';
      view: PlayerView;
      names: string[];
      prompt: Prompt | null;
      ack: number | null;
      ackTime: number | null;
      waiting: boolean;
      last?: { seat: Seat; action: Action };
    }
  | { t: 'log'; log: GameLog }
  | { t: 'error'; message: string };

export const MAX_HUMANS = 4;
