// 人間の打ち手（ブラウザの画面・LAN の通信の両方で使う）

import { sameAction } from '../engine/game.ts';
import type { Action } from '../engine/types.ts';
import type { PlayerView } from '../engine/view.ts';
import type { Agent } from './agent.ts';

export interface Prompt {
  /** 同じ問いに二重に答えないための番号 */
  id: number;
  legal: Action[];
}

/** 人間の打ち手。問い（Prompt）を出して、画面や通信からの答えを待つ */
export class PromptAgent implements Agent {
  readonly kind = 'human';
  prompt: Prompt | null = null;
  ackId: number | null = null;
  private resolveAction: ((a: Action) => void) | null = null;
  private resolveAck: (() => void) | null = null;
  private counter = 0;
  onChange: () => void = () => {};

  decide(_view: PlayerView, legal: Action[]): Promise<Action> {
    return new Promise((resolve) => {
      this.prompt = { id: ++this.counter, legal };
      this.resolveAction = resolve;
      this.onChange();
    });
  }

  acknowledge(): Promise<void> {
    return new Promise((resolve) => {
      this.ackId = ++this.counter;
      this.resolveAck = resolve;
      this.onChange();
    });
  }

  /** 答えを受け取る。古い問いへの答えや、選べない行動は無視する */
  answer(id: number, a: Action) {
    if (!this.prompt || this.prompt.id !== id) return;
    if (!this.prompt.legal.some((x) => sameAction(x, a))) return;
    const r = this.resolveAction;
    this.prompt = null;
    this.resolveAction = null;
    r?.(a);
  }

  ack(id: number) {
    if (this.ackId !== id) return;
    const r = this.resolveAck;
    this.ackId = null;
    this.resolveAck = null;
    r?.();
  }
}

