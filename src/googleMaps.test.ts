import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TENDUR_KEBAB } from '@/src/banners';
import { googleMapsProvider } from '@/src/googleMaps';
import type { Place } from '@/src/navigation';

const origin = { latitude: 52.19902, longitude: 21.0197395 };
const place: Place = {
  id: 'pharmacy-id',
  name: 'Apteka',
  address: 'Testowa 1',
  location: { latitude: 52.201, longitude: 21.02 },
};
const signal = () => new AbortController().signal;
const routeData = () => ({
  routes: [
    {
      distanceMeters: 250,
      duration: '180.5s',
      warnings: ['Uważaj na przejściach.'],
      legs: [
        {
          steps: [
            {
              navigationInstruction: { instructions: 'Idź prosto ulicą Testową.' },
              distanceMeters: 250,
              polyline: {
                geoJsonLinestring: {
                  coordinates: [
                    [origin.longitude, origin.latitude],
                    [place.location.longitude, place.location.latitude],
                  ],
                },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe('direct Google Places and Routes tool', () => {
  it('searches open places and requests a real walking route with usable street geometry', async () => {
    const requests: any[] = [];
    const provider = googleMapsProvider('private-map-key', async (url, init) => {
      requests.push({ url, body: JSON.parse(String(init?.body)), headers: init?.headers });
      return Response.json(
        requests.length === 1
          ? {
              places: [
                {
                  id: place.id,
                  displayName: { text: place.name },
                  formattedAddress: place.address,
                  location: place.location,
                  currentOpeningHours: {
                    openNow: true,
                    weekdayDescriptions: ['Poniedziałek: 08:00–20:00'],
                  },
                },
              ],
            }
          : routeData(),
      );
    });
    const results = await provider.search(
      'apteka',
      { ...origin, accuracy: 5, timestamp: Date.now() } as typeof origin,
      true,
      signal(),
    );
    assert.equal(results[0]!.openNow, true);
    assert.equal(results[0]!.name, place.name);
    assert.ok(results[0]!.sources![0]!.uri.startsWith('https://www.google.com/maps/search/'));
    const route = await provider.route(origin, results[0]!, signal());
    assert.equal(route.geometry, 'street');
    assert.deepEqual(route.steps[0]!.path, [origin, place.location]);
    assert.equal(route.durationSeconds, 180.5);
    assert.equal(route.distance, 250);
    assert.equal(route.sources!.length, 2);
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        'https://places.googleapis.com/v1/places:searchText',
        'https://routes.googleapis.com/directions/v2:computeRoutes',
      ],
    );
    assert.equal(requests[0].body.openNow, true);
    assert.deepEqual(
      requests[0].body.locationBias.circle.center,
      origin,
      'GPS metadata is not sent as invalid LatLng fields',
    );
    assert.equal(requests[1].body.travelMode, 'WALK');
    assert.equal(requests[1].body.polylineEncoding, 'GEO_JSON_LINESTRING');
    assert.deepEqual(requests[1].body.destination, { placeId: place.id });
    for (const request of requests) {
      assert.ok(!request.url.includes('private-map-key'));
      assert.equal(request.headers['X-Goog-Api-Key'], 'private-map-key');
      assert.ok(!JSON.stringify(request.body).includes('111-111-111'));
      assert.ok(!('model' in request.body));
      assert.ok(!('tools' in request.body));
    }
  });

  it('keeps Tendur at its fixed coordinates even if a caller supplies different coordinates', async () => {
    let body: any;
    const provider = googleMapsProvider('test', async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return Response.json(routeData());
    });
    await provider.route(origin, { ...place, id: TENDUR_KEBAB.id, location: origin }, signal());
    assert.deepEqual(body.destination, {
      location: { latLng: { latitude: TENDUR_KEBAB.latitude, longitude: TENDUR_KEBAB.longitude } },
    });
  });

  it('preserves unknown hours and ignores invalid places instead of inventing details', async () => {
    const provider = googleMapsProvider('test', async () =>
      Response.json({
        places: [
          { id: 'unknown', displayName: { text: 'Apteka' }, location: origin },
          {
            id: 'invalid',
            displayName: { text: 'Błędne współrzędne' },
            location: { latitude: 999, longitude: 21 },
          },
        ],
      }),
    );
    const results = await provider.search('apteka', origin, false, signal());
    assert.equal(results.length, 1);
    assert.equal(results[0]!.openNow, undefined);
    assert.deepEqual(results[0]!.hours, []);
  });

  it('rejects missing routes, geometry, instructions and malformed durations', async () => {
    const missingGeometry = routeData();
    missingGeometry.routes[0]!.legs[0]!.steps[0]!.polyline.geoJsonLinestring.coordinates = [];
    const missingInstruction = routeData();
    missingInstruction.routes[0]!.legs[0]!.steps[0]!.navigationInstruction.instructions = '';
    const invalidDuration = routeData();
    invalidDuration.routes[0]!.duration = 'nieznany';
    for (const data of [{}, missingGeometry, missingInstruction, invalidDuration]) {
      const provider = googleMapsProvider('test', async () => Response.json(data));
      await assert.rejects(provider.route(origin, place, signal()), /trasy pieszej/);
    }
  });

  it('does not retry on quota failure and never exposes provider bodies or keys', async () => {
    let calls = 0;
    const key = 'private-map-key';
    const provider = googleMapsProvider(key, async () => {
      calls++;
      return new Response(key, { status: 429, headers: { 'retry-after': '60' } });
    });
    await assert.rejects(
      provider.route(origin, place, signal()),
      (error) =>
        error instanceof Error && /429/.test(error.message) && !error.message.includes(key),
    );
    await assert.rejects(provider.route(origin, place, signal()), /Poczekaj minutę/);
    assert.equal(calls, 1);
    for (const status of [401, 403, 500]) {
      const failing = googleMapsProvider(key, async () => new Response(key, { status }));
      await assert.rejects(
        failing.route(origin, place, signal()),
        (error) => error instanceof Error && !error.message.includes(key),
      );
    }
    const network = googleMapsProvider(key, async () => {
      throw new Error(key);
    });
    await assert.rejects(
      network.route(origin, place, signal()),
      (error) => error instanceof Error && !error.message.includes(key),
    );
  });

  it('rejects missing keys and pre-cancelled requests before making a call', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      return Response.json(routeData());
    };
    await assert.rejects(
      googleMapsProvider('', fetcher).route(origin, place, signal()),
      /EXPO_PUBLIC_GOOGLE_MAPS_API_KEY/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      googleMapsProvider('test', fetcher).route(origin, place, controller.signal),
      /przerwane/,
    );
    assert.equal(calls, 0);
  });
});
