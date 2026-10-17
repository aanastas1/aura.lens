export const HELP_SILENCE_MS = 3000;
const WAIT_FOR_SPEECH_MS = 12000;
export type HelpVoicePhase =
  | 'idle'
  | 'permission'
  | 'listening'
  | 'stopping'
  | 'thinking'
  | 'speaking';
type Ports = {
  prepare: () => Promise<void>;
  start: () => void;
  stop: () => void;
  abort: () => void;
  stopSpeaking: () => Promise<void>;
  speak: (text: string, done: () => void, failed: () => void) => void;
  answer: (text: string, signal: AbortSignal) => Promise<string>;
  phase: (phase: HelpVoicePhase) => void;
  transcript: (text: string) => void;
  response: (text: string) => void;
  error: (text: string) => void;
};

// Owns one SOS listening/answering loop; cancellation also invalidates pending permissions and TTS.
export function createHelpConversation(ports: Ports) {
  let phase: HelpVoicePhase = 'idle';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let segments: string[] = [];
  let partial = '';
  let silentRetries = 0;
  const text = () => [...segments, partial].filter(Boolean).join(' ').trim();
  const transition = (next: HelpVoicePhase) => {
    phase = next;
    ports.phase(next);
  };
  const cancel = () => {
    generation++;
    clearTimeout(timer);
    request?.abort();
    request = undefined;
    transition('idle');
    ports.abort();
    void ports.stopSpeaking().catch(() => {});
  };
  const fail = (message: string) => {
    cancel();
    ports.error(message);
  };
  const speak = (message: string) => {
    const id = generation;
    transition('speaking');
    ports.response(message);
    ports.speak(
      message,
      () => {
        if (id === generation && phase === 'speaking') void listen();
      },
      () => {
        if (id === generation)
          fail('Nie mogę odczytać odpowiedzi. Możesz ją przeczytać i wpisać odpowiedź.');
      },
    );
  };
  const finish = async () => {
    if (phase !== 'listening' && phase !== 'stopping') return;
    clearTimeout(timer);
    const question = text();
    if (!question) {
      if (silentRetries++ === 0) speak('Nie usłyszałam. Powiedz, co się stało.');
      else fail('Nie słyszę odpowiedzi. Włącz mikrofon ponownie albo wpisz opis.');
      return;
    }
    silentRetries = 0;
    transition('thinking');
    const id = generation;
    const controller = new AbortController();
    request = controller;
    timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await ports.answer(question, controller.signal);
      if (id !== generation) return;
      clearTimeout(timer);
      request = undefined;
      speak(response);
    } catch (error) {
      if (id !== generation) return;
      fail(
        controller.signal.aborted
          ? 'Odpowiedź trwa za długo. Spróbuj ponownie.'
          : error instanceof Error
            ? error.message
            : 'Nie mogę uzyskać odpowiedzi. Spróbuj ponownie.',
      );
    }
  };
  const stop = () => {
    if (phase !== 'listening') return;
    clearTimeout(timer);
    transition('stopping');
    // Keep accepting final recognition results until native recognition has ended.
    timer = setTimeout(() => {
      ports.abort();
      void finish();
    }, 1500);
    ports.stop();
  };
  const armSilence = () => {
    clearTimeout(timer);
    timer = setTimeout(stop, text() ? HELP_SILENCE_MS : WAIT_FOR_SPEECH_MS);
  };
  async function listen() {
    const id = ++generation;
    transition('permission');
    ports.error('');
    try {
      await ports.stopSpeaking();
      if (id !== generation) return;
      await ports.prepare();
      if (id !== generation) return;
      segments = [];
      partial = '';
      transition('listening');
      ports.start();
      armSilence();
    } catch (error) {
      if (id === generation)
        fail(
          error instanceof Error
            ? error.message
            : 'Nie mogę włączyć mikrofonu. Możesz wpisać opis.',
        );
    }
  }
  return {
    start() {
      silentRetries = 0;
      void listen();
    },
    cancel,
    stop,
    submit(value: string) {
      cancel();
      segments = [];
      partial = value.trim();
      if (!partial) return;
      transition('stopping');
      void finish();
    },
    result(value: string, final: boolean) {
      if (phase !== 'listening' && phase !== 'stopping') return;
      if (final) {
        if (value.trim()) segments.push(value.trim());
        partial = '';
      } else partial = value.trim();
      ports.transcript(text());
      if (phase === 'listening') armSilence();
    },
    speechStart() {
      if (phase === 'listening') clearTimeout(timer);
    },
    speechEnd() {
      if (phase === 'listening') armSilence();
    },
    end() {
      void finish();
    },
    error(code: string) {
      if (phase !== 'listening' && phase !== 'stopping') return;
      if (code === 'no-speech') {
        void finish();
        return;
      }
      fail(
        code === 'not-allowed'
          ? 'Zezwól na mikrofon albo wpisz opis.'
          : 'Nie udało się usłyszeć całego opisu. Możesz go wpisać.',
      );
    },
  };
}
