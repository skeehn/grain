import { expect, test } from 'bun:test';
import { withInactivityTimeout } from '../src/agent/loop.js';

test('agent stream cancellation interrupts a stalled provider', async () => {
  const controller = new AbortController();
  const stalled: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      return { next: () => new Promise<IteratorResult<string>>(() => {}) };
    },
  };
  const consume = (async () => { for await (const _ of withInactivityTimeout(stalled, 60_000, controller.signal)) {} })();
  controller.abort();
  await expect(consume).rejects.toThrow('SIGINT');
});
