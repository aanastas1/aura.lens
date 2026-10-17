import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

const { jest } = require('bun:test') as {
  jest: { useFakeTimers(): void; useRealTimers(): void; advanceTimersByTime(ms: number): void };
};

import {
  createHelpConversation,
  HELP_SILENCE_MS,
  type HelpVoicePhase,
} from '@/src/helpConversation';

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(overrides: Partial<Parameters<typeof createHelpConversation>[0]> = {}) {
  const phases: HelpVoicePhase[] = [];
  const questions: string[] = [];
  const errors: string[] = [];
  let starts = 0;
  let stops = 0;
  let done = () => {};
  const voice = createHelpConversation({
    prepare: async () => {},
    start: () => {
      starts++;
    },
    stop: () => {
      stops++;
    },
    abort: () => {},
    stopSpeaking: async () => {},
    speak: (_text, callback) => {
      done = callback;
    },
    answer: async (text) => {
      questions.push(text);
      return 'Co się stało?';
    },
    phase: (phase) => phases.push(phase),
    transcript: () => {},
    response: () => {},
    error: (error) => {
      if (error) errors.push(error);
    },
    ...overrides,
  });
  return {
    voice,
    phases,
    questions,
    errors,
    starts: () => starts,
    stops: () => stops,
    done: () => done(),
  };
}
afterEach(() => jest.useRealTimers());
describe('SOS voice conversation', () => {
  it('listens immediately, resets the silence timer, sends final text once, then listens after TTS', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.voice.start();
    await flush();
    assert.equal(s.starts(), 1);
    s.voice.result('Nie wiem', false);
    jest.advanceTimersByTime(2000);
    s.voice.result('Nie wiem gdzie', false);
    jest.advanceTimersByTime(HELP_SILENCE_MS - 1);
    assert.equal(s.stops(), 0);
    jest.advanceTimersByTime(1);
    assert.equal(s.stops(), 1);
    s.voice.result('Nie wiem gdzie jestem', true);
    s.voice.end();
    s.voice.end();
    await flush();
    assert.deepEqual(s.questions, ['Nie wiem gdzie jestem']);
    assert.equal(s.phases.at(-1), 'speaking');
    assert.equal(s.starts(), 1);
    s.done();
    await flush();
    assert.equal(s.starts(), 2);
    s.voice.result('Przy parku', true);
    s.voice.end();
    await flush();
    assert.deepEqual(s.questions, ['Nie wiem gdzie jestem', 'Przy parku']);
    s.voice.cancel();
  });
  it('finishes even when native recognition does not emit end, and cancels a queued TTS restart', async () => {
    jest.useFakeTimers();
    const s = setup();
    s.voice.start();
    await flush();
    s.voice.result('Zgubiłam się', false);
    jest.advanceTimersByTime(HELP_SILENCE_MS + 1500);
    await flush();
    assert.deepEqual(s.questions, ['Zgubiłam się']);
    s.voice.cancel();
    s.done();
    await flush();
    assert.equal(s.starts(), 1);
    assert.equal(s.phases.at(-1), 'idle');
  });
  it('cancels pending microphone permission without restarting recognition', async () => {
    let allow = () => {};
    const permission = new Promise<void>((resolve) => {
      allow = resolve;
    });
    const s = setup({ prepare: () => permission });
    s.voice.start();
    await flush();
    s.voice.cancel();
    allow();
    await flush();
    assert.equal(s.starts(), 0);
  });
  it('aborts the assistant and ignores late answers after leaving SOS description', async () => {
    let answer = (_value: string) => {};
    let signal: AbortSignal | undefined;
    const s = setup({
      answer: (_text, value) => {
        signal = value;
        return new Promise((resolve) => {
          answer = resolve;
        });
      },
    });
    s.voice.submit('Potrzebuję pomocy');
    await flush();
    s.voice.cancel();
    answer('Gdzie jesteś?');
    await flush();
    assert.equal(signal?.aborted, true);
    assert.equal(s.phases.at(-1), 'idle');
  });
  it('asks again on silence but pauses after another empty response', async () => {
    const s = setup();
    s.voice.start();
    await flush();
    s.voice.end();
    assert.equal(s.phases.at(-1), 'speaking');
    s.done();
    await flush();
    s.voice.end();
    assert.deepEqual(s.questions, []);
    assert.equal(s.errors.length, 1);
    assert.equal(s.phases.at(-1), 'idle');
  });
  it('accepts typed answers when microphone access is denied', async () => {
    const s = setup({
      prepare: async () => {
        throw new Error('Brak mikrofonu');
      },
    });
    s.voice.start();
    await flush();
    assert.deepEqual(s.errors, ['Brak mikrofonu']);
    s.voice.submit('Zgubiłam się');
    await flush();
    assert.deepEqual(s.questions, ['Zgubiłam się']);
    s.voice.cancel();
  });
});
