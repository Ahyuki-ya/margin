import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptAgent } from '../src/ai/prompt.ts';
import { Game } from '../src/engine/game.ts';
import { viewFor } from '../src/engine/view.ts';

describe('持ち時間', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const g = new Game({ seed: 3 });
    const seat = g.current;
    return { view: viewFor(g, seat), legal: g.legalActions(seat), drawn: g.drawnTile };
  };

  it('1 手ごとの時間を超えた分だけ予備の時間が減る', async () => {
    const agent = new PromptAgent({ perAction: 15000, bank: 30000 });
    const { view, legal } = setup();
    const p1 = agent.decide(view, legal);
    expect(agent.prompt?.time).toEqual({ perAction: 15000, bank: 30000 });
    vi.advanceTimersByTime(20000); // 5 秒超過
    agent.answer(agent.prompt!.id, legal[0]);
    await p1;
    agent.decide(view, legal);
    expect(agent.prompt?.time).toEqual({ perAction: 15000, bank: 25000 });
    // 1 手ごとの時間内に答えれば予備は減らない
    vi.advanceTimersByTime(3000);
    agent.answer(agent.prompt!.id, legal[0]);
    agent.decide(view, legal);
    expect(agent.prompt?.time?.bank).toBe(25000);
    agent.dispose();
  });

  it('時間切れならツモ切りし、予備の時間は 0 になる', async () => {
    const agent = new PromptAgent({ perAction: 15000, bank: 30000 });
    const { view, legal, drawn } = setup();
    const p = agent.decide(view, legal);
    vi.advanceTimersByTime(45000);
    const a = await p;
    expect(a).toEqual({ type: 'discard', tile: drawn });
    agent.decide(view, legal);
    expect(agent.prompt?.time?.bank).toBe(0);
    agent.dispose();
  });

  it('鳴きの確認は時間切れで見送り、局の結果は 1 手ごとの時間で自動で進む', async () => {
    const agent = new PromptAgent({ perAction: 15000, bank: 30000 });
    const { view } = setup();
    const p = agent.decide(view, [{ type: 'pon', tiles: [0, 1] }, { type: 'pass' }]);
    vi.advanceTimersByTime(45000);
    expect(await p).toEqual({ type: 'pass' });
    const ack = agent.acknowledge();
    expect(agent.ackTime).toBe(15000);
    vi.advanceTimersByTime(15000);
    await ack;
    expect(agent.ackId).toBeNull();
  });

  it('持ち時間なしなら待ち続ける', () => {
    const agent = new PromptAgent();
    const { view, legal } = setup();
    agent.decide(view, legal);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(agent.prompt).not.toBeNull();
    expect(agent.prompt?.time).toBeUndefined();
  });
});
