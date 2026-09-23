// 人間の打ち手（ブラウザの画面・LAN の通信の両方で使う）

import { sameAction } from '../engine/game.ts';
import type { Action } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { Agent } from './agent.ts';

/**
 * 持ち時間。perAction は 1 手ごとに元に戻る時間、bank は対局を通して使い切る予備の時間（ミリ秒）。
 * 1 手ごとの時間を過ぎると予備の時間から減っていき、両方なくなると自動で打つ。
 */
export interface TimeControl {
  perAction: number;
  bank: number;
}

export type TimeKey = 'none' | '15+30' | '30+30' | '45+45';

export const TIME_CONTROLS: Record<TimeKey, TimeControl | null> = {
  none: null,
  '15+30': { perAction: 15000, bank: 30000 },
  '30+30': { perAction: 30000, bank: 30000 },
  '45+45': { perAction: 45000, bank: 45000 },
};

export const TIME_LABELS: Record<TimeKey, string> = {
  none: 'なし',
  '15+30': '15+30秒',
  '30+30': '30+30秒',
  '45+45': '45+45秒',
};

export function parseTimeKey(s: unknown): TimeKey {
  return s === '15+30' || s === '30+30' || s === '45+45' ? s : 'none';
}

export interface Prompt {
  /** 同じ問いに二重に答えないための番号 */
  id: number;
  legal: Action[];
  /** 問いを出した時点の残り時間（持ち時間ありのとき） */
  time?: TimeControl;
}

/** 時間切れのときの行動：見送り、またはツモ切り */
export function timeoutAction(view: PlayerView, legal: Action[]): Action {
  const pass = legal.find((a) => a.type === 'pass');
  if (pass) return pass;
  const discards = legal.filter((a) => a.type === 'discard' && !a.riichi);
  const tsumogiri = discards.find((a) => a.type === 'discard' && a.tile === view.drawnTile);
  return tsumogiri ?? discards[discards.length - 1] ?? legal[0];
}

/** 人間の打ち手。問い（Prompt）を出して、画面や通信からの答えを待つ */
export class PromptAgent implements Agent {
  readonly kind = 'human';
  prompt: Prompt | null = null;
  ackId: number | null = null;
  /** 局の結果の確認を自動で進めるまでの時間（持ち時間ありのとき） */
  ackTime: number | null = null;
  private resolveAction: ((a: Action) => void) | null = null;
  private resolveAck: (() => void) | null = null;
  private counter = 0;
  private time: TimeControl | null;
  private bankLeft: number;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  onChange: () => void = () => {};

  constructor(time: TimeControl | null = null) {
    this.time = time;
    this.bankLeft = time?.bank ?? 0;
  }

  decide(view: PlayerView, legal: Action[]): Promise<Action> {
    return new Promise((resolve) => {
      const id = ++this.counter;
      this.prompt = { id, legal };
      if (this.time) {
        this.prompt.time = { perAction: this.time.perAction, bank: this.bankLeft };
        this.startedAt = Date.now();
        this.timer = setTimeout(() => this.answer(id, timeoutAction(view, legal)), this.time.perAction + this.bankLeft);
      }
      this.resolveAction = resolve;
      this.onChange();
    });
  }

  acknowledge(): Promise<void> {
    return new Promise((resolve) => {
      const id = ++this.counter;
      this.ackId = id;
      if (this.time) {
        this.ackTime = this.time.perAction;
        this.timer = setTimeout(() => this.ack(id), this.time.perAction);
      }
      this.resolveAck = resolve;
      this.onChange();
    });
  }

  /** 答えを受け取る。古い問いへの答えや、選べない行動は無視する */
  answer(id: number, a: Action) {
    if (!this.prompt || this.prompt.id !== id) return;
    if (!this.prompt.legal.some((x) => sameAction(x, a))) return;
    this.clearTimer();
    if (this.time) {
      // 1 手ごとの時間を超えた分だけ予備の時間を減らす
      const over = Date.now() - this.startedAt - this.time.perAction;
      if (over > 0) this.bankLeft = Math.max(0, this.bankLeft - over);
    }
    const r = this.resolveAction;
    this.prompt = null;
    this.resolveAction = null;
    r?.(a);
  }

  ack(id: number) {
    if (this.ackId !== id) return;
    this.clearTimer();
    const r = this.resolveAck;
    this.ackId = null;
    this.ackTime = null;
    this.resolveAck = null;
    r?.();
  }

  /** 対局をやめるときに呼ぶ（時間切れの処理が後から走らないように） */
  dispose() {
    this.clearTimer();
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
