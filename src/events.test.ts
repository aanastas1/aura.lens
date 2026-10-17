import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createWarsawEvents, type EventsOrigin } from '@/src/events';

const NOW = Date.parse('2026-10-17T10:00:00+02:00');
const origin: EventsOrigin = {
  source: 'gps',
  coordinate: { latitude: 52.19902, longitude: 21.0197395 },
};
const signal = () => new AbortController().signal;
const occurrence = (from = '2026-10-17T11:00:00+02', to = '2026-10-17T12:00:00+02') => ({
  from,
  to,
  daily: false,
});
const feature = (latitude = 52.2, longitude = 21.02) => ({
  geometry: { type: 'Point', coordinates: [longitude, latitude] },
  properties: { district: 'Mokotów', shortStreetName: 'ul. Testowa', streetNumber: '1' },
});
const event = (title: string, overrides: object = {}) => ({
  title,
  url: `https://um.warszawa.pl/-/${title}`,
  language: 'pl_PL',
  occurrence: [occurrence()],
  address: [{ name: 'Dom kultury', street: 'Testowa 1' }],
  lead: 'Spotkanie &amp; rozmowa',
  text: '<p>Dla&nbsp;każdego.</p>',
  map: { features: [feature()] },
  category: [{ name: 'Kultura' }],
  ...overrides,
});
const response = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });

describe('Warsaw city events', () => {
  it('uses the official POST endpoint and raw Authorization token, returning compact text and coordinates', async () => {
    const provider = createWarsawEvents(
      'private-city-token',
      async (url, init) => {
        assert.equal(
          String(url),
          'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen',
        );
        assert.equal(init?.method, 'POST');
        assert.equal(new Headers(init?.headers).get('Authorization'), 'private-city-token');
        return response([event('Koncert')]);
      },
      () => NOW,
    );
    const result = await provider.search({}, origin, signal());
    assert.equal(result.events.length, 1);
    const item = result.events[0]!;
    assert.equal(item.description, 'Spotkanie & rozmowa Dla każdego.');
    assert.equal(item.start, '2026-10-17T09:00:00.000Z');
    assert.deepEqual(item.locations, [{ latitude: 52.2, longitude: 21.02 }]);
    assert.ok(item.distanceMeters! > 0 && item.distanceMeters! < 200);
    assert.ok(item.addresses.includes('ul. Testowa 1'));
    assert.ok(!JSON.stringify(result).includes('private-city-token'));
  });

  it('excludes ended occurrences and picks the next valid occurrence of recurring events', async () => {
    const rows = [
      event('Zakończone', {
        occurrence: [occurrence('2026-10-16T11:00:00+02', '2026-10-16T12:00:00+02')],
      }),
      event('Kończy się teraz', {
        occurrence: [occurrence('2026-10-17T09:00:00+02', '2026-10-17T10:00:00+02')],
      }),
      event('Cykliczne', {
        occurrence: [
          occurrence('2026-10-18T11:00:00+02', '2026-10-18T12:00:00+02'),
          occurrence('2026-10-16T11:00:00+02', '2026-10-16T12:00:00+02'),
          occurrence('2026-10-17T11:00:00+02', '2026-10-17T12:00:00+02'),
        ],
      }),
      event('Trwa', {
        occurrence: [{ from: '2026-10-01T00:00:00+02', to: '2026-10-31T23:59:59+01', daily: true }],
      }),
      event('Za miesiąc', {
        occurrence: [occurrence('2026-11-17T11:00:00+01', '2026-11-17T12:00:00+01')],
      }),
    ];
    const provider = createWarsawEvents(
      'key',
      async () => response(rows),
      () => NOW,
    );
    const result = await provider.search({ sort: 'time' }, origin, signal());
    assert.deepEqual(
      result.events.map((item) => item.title),
      ['Trwa', 'Cykliczne'],
    );
    assert.equal(result.events[0]!.ongoing, true);
    assert.equal(result.events[0]!.allDay, true);
    assert.equal(result.events[1]!.start, '2026-10-17T09:00:00.000Z');
  });

  it('checks end times again after loading and while reusing cached data', async () => {
    let clock = NOW;
    let requests = 0;
    const provider = createWarsawEvents(
      'key',
      async () => {
        requests++;
        clock += 2000;
        return response([
          event('Właśnie się skończyło', {
            occurrence: [occurrence('2026-10-17T09:00:00+02', '2026-10-17T10:00:01+02')],
          }),
          event('Jeszcze trwa', {
            occurrence: [occurrence('2026-10-17T09:00:00+02', '2026-10-17T10:01:00+02')],
          }),
        ]);
      },
      () => clock,
    );
    assert.deepEqual(
      (await provider.search({}, origin, signal())).events.map((item) => item.title),
      ['Jeszcze trwa'],
    );
    clock += 60000;
    assert.equal((await provider.search({}, origin, signal())).events.length, 0);
    assert.equal(requests, 1);
    clock += 10 * 60000;
    await provider.search({}, origin, signal());
    assert.equal(requests, 2);
  });

  it('ranks nearby events, handles missing or multiple locations and supports time and text filters', async () => {
    const rows = [
      event('Daleko', { map: { features: [feature(52.25, 21.1)] } }),
      event('Blisko', {
        occurrence: [occurrence('2026-10-18T11:00:00+02', '2026-10-18T12:00:00+02')],
      }),
      event('Bez GPS', { map: null, address: null }),
      event('Kilka lokalizacji', { map: { features: [feature(), feature(52.25, 21.1)] } }),
    ];
    const provider = createWarsawEvents(
      'key',
      async () => response(rows),
      () => NOW,
    );
    const nearby = await provider.search({}, origin, signal());
    assert.deepEqual(
      nearby.events.slice(0, 2).map((item) => item.title),
      ['Blisko', 'Daleko'],
    );
    assert.equal(
      nearby.events.find((item) => item.title === 'Kilka lokalizacji')!.distanceMeters,
      null,
    );
    assert.equal(nearby.events.find((item) => item.title === 'Bez GPS')!.distanceMeters, null);
    assert.equal(
      (await provider.search({ query: 'blisko', limit: 1 }, origin, signal())).events[0]!.title,
      'Blisko',
    );
    assert.equal((await provider.search({ query: 'mokotow' }, origin, signal())).totalMatches, 3);
    const time = await provider.search({ query: 'daleko', sort: 'time' }, origin, signal());
    assert.equal(time.events[0]!.title, 'Daleko');
    const future = await provider.search(
      { from: '2026-10-18T00:00:00+02:00', to: '2026-10-19T00:00:00+02:00' },
      origin,
      signal(),
    );
    assert.deepEqual(
      future.events.map((item) => item.title),
      ['Blisko'],
    );
  });

  it('ignores malformed rows and duplicates, and explicitly labels the home fallback', async () => {
    const rows = [
      null,
      {},
      event('OK'),
      event('OK'),
      event('Inny język', { language: 'en_US' }),
      event('Zła data', { occurrence: [occurrence('niedziela', 'jutro')] }),
      event('Bez strefy', {
        occurrence: [occurrence('2026-10-17T11:00:00', '2026-10-17T12:00:00')],
      }),
      event('Odwrócony termin', {
        occurrence: [occurrence('2026-10-18T11:00:00+02', '2026-10-17T12:00:00+02')],
      }),
      event('Zły link', { url: 'javascript:alert(1)' }),
    ];
    const provider = createWarsawEvents(
      'key',
      async () => response(rows),
      () => NOW,
    );
    const result = await provider.search({}, { ...origin, source: 'home' }, signal());
    assert.deepEqual(
      result.events.map((item) => item.title),
      ['OK'],
    );
    assert.equal(result.origin.source, 'home');
    assert.match(result.notes.join(' '), /adresu domowego/);
  });

  it('reports API/auth/schema failures safely and does not turn failures into empty results', async () => {
    for (const fetcher of [
      async () => new Response('private-city-token', { status: 401 }),
      async () => new Response('private-city-token', { status: 503 }),
      async () => response({ error: 'private-city-token' }),
      async () => {
        throw new Error('private-city-token');
      },
    ]) {
      const provider = createWarsawEvents('private-city-token', fetcher, () => NOW);
      await assert.rejects(
        provider.search({}, origin, signal()),
        (error) => error instanceof Error && !error.message.includes('private-city-token'),
      );
    }
  });

  it('rejects missing keys, invalid periods and cancelled requests before fetching', async () => {
    let requests = 0;
    const fetcher: typeof fetch = async () => {
      requests++;
      return response([]);
    };
    await assert.rejects(
      createWarsawEvents('', fetcher, () => NOW).search({}, origin, signal()),
      /EXPO_PUBLIC_WARSAW_API_TOKEN/,
    );
    const provider = createWarsawEvents('key', fetcher, () => NOW);
    await assert.rejects(provider.search({ from: 'today' }, origin, signal()), /przedział/);
    await assert.rejects(provider.search({ limit: 100 }, origin, signal()), /dziesięciu/);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.search({}, origin, controller.signal), /przerwane/);
    assert.equal(requests, 0);
  });
});
