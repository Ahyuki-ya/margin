// ブラウザだけで完結する CPU 対戦

import type { Agent } from '../ai/agent.ts';
import { makeCpu, type CpuLevel } from '../ai/index.ts';
import type { Game } from '../engine/game.ts';
import type { GameLog } from '../engine/log.ts';
import { randomSeed } from '../engine/rng.ts';
import type { Rules } from '../engine/rules.ts';
import type { Seat } from '../engine/types.ts';
import { viewFor } from '../engine/view.ts';
import { GameRunner } from '../runner.ts';
import { announceText } from './announce.ts';
import { TableUI } from './table.ts';
import { PromptAgent } from '../ai/prompt.ts';

export type { CpuLevel };

export interface LocalOptions {
  rules: Partial<Rules>;
  cpu: CpuLevel;
  cpuDelay: number;
  onExit: () => void;
}

export function startLocalGame(root: HTMLElement, opts: LocalOptions) {
  const human = new PromptAgent();
  const humanSeat = Math.floor(Math.random() * 4) as Seat;
  const agents: Agent[] = [0, 1, 2, 3].map((s) => (s === humanSeat ? human : makeCpu(opts.cpu)));
  let n = 0;
  const names = agents.map((a) => (a === human ? 'あなた' : `CPU ${++n}`));

  let runner: GameRunner;
  const ui = new TableUI(root, {
    onAction: (id, a) => human.answer(id, a),
    onAck: (id) => human.ack(id),
    onExit: () => {
      runner.stop();
      ui.destroy();
      opts.onExit();
    },
    onSaveLog: () => downloadLog(runner.log),
  });

  const draw = (game: Game) => {
    ui.render({
      view: viewFor(game, humanSeat),
      names,
      prompt: human.prompt,
      ack: human.ackId,
    });
  };

  runner = new GameRunner({
    seed: randomSeed(),
    rules: opts.rules,
    agents,
    names,
    cpuDelay: opts.cpuDelay,
    onUpdate: (game, last) => {
      draw(game);
      if (last) {
        const text = announceText(last.action);
        if (text) ui.announce(last.seat, text);
      }
    },
  });
  human.onChange = () => draw(runner.game);
  runner.run().catch((e) => {
    console.error(e);
    alert(`エラーが発生しました: ${e instanceof Error ? e.message : e}`);
  });
}

export function downloadLog(log: GameLog) {
  const blob = new Blob([JSON.stringify(log)], { type: 'application/json' });
  const a = document.createElement('a');
  const stamp = (log.finishedAt ?? log.startedAt).replace(/[:.]/g, '-');
  a.href = URL.createObjectURL(blob);
  a.download = `margin-log-${stamp}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
