// CPU・人間・通信相手をまとめて扱うための共通の形。
// 「見えている情報（PlayerView）と選べる行動 → 行動」を返すだけにしておくと、
// ランダム CPU も将来の学習済み CPU も同じように差し替えられる。

import type { Action } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';

export interface Agent {
  /** 牌譜に記録する種類（'human', 'cpu:random' など） */
  readonly kind: string;
  decide(view: PlayerView, legal: Action[]): Action | Promise<Action>;
  /** 局の結果を確認したら resolve する（CPU は即座に） */
  acknowledge?(view: PlayerView): Promise<void>;
}
