import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TENDUR_KEBAB } from '@/src/banners';
import {
  createNavigation,
  distanceToPath,
  type NavigationProvider,
  type Place,
  type WalkingRoute,
} from '@/src/navigation';
import { type Coordinate, offsetCoordinate } from '@/src/positioning';

const origin: Coordinate = { latitude: 52.2, longitude: 21 };
const at = (east: number, north = 0) => offsetCoordinate(origin, east, north);
const place: Place = {
  id: 'pharmacy',
  name: 'Apteka',
  address: 'Testowa 1',
  location: at(200),
  openNow: true,
};
const walking: WalkingRoute = {
  steps: [
    { instruction: 'Idź prosto ulicą Testową.', distance: 100, path: [origin, at(50), at(100)] },
    { instruction: 'Idź prosto do apteki.', distance: 100, path: [at(100), at(150), at(200)] },
  ],
  distance: 200,
  durationSeconds: 180,
  warnings: ['Zachowaj ostrożność.'],
};
const signal = () => new AbortController().signal;
function setup() {
  let clock = 1000000;
  let searchCalls = 0,
    routeCalls = 0;
  const provider: NavigationProvider = {
    async search() {
      searchCalls++;
      return [place];
    },
    async route() {
      routeCalls++;
      return walking;
    },
  };
  const navigation = createNavigation(provider, () => clock);
  const locate = (east = 0, north = 0, accuracy = 5) => {
    clock += 1000;
    navigation.updateLocation({ ...at(east, north), timestamp: clock, accuracy });
  };
  locate();
  return {
    navigation,
    locate,
    advance: (ms: number) => {
      clock += ms;
    },
    counts: () => ({ searchCalls, routeCalls }),
    async start() {
      await navigation.execute({ action: 'search', query: 'apteka', openNow: true }, signal());
      return navigation.execute({ action: 'start', placeId: place.id }, signal());
    },
  };
}

describe('remembered conversational walking route', () => {
  it('retains progress and reuses the same route through questions, pauses and resumes', async () => {
    const s = setup();
    const first = await s.start();
    const id = first.currentRoute!.id;
    await s.navigation.execute({ action: 'next' }, signal());
    assert.equal(
      s.navigation.context().currentRoute!.stepIndex,
      0,
      'cannot advance before reaching the endpoint',
    );
    s.locate(100);
    await s.navigation.execute({ action: 'next' }, signal());
    assert.equal(s.navigation.context().currentRoute!.stepIndex, 1);
    await s.navigation.execute({ action: 'pause' }, signal());
    assert.equal(s.navigation.reminder(), null);
    assert.equal(s.navigation.context().currentRoute!.status, 'paused');
    await s.navigation.execute({ action: 'resume', routeId: id }, signal());
    await s.navigation.execute({ action: 'start', placeId: place.id }, signal());
    await s.navigation.execute({ action: 'status' }, signal());
    await s.navigation.execute({ action: 'replan' }, signal());
    assert.equal(s.navigation.context().currentRoute!.id, id);
    assert.equal(s.navigation.context().currentRoute!.stepIndex, 1);
    assert.deepEqual(s.counts(), { routeCalls: 1, searchCalls: 1 });
    s.locate(200);
    await s.navigation.execute({ action: 'next' }, signal());
    assert.equal(s.navigation.context().currentRoute!.status, 'arrived');
    assert.equal(s.navigation.reminder(), null);
  });

  it('preserves the first destination when another route is chosen and can return to it', async () => {
    const s = setup();
    const first = await s.start();
    await s.navigation.execute({ action: 'start', placeId: TENDUR_KEBAB.id }, signal());
    assert.equal(s.navigation.context().savedRoutes.length, 2);
    assert.equal(s.navigation.context().savedRoutes[0]!.status, 'paused');
    assert.equal(
      s.navigation.context().currentRoute!.destination.location.latitude,
      TENDUR_KEBAB.latitude,
    );
    await s.navigation.execute({ action: 'resume', routeId: first.currentRoute!.id }, signal());
    assert.equal(s.navigation.context().currentRoute!.destination.id, place.id);
    assert.equal(s.counts().routeCalls, 2);
  });

  it('requires several fresh off-path fixes over fifteen seconds before rerouting', async () => {
    const s = setup();
    await s.start();
    s.locate(0, 70);
    await s.navigation.execute({ action: 'replan' }, signal());
    assert.equal(s.counts().routeCalls, 1);
    s.advance(7000);
    s.locate(0, 70);
    assert.equal(s.navigation.context().offRoute, false);
    s.advance(7000);
    s.locate(0, 70);
    assert.equal(s.navigation.context().offRoute, true);
    assert.match(s.navigation.reminder()!, /poza zapisaną drogą/);
    assert.equal(s.navigation.reminder(), null, 'does not repeat immediately');
    const previous = s.navigation.context().currentRoute!.id;
    await s.navigation.execute({ action: 'replan' }, signal());
    assert.equal(s.counts().routeCalls, 2);
    assert.equal(
      s.navigation.context().savedRoutes.find((route) => route.id === previous)!.status,
      'paused',
    );
  });

  it('clears transient deviation when the user is back and rejects poor or stale GPS', async () => {
    const s = setup();
    await s.start();
    s.locate(0, 70);
    s.advance(15000);
    s.locate(0, 70);
    s.locate(50);
    assert.equal(s.navigation.context().offRoute, false);
    s.locate(100, 0, 100);
    await assert.rejects(s.navigation.execute({ action: 'next' }, signal()), /lokalizacji/);
    s.locate(100);
    s.advance(6000);
    assert.equal(s.navigation.context().locationCurrent, false);
    assert.match(s.navigation.reminder()!, /GPS/);
    await assert.rejects(s.navigation.execute({ action: 'resume' }, signal()), /lokalizacji/);
    assert.equal(s.counts().routeCalls, 1);
  });

  it('prompts at the endpoint, keeps the current step until asked, and periodically checks wellbeing', async () => {
    const s = setup();
    await s.start();
    s.locate(100);
    assert.match(s.navigation.reminder()!, /Co dalej/);
    assert.equal(s.navigation.context().currentRoute!.stepIndex, 0);
    s.advance(120000);
    s.locate(100);
    assert.match(s.navigation.reminder()!, /wszystko w porządku/);
    assert.ok(s.navigation.context().lastReminder);
  });

  it('caches repeated place searches but refreshes after five minutes', async () => {
    const s = setup();
    await s.start();
    await s.navigation.execute({ action: 'search', query: 'apteka', openNow: true }, signal());
    assert.equal(s.counts().searchCalls, 1);
    s.advance(301000);
    s.locate();
    await s.navigation.execute({ action: 'search', query: 'apteka', openNow: true }, signal());
    assert.equal(s.counts().searchCalls, 2);
  });

  it('retains the previous route if a new request is cancelled', async () => {
    let calls = 0;
    const controller = new AbortController();
    const navigation = createNavigation({
      async search() {
        return [place];
      },
      async route() {
        if (++calls === 2) controller.abort();
        return walking;
      },
    });
    navigation.updateLocation({ ...origin, accuracy: 5, timestamp: Date.now() });
    await navigation.execute({ action: 'search', query: 'apteka' }, signal());
    const first = await navigation.execute({ action: 'start', placeId: place.id }, signal());
    await assert.rejects(
      navigation.execute({ action: 'start', placeId: TENDUR_KEBAB.id }, controller.signal),
      /przerwane/,
    );
    assert.equal(navigation.context().currentRoute!.id, first.currentRoute!.id);
    assert.equal(navigation.context().savedRoutes.length, 1);
  });
});

describe('map data boundary', () => {
  it('measures distance to a curved route rather than a straight line between endpoints', () => {
    assert.ok(distanceToPath(at(50, 50), [origin, at(0, 100), at(100, 100)]) > 49);
    assert.ok(distanceToPath(at(0, 50), [origin, at(0, 100), at(100, 100)]) < 1);
  });
});

describe('direction selected from an invitation', () => {
  it('switches the compass without a map request and retains the previous walking route for resuming', async () => {
    const { INVITATION_DESTINATIONS } = await import('@/src/invitations');
    const s = setup();
    const first = await s.start();
    s.navigation.pointTo(INVITATION_DESTINATIONS.Danka);
    const state = s.navigation.context();
    assert.equal(state.currentRoute, null);
    assert.equal(state.savedRoutes[0]!.status, 'paused');
    assert.deepEqual(state.directionTarget, INVITATION_DESTINATIONS.Danka);
    assert.equal(s.navigation.reminder(), null);
    s.navigation.pointTo(INVITATION_DESTINATIONS.Basia);
    assert.deepEqual(s.navigation.context().directionTarget, INVITATION_DESTINATIONS.Basia);
    assert.deepEqual(s.counts(), { searchCalls: 1, routeCalls: 1 });
    await s.navigation.execute({ action: 'resume', routeId: first.currentRoute!.id }, signal());
    assert.equal(s.navigation.context().directionTarget, null);
    assert.equal(s.navigation.context().currentRoute!.id, first.currentRoute!.id);
    assert.equal(s.counts().routeCalls, 1);
  });

  it('can remember a compass destination while waiting for GPS', async () => {
    const { INVITATION_DESTINATIONS } = await import('@/src/invitations');
    const provider: NavigationProvider = {
      async search() {
        throw new Error('No search expected');
      },
      async route() {
        throw new Error('No route expected');
      },
    };
    const navigation = createNavigation(provider);
    navigation.pointTo(INVITATION_DESTINATIONS.Danka);
    assert.equal(navigation.context().locationCurrent, false);
    assert.deepEqual(navigation.context().directionTarget, INVITATION_DESTINATIONS.Danka);
    assert.equal(navigation.context().currentRoute, null);
    assert.deepEqual(TENDUR_KEBAB, {
      id: 'tendur-kebab',
      title: 'Tendur Kebab',
      latitude: 52.2402694,
      longitude: 20.9815395,
    });
  });
});

describe('walking orientation context', () => {
  it('relates the route to the rear-camera heading and expires old compass readings', async () => {
    const s = setup();
    await s.start();
    s.navigation.updateHeading(90, Date.parse(s.navigation.context().currentTime));
    assert.ok(
      Math.abs(s.navigation.context().currentRoute!.direction!.relativeToRearCamera!) < 1,
      'eastward path is ahead of an east-facing rear camera',
    );
    s.navigation.updateHeading(0, Date.parse(s.navigation.context().currentTime));
    assert.ok(
      s.navigation.context().currentRoute!.direction!.relativeToRearCamera! > 89,
      'eastward path is to the right of a north-facing camera',
    );
    s.advance(2100);
    assert.equal(s.navigation.context().rearCameraHeading, null);
    assert.equal(s.navigation.context().currentRoute!.direction!.relativeToRearCamera, null);
  });
});
