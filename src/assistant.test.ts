import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_ID, answerWithPhoto, createAssistantConversation } from './assistant';

const photo = 'data:image/jpeg;base64,/9j/2Q==';
const sse = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const chunk = (delta: object, finish_reason: string | null = null) => ({
  id: 'assistant-test', object: 'chat.completion.chunk', created: 1, model: MODEL_ID,
  choices: [{ index: 0, delta, finish_reason }],
});

describe('streaming assistant with a photo', () => {
  it('uses the hubmi model/settings and delivers text before the stream ends', async () => {
    const updates: string[] = [];
    let request: Record<string, any> = {};
    const fetcher: typeof fetch = async (_url, init) => {
      request = JSON.parse(String(init?.body));
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(sse(chunk({ role: 'assistant', content: 'Widzę ' }))));
          await new Promise(resolve => setTimeout(resolve, 30));
          assert.deepEqual(updates, ['Widzę ']);
          controller.enqueue(encoder.encode(sse(chunk({ content: 'krzesło.' }))));
          controller.enqueue(encoder.encode(sse(chunk({}, 'stop')) + 'data: [DONE]\n\n'));
          controller.close();
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    };
    const result = await answerWithPhoto('Co widzisz na zdjęciu?', photo, 'test-key', new AbortController().signal,
      value => updates.push(value), fetcher);
    assert.equal(result, 'Widzę krzesło.');
    assert.deepEqual(updates, ['Widzę ', 'Widzę krzesło.']);
    assert.equal(request.model, MODEL_ID);
    assert.equal(request.stream, true);
    assert.equal(request.provider.require_parameters, true);
    assert.equal(request.reasoning.effort, 'minimal');
    const userMessage = request.messages.find((message: { role: string }) => message.role === 'user');
    assert.deepEqual(userMessage.content, [
      { type: 'image_url', image_url: { url: photo } },
      { type: 'text', text: 'Co widzisz na zdjęciu?' },
    ]);
    const systemMessages = request.messages.filter((message: { role: string }) => message.role === 'system');
    assert.equal(systemMessages.length, 1);
    const instructions = systemMessages[0].content;
    const systemText = typeof instructions === 'string' ? instructions : instructions.map((part: { text: string }) => part.text).join('');
    assert.match(systemText, /Odpowiedz na pytanie/);
    assert.match(systemText, /prost/);
    assert.match(systemText, /ProwadźMnie/);
    assert.match(systemText, /zielonym świetle/);
    assert.match(systemText, /po polsku/);
    for (const fact of [
      'ma na imię Jadwiga',
      'Sanktuarium św. Andrzeja Boboli',
      'koleżanką Basią',
      'sąsiadką Danką',
      'Córka Jadwigi ma na imię Maria',
      '111-111-111',
      'ul. Racławicka 17, m. 14, 02-601 Warszawa',
    ]) {
      assert.equal(systemText.split(fact).length - 1, 1, `Profile fact appears exactly once: ${fact}`);
      assert.ok(!JSON.stringify(userMessage.content).includes(fact));
    }
  });

  it('reports provider failures instead of speaking partial output', async () => {
    const fetcher: typeof fetch = async () => new Response('{"error":{"message":"Invalid API key"}}', {
      status: 401, headers: { 'content-type': 'application/json' },
    });
    await assert.rejects(answerWithPhoto('Test', photo, 'invalid', new AbortController().signal, () => {}, fetcher), /OpenRouter/);
  });

  it('rejects a missing key before making a request', async () => {
    let called = false;
    const fetcher: typeof fetch = async () => { called = true; return new Response(); };
    await assert.rejects(answerWithPhoto('Test', photo, '', new AbortController().signal, () => {}, fetcher), /EXPO_PUBLIC_OPENROUTER_API_KEY/);
    assert.equal(called, false);
  });

  it('does not send a question without a captured photo', async () => {
    let called = false;
    const fetcher: typeof fetch = async () => { called = true; return new Response(); };
    await assert.rejects(answerWithPhoto('Test', '', 'test-key', new AbortController().signal, () => {}, fetcher), /Brak zdjęcia/);
    assert.equal(called, false);
  });

  it('does not accept truncated answers', async () => {
    const fetcher: typeof fetch = async () => new Response(
      sse(chunk({ content: 'Partial' })) + sse(chunk({}, 'length')) + 'data: [DONE]\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
    await assert.rejects(answerWithPhoto('Test', photo, 'test-key', new AbortController().signal, () => {}, fetcher), /pełnej odpowiedzi/);
  });
});

const completed = (text: string, reason = 'stop') => new Response(
  sse(chunk({ content: text })) + sse(chunk({}, reason)) + 'data: [DONE]\n\n',
  { headers: { 'content-type': 'text/event-stream' } },
);

const ask = (conversation: ReturnType<typeof createAssistantConversation>, text: string, fetcher: typeof fetch, image = photo, signal = new AbortController().signal) =>
  conversation.answerWithPhoto(text, image, 'test-key', signal, () => {}, fetcher);

describe('continuous conversation', () => {
  it('remembers text across questions but sends only the current photo and one system message', async () => {
    const conversation = createAssistantConversation();
    const requests: any[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return completed('Basia czeka pod kościołem.');
    };
    await ask(conversation, 'Gdzie czeka Basia?', fetcher);
    const newPhoto = 'data:image/jpeg;base64,/9j/3Q==';
    await ask(conversation, 'A z kim się spotykam?', fetcher, newPhoto);
    const messages = requests[1].messages;
    assert.equal(messages.filter((message: any) => message.role === 'system').length, 1);
    assert.equal(JSON.stringify(messages).split('ma na imię Jadwiga').length - 1, 1);
    assert.deepEqual(messages.slice(1, -1), [
      { role: 'user', content: 'Gdzie czeka Basia?' },
      { role: 'assistant', content: 'Basia czeka pod kościołem.' },
    ]);
    assert.ok(!JSON.stringify(messages).includes(photo));
    assert.equal(JSON.stringify(messages).split(newPhoto).length - 1, 1);
  });

  it('can explicitly create an isolated conversation with no history', async () => {
    const requests: any[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return completed('Dobrze.');
    };
    await ask(createAssistantConversation(), 'Poprzednia sesja.', fetcher);
    await ask(createAssistantConversation(), 'Nowa sesja.', fetcher);
    assert.equal(requests[1].messages.length, 2);
    assert.ok(!JSON.stringify(requests[1]).includes('Poprzednia sesja.'));
    assert.ok(JSON.stringify(requests[1]).includes('ma na imię Jadwiga'));
  });

  it('repeatedly merges old text into a summary, retaining six recent turns without photos', async () => {
    const conversation = createAssistantConversation();
    const questions = Array.from({ length: 9 }, (_, i) => `Pytanie ${i}: ${'a'.repeat(3500)}`);
    const summaries: any[] = [];
    const answers: any[] = [];
    const fetcher: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (JSON.stringify(request.messages[0]).includes('Streść dotychczasową rozmowę')) {
        summaries.push(JSON.parse(request.messages[1].content));
        assert.ok(!JSON.stringify(request).includes('image_url'));
        return completed(`Streszczenie numer ${summaries.length}.`);
      }
      answers.push(request);
      return completed('Odpowiedź.');
    };
    for (const question of questions) await ask(conversation, question, fetcher);
    assert.equal(summaries.length, 2);
    assert.equal(summaries[0].previousSummary, '');
    assert.deepEqual(summaries[0].olderTurns, [{ question: questions[0], answer: 'Odpowiedź.' }]);
    assert.equal(summaries[1].previousSummary, 'Streszczenie numer 1.');
    assert.deepEqual(summaries[1].olderTurns, [{ question: questions[1], answer: 'Odpowiedź.' }]);
    const lastMessages = answers.at(-1).messages;
    assert.ok(JSON.stringify(lastMessages).includes('Streszczenie numer 2.'));
    for (const question of questions.slice(2)) assert.ok(JSON.stringify(lastMessages).includes(question));
    assert.ok(!JSON.stringify(lastMessages).includes(questions[0]!));
    assert.equal(lastMessages.filter((message: any) => message.role === 'assistant').length, 6);
    assert.equal(lastMessages.flatMap((message: any) => Array.isArray(message.content) ? message.content : [])
      .filter((part: any) => part.type === 'image_url').length, 1);
    assert.equal(JSON.stringify(lastMessages).split('ma na imię Jadwiga').length - 1, 1);
  });

  it('preserves history when compression fails and retries without storing the failed question', async () => {
    const conversation = createAssistantConversation();
    const fetcher: typeof fetch = async () => completed('Dobrze.');
    for (let i = 0; i < 7; i++) await ask(conversation, `Pytanie ${i}: ${'a'.repeat(3500)}`, fetcher);
    const failure: typeof fetch = async () => completed('Niepełne streszczenie', 'length');
    await assert.rejects(ask(conversation, 'Nieudana próba', failure), /pełnej odpowiedzi/);
    let compressionInput: any;
    let answerRequest: any;
    const retry: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (JSON.stringify(request.messages[0]).includes('Streść dotychczasową rozmowę')) {
        compressionInput = JSON.parse(request.messages[1].content);
        return completed('Zachowane ustalenia.');
      }
      answerRequest = request;
      return completed('Gotowe.');
    };
    await ask(conversation, 'Ponowna próba', retry);
    assert.match(compressionInput.olderTurns[0].question, /^Pytanie 0:/);
    assert.ok(!JSON.stringify(answerRequest).includes('Nieudana próba'));
    assert.ok(JSON.stringify(answerRequest).includes('Zachowane ustalenia.'));
  });

  it('does not add truncated or cancelled turns to history', async () => {
    const conversation = createAssistantConversation();
    await ask(conversation, 'Dobre pytanie', async () => completed('Dobra odpowiedź.'));
    await assert.rejects(ask(conversation, 'Urwane pytanie', async () => completed('Urwana', 'length')), /pełnej odpowiedzi/);
    const controller = new AbortController();
    const cancelled: typeof fetch = async () => {
      controller.abort();
      return completed('Przerwana odpowiedź.');
    };
    await assert.rejects(ask(conversation, 'Anulowane pytanie', cancelled, photo, controller.signal));
    let request: any;
    await ask(conversation, 'Dalsze pytanie', async (_url, init) => {
      request = JSON.parse(String(init?.body));
      return completed('Dalej.');
    });
    const history = JSON.stringify(request.messages);
    assert.ok(history.includes('Dobre pytanie'));
    assert.ok(!history.includes('Urwane pytanie'));
    assert.ok(!history.includes('Anulowane pytanie'));
  });
});

describe('invitations in conversation memory', () => {
  it('remembers notifications received before the first question and during a streamed answer', async () => {
    const conversation = createAssistantConversation();
    const danka = { sender: 'Danka' as const, text: 'Jadwigo, zapraszam na ciasto w naszym bloku.', createdAt: 100 };
    const basia = { sender: 'Basia' as const, text: 'Jadwigo, czekam w parku na Starym Mokotowie.', createdAt: 200 };
    conversation.rememberInvitation(danka);
    let firstRequest: any;
    await ask(conversation, 'Kto mnie zaprasza?', async (_url, init) => {
      firstRequest = JSON.parse(String(init?.body));
      conversation.rememberInvitation(basia);
      return completed('Danka zaprasza na ciasto.');
    });
    assert.ok(JSON.stringify(firstRequest.messages).includes(danka.text));
    assert.ok(!JSON.stringify(firstRequest.messages).includes(basia.text));
    let nextRequest: any;
    await ask(conversation, 'A teraz?', async (_url, init) => {
      nextRequest = JSON.parse(String(init?.body));
      return completed('Basia zaprasza do parku.');
    });
    const messages = JSON.stringify(nextRequest.messages);
    assert.equal(messages.split(danka.text).length - 1, 1);
    assert.equal(messages.split(basia.text).length - 1, 1);
    assert.ok(messages.includes('nie wypowiedź Jadwigi'));
    assert.equal(nextRequest.messages.filter((message: any) => message.role === 'system').length, 1);
  });

  it('includes old invitations in compression input and keeps new events received during compression', async () => {
    const conversation = createAssistantConversation();
    const danka = { sender: 'Danka' as const, text: 'Zapraszam na ciasto.', createdAt: 100 };
    const basia = { sender: 'Basia' as const, text: 'Zapraszam do parku.', createdAt: 200 };
    conversation.rememberInvitation(danka);
    for (let i = 0; i < 7; i++) await ask(conversation, `Pytanie ${i}: ${'a'.repeat(3500)}`, async () => completed('Dobrze.'));
    let compressionInput: any;
    await ask(conversation, 'Kto zaprasza?', async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      if (JSON.stringify(request.messages[0]).includes('Streść dotychczasową rozmowę')) {
        compressionInput = JSON.parse(request.messages[1].content);
        conversation.rememberInvitation(basia);
        return completed('Danka zaprosiła Jadwigę na ciasto.');
      }
      return completed('Danka.');
    });
    assert.deepEqual(compressionInput.olderTurns[0], { notification: danka });
    let nextRequest: any;
    await ask(conversation, 'Czy Basia też?', async (_url, init) => {
      nextRequest = JSON.parse(String(init?.body));
      return completed('Tak.');
    });
    assert.ok(JSON.stringify(nextRequest.messages).includes(basia.text));
    assert.ok(JSON.stringify(nextRequest.messages).includes('Danka zaprosiła Jadwigę na ciasto.'));
  });
});

describe('navigation tool in the assistant conversation', () => {
  it('executes place search and walking route, includes live context, and keeps route outside compressed history', async () => {
    const origin = { latitude: 52.2, longitude: 21 };
    const end = { latitude: 52.201, longitude: 21 };
    let routeRequests = 0;
    const conversation = createAssistantConversation({
      async search() { return [{ id: 'pharmacy', name: 'Apteka', address: 'Testowa 1', location: end, openNow: true }]; },
      async route() {
        routeRequests++;
        return { distance: 111, durationSeconds: 120, warnings: [], steps: [{ instruction: 'Idź prosto ulicą Testową.', distance: 111, path: [origin, end] }] };
      },
    });
    conversation.navigation.updateLocation({ ...origin, accuracy: 5, timestamp: Date.now() });
    let calls = 0;
    const toolCall = (action: object) => new Response(
      sse(chunk({ tool_calls: [{ index: 0, id: `call-${calls}`, type: 'function', function: { name: 'navigation', arguments: JSON.stringify(action) } }] }))
      + sse(chunk({}, 'tool_calls')) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } },
    );
    const fetcher: typeof fetch = async (_url, init) => {
      const request = JSON.parse(String(init?.body));
      calls++;
      assert.equal(request.tools[0].function.name, 'navigation');
      assert.ok(JSON.stringify(request.messages[0]).includes('locationCurrent'));
      if (calls === 1) return toolCall({ action: 'search', query: 'apteka', openNow: true });
      if (calls === 2) {
        assert.ok(JSON.stringify(request.messages).includes('Testowa 1'));
        return toolCall({ action: 'start', placeId: 'pharmacy' });
      }
      assert.ok(JSON.stringify(request.messages).includes('route-1'));
      return completed('Idź prosto ulicą Testową.');
    };
    const response = await ask(conversation, 'Zaprowadź mnie do apteki', fetcher);
    assert.match(response, /Co dalej/);
    assert.equal(routeRequests, 1);
    // Force history compaction; the structured route must survive independently of its summary.
    for (let i = 0; i < 7; i++) await ask(conversation, `Temat ${i}: ${'a'.repeat(3500)}`, async () => completed('Dobrze.'));
    let last: any;
    await ask(conversation, 'Wróćmy do apteki', async (_url, init) => {
      last = JSON.parse(String(init?.body));
      return completed('Pamiętam drogę.');
    });
    assert.ok(JSON.stringify(last.messages[0]).includes('route-1'));
    assert.ok(JSON.stringify(last.messages[0]).includes('Idź prosto ulicą Testową.'));
    assert.equal(routeRequests, 1);
    assert.equal(conversation.navigation.context().currentRoute!.stepIndex, 0);
  });
});

describe('Google Maps isolation from everyday conversation', () => {
  it('never calls Google Maps for ordinary conversation or history compression', async () => {
    const { googleMapsProvider } = await import('./googleMaps');
    let mapsCalls = 0;
    const conversation = createAssistantConversation(googleMapsProvider('private-map-key', async () => {
      mapsCalls++;
      throw new Error('Google Maps must not be used for conversation');
    }));
    let routerCalls = 0;
    const router: typeof fetch = async (url, init) => {
      routerCalls++;
      assert.ok(String(url).includes('openrouter.ai'));
      assert.ok(!JSON.stringify(init).includes('private-map-key'));
      return completed('Dobrze, Jadwigo.');
    };
    for (let i = 0; i < 8; i++) await ask(conversation, `Pytanie o codzienne sprawy ${i}: ${'a'.repeat(3500)}`, router);
    assert.ok(routerCalls > 8, 'compression also goes through OpenRouter');
    assert.equal(mapsCalls, 0);
  });

  it('returns a map quota error to OpenRouter without moving the conversation away from OpenRouter', async () => {
    const { googleMapsProvider } = await import('./googleMaps');
    let mapsCalls = 0;
    const conversation = createAssistantConversation(googleMapsProvider('private-map-key', async () => {
      mapsCalls++;
      return new Response('private-map-key', { status: 429 });
    }));
    conversation.navigation.updateLocation({ latitude: 52.2, longitude: 21, timestamp: Date.now(), accuracy: 5 });
    let routerCalls = 0;
    const router: typeof fetch = async (url, init) => {
      assert.ok(String(url).includes('openrouter.ai'));
      const request = JSON.parse(String(init?.body));
      assert.ok(!JSON.stringify(request).includes('private-map-key'));
      if (++routerCalls === 1) return new Response(
        sse(chunk({ tool_calls: [{ index: 0, id: 'maps-search', type: 'function', function: { name: 'navigation', arguments: JSON.stringify({ action: 'search', query: 'apteka', openNow: true }) } }] }))
        + sse(chunk({}, 'tool_calls')) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } },
      );
      assert.ok(JSON.stringify(request.messages).includes('429'));
      return completed('Mapy są chwilowo niedostępne. Nadal możemy porozmawiać.');
    };
    assert.match(await ask(conversation, 'Znajdź drogę do apteki', router), /Nadal możemy porozmawiać/);
    assert.equal(mapsCalls, 1);
    assert.equal(routerCalls, 2);
    await ask(conversation, 'Jak ma na imię moja koleżanka?', async () => completed('Basia.'));
    assert.equal(mapsCalls, 1);
  });
});
