// CPU の強さと打ち手の対応
import type { Agent } from './agent.ts';
import { GreedyAgent } from './greedy.ts';
import { RandomAgent } from './random.ts';
import { StrongAgent } from './strong.ts';

export type CpuLevel = 'random' | 'greedy' | 'strong';

export const CPU_LABELS: Record<CpuLevel, string> = {
  random: 'よわい',
  greedy: 'ふつう',
  strong: 'つよい',
};

export function makeCpu(level: CpuLevel, rand: () => number = Math.random): Agent {
  if (level === 'random') return new RandomAgent(rand);
  if (level === 'greedy') return new GreedyAgent(rand);
  return new StrongAgent(rand);
}

export function parseCpuLevel(s: unknown): CpuLevel {
  return s === 'random' || s === 'greedy' ? s : 'strong';
}
