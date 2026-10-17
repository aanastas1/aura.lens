import { destination, localOffset, reliableFix, type Coordinate, type Fix } from './positioning';
import { TENDUR_KEBAB } from './banners';

export type MapSource = { title: string; uri: string; placeId?: string };
export type MapRequestContext = { preferences?: string[] };
export type Place = { id: string; name: string; address: string; location: Coordinate; openNow?: boolean; hours?: string[]; sources?: MapSource[] };
export type RouteStep = { instruction: string; distance: number; path: Coordinate[] };
export type WalkingRoute = { steps: RouteStep[]; distance: number; durationSeconds: number; warnings: string[]; geometry?: 'street'; sources?: MapSource[] };
export type SavedRoute = WalkingRoute & {
  id: string; place: Place; createdAt: number; step: number; preferences?: string[]; status: 'active' | 'paused' | 'arrived';
};
export type NavigationCommand = {
  action: 'search' | 'start' | 'status' | 'next' | 'pause' | 'resume' | 'replan';
  query?: string; placeId?: string; routeId?: string; openNow?: boolean; preferences?: string[];
};
export type NavigationProvider = {
  search(query: string, origin: Coordinate, openNow: boolean, signal: AbortSignal, context?: MapRequestContext): Promise<Place[]>;
  route(origin: Coordinate, place: Place, signal: AbortSignal, context?: MapRequestContext): Promise<WalkingRoute>;
};
export const NEXT_PROMPT = 'Gdy dojdziesz, zatrzymaj się i powiedz: „Co dalej?”.';

// Distance to actual street geometry, never just to the destination or a straight line to it.
export function distanceToPath(point: Coordinate, path: Coordinate[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length; i++) {
    const a = localOffset(point, path[i]!);
    const b = localOffset(point, path[i + 1] ?? path[i]!);
    const dx = b.east - a.east, dy = b.north - a.north;
    const length = dx * dx + dy * dy;
    const t = length ? Math.max(0, Math.min(1, -(a.east * dx + a.north * dy) / length)) : 0;
    best = Math.min(best, Math.hypot(a.east + t * dx, a.north + t * dy));
  }
  return best;
}

function directionAlongPath(point: Coordinate, path: Coordinate[], heading: number | null) {
  let nearest = 0, distance = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const candidate = distanceToPath(point, [path[i]!, path[i + 1]!]);
    if (candidate < distance) { distance = candidate; nearest = i; }
  }
  let target = path[nearest + 1]!;
  if (destination(point, target).distance < 10 && nearest + 2 < path.length) target = path[nearest + 2]!;
  const bearing = destination(point, target).bearing;
  return { target, bearing, relativeToRearCamera: heading === null ? null : ((bearing - heading + 540) % 360) - 180 };
}

export function createNavigation(provider: NavigationProvider, now = Date.now) {
  let fix: Fix | null = null;
  let heading: { degrees: number; timestamp: number } | null = null;
  let lastReplanAt = -Infinity;
  let routes: SavedRoute[] = [];
  let selectedId: string | null = null;
  let directionTarget: Place | null = null;
  let places: Place[] = [];
  let preferences: string[] = [];
  let searchCache: { query: string; openNow: boolean; origin: Coordinate; at: number } | null = null;
  let offSince: number | null = null;
  let offSamples = 0;
  let offRoute = false;
  let lastReminder = 0;
  let lastReminderText: string | null = null;
  let lastInteraction = now();
  let reachedStep: string | null = null;
  let sequence = 0;
  const selected = () => routes.find(route => route.id === selectedId);
  const fresh = () => !!fix && reliableFix(fix, now());
  const stepEndDistance = (route: SavedRoute) => {
    const endpoint = route.steps[route.step]!.path.at(-1) ?? (route.step === route.steps.length - 1 ? route.place.location : null);
    return fresh() && endpoint ? destination(fix!, endpoint).distance : null;
  };
  const remainingDistance = (route: SavedRoute) => Math.min(...route.steps.slice(route.step).map(step => distanceToPath(fix!, step.path)));
  const resetCheck = () => { offSince = null; offSamples = 0; offRoute = false; reachedStep = null; };
  const requireFix = () => {
    if (!fresh()) throw new Error('Nie mam dokładnej, aktualnej lokalizacji. Zatrzymaj się w bezpiecznym miejscu i poczekaj na GPS.');
    return fix!;
  };
  const view = () => {
    const route = selected();
    return {
      currentTime: new Date(now()).toISOString(), localTime: new Date(now()).toLocaleString('pl-PL'),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      rearCameraHeading: heading && now() - heading.timestamp <= 2000 ? heading.degrees : null,
      location: fix, locationCurrent: fresh(), offRoute, directionTarget,
      preferences,
      lastReminder: lastReminderText ? { text: lastReminderText, at: lastReminder } : null,
      places, placesCheckedAt: searchCache?.at ?? null,
      savedRoutes: routes.map(({ steps, ...saved }) => ({ ...saved, stepCount: steps.length })),
      currentRoute: route ? {
        id: route.id, destination: route.place, status: route.status, stepIndex: route.step,
        stepCount: route.steps.length, currentStep: route.steps[route.step],
        nextStep: route.steps[route.step + 1],
        distanceToStepEnd: stepEndDistance(route),
        geometry: route.geometry ?? 'street', sources: route.sources ?? [],
        warnings: route.warnings,
        direction: fresh() ? directionAlongPath(fix!, route.steps[route.step]!.path, heading && now() - heading.timestamp <= 2000 ? heading.degrees : null) : null,
      } : null,
      nextPrompt: NEXT_PROMPT,
    };
  };

  return {
    context: view,
    sources: () => selected()?.sources ?? places.flatMap(place => place.sources ?? []),
    pointTo(place: Place) {
      const previous = selected();
      if (previous?.status === 'active') previous.status = 'paused';
      selectedId = null;
      directionTarget = place;
      resetCheck();
    },
    hudState: () => ({ directionTarget, followingRoute: !!selected() }),
    displayStatus() {
      const route = selected();
      if (!route) return '';
      if (route.status === 'paused') return `Droga do: ${route.place.name}. Wstrzymana.`;
      if (route.status === 'arrived') return `Jesteś w okolicy: ${route.place.name}.`;
      if (!fresh()) return 'Czekam na dokładny GPS. Zatrzymaj się w bezpiecznym miejscu.';
      if (offRoute) return 'Sprawdźmy drogę. Zatrzymaj się w bezpiecznym miejscu.';
      return `Cel: ${route.place.name}. Powiedz: „Co dalej?”`;
    },
    updateHeading(degrees: number, timestamp: number) {
      if (Number.isFinite(degrees)) heading = { degrees, timestamp };
    },
    updateLocation(next: Fix) {
      // Store the latest observation, including its timestamp/accuracy. Never present a stale fix as current.
      if (fix && next.timestamp <= fix.timestamp) return;
      fix = next;
      const route = selected();
      if (!fresh() || route?.status !== 'active') { offSince = null; offSamples = 0; return; }
      if (remainingDistance(route) > Math.max(40, next.accuracy! * 2)) {
        offSince ??= next.timestamp;
        offSamples++;
        offRoute = offSamples >= 3 && next.timestamp - offSince >= 15000;
      } else { offSince = null; offSamples = 0; offRoute = false; }
    },
    reminder(): string | null {
      const route = selected();
      if (route?.status !== 'active' || now() - lastReminder < 60000) return null;
      let message: string | null = null;
      if (!fresh()) message = 'Nie mam aktualnego, dokładnego GPS. Zatrzymaj się w bezpiecznym miejscu i poczekaj na sygnał.';
      else if (offRoute) message = 'Wygląda na to, że jesteś poza zapisaną drogą. Zatrzymaj się w bezpiecznym miejscu i powiedz: „Sprawdź drogę”.';
      else if (stepEndDistance(route) !== null && stepEndDistance(route)! <= 25 && reachedStep !== `${route.id}:${route.step}`) {
        reachedStep = `${route.id}:${route.step}`;
        message = 'Jesteś blisko końca tego odcinka. Zatrzymaj się w bezpiecznym miejscu i powiedz: „Co dalej?”.';
      } else if (now() - lastInteraction >= 120000) message = 'Czy wszystko w porządku? Jeśli potrzebujesz wskazówki, zatrzymaj się i powiedz: „Sprawdź drogę”.';
      if (message) { lastReminder = now(); lastReminderText = message; }
      return message;
    },
    async execute(command: NavigationCommand, signal: AbortSignal) {
      if (signal.aborted) throw new Error('Nawigacja przerwana.');
      if (!['search', 'start', 'status', 'next', 'pause', 'resume', 'replan'].includes(command.action)) throw new Error('Nieznane polecenie nawigacji.');
      lastInteraction = now();
      if (command.preferences) {
        const next = command.preferences.map(value => value.trim()).filter(Boolean).slice(0, 10);
        if (JSON.stringify(next) !== JSON.stringify(preferences)) searchCache = null;
        preferences = next;
      }
      if (command.action === 'search') {
        const origin = requireFix();
        const query = command.query?.trim();
        if (!query) throw new Error('Podaj nazwę miejsca lub adres.');
        const openNow = command.openNow ?? false;
        if (!searchCache || searchCache.query !== query || searchCache.openNow !== openNow
          || now() - searchCache.at > 300000 || destination(origin, searchCache.origin).distance > 100) {
          const results = await provider.search(query, origin, openNow, signal, { preferences });
          if (signal.aborted) throw new Error('Wyszukiwanie przerwane.');
          places = results;
          searchCache = { query, openNow, origin, at: now() };
        }
        return view();
      }
      let route = command.routeId ? routes.find(item => item.id === command.routeId) : selected();
      if (command.routeId && !route) throw new Error('Nie znalazłem zapisanej trasy.');
      if (command.action === 'start') {
        const origin = requireFix();
        const place = command.placeId === TENDUR_KEBAB.id
          ? { id: TENDUR_KEBAB.id, name: TENDUR_KEBAB.title, address: '', location: TENDUR_KEBAB }
          : places.find(item => item.id === command.placeId);
        if (!place) throw new Error('Najpierw wyszukaj miejsce. Wybierz identyfikator z wyników, nie wymyślaj adresu.');
        route = routes.findLast(item => item.place.id === place.id && item.status !== 'arrived');
        if (!route) {
          const walking = await provider.route(origin, place, signal, { preferences });
          if (signal.aborted) throw new Error('Wyznaczanie trasy przerwane.');
          route = { ...walking, id: `route-${++sequence}`, place, createdAt: now(), step: 0, preferences: [...preferences], status: 'paused' };
          routes = [...routes, route];
        }
      }
      if (command.action === 'status') return view();
      if (!route) throw new Error('Nie ma jeszcze zapisanej trasy. Najpierw ustal cel.');
      if (command.action === 'replan') {
        const origin = requireFix();
        if (route.status === 'arrived') return view();
        // GPS jitter, a new question or a pause never justify another paid route request.
        if (route.id !== selectedId || now() - lastReplanAt < 60000) return view();
        if (remainingDistance(route) <= 40 || !offRoute) return view();
        lastReplanAt = now();
        const walking = await provider.route(origin, route.place, signal, { preferences: route.preferences ?? preferences });
        if (signal.aborted) throw new Error('Wyznaczanie trasy przerwane.');
        const updated: SavedRoute = { ...walking, id: `route-${++sequence}`, place: route.place, createdAt: now(), step: 0, preferences: [...(route.preferences ?? preferences)], status: 'paused' };
        routes = [...routes, updated];
        route = updated;
      }
      if (command.action === 'pause') { route.status = 'paused'; return view(); }
      if (command.action === 'next') {
        requireFix();
        if (route.status !== 'active') throw new Error('Ta trasa jest wstrzymana lub zakończona. Wznów ją przed dalszą drogą.');
        if (offRoute) return view();
        // Only the user's request advances a step, and only when GPS places them near its end.
        const distanceToEnd = stepEndDistance(route);
        const reached = distanceToEnd !== null && distanceToEnd <= 25;
        if (reached) {
          if (route.step < route.steps.length - 1) route.step++;
          else route.status = 'arrived';
          reachedStep = null;
        }
        return view();
      }
      requireFix();
      if (selectedId !== route.id) {
        const previous = selected();
        if (previous?.status === 'active') previous.status = 'paused';
        selectedId = route.id;
        resetCheck();
      }
      directionTarget = null;
      if (route.status !== 'arrived') route.status = 'active';
      // A resumed route far from the user is retained, but cannot issue directions until checked.
      if (remainingDistance(route) > 40) {
        offRoute = true;
        offSince = fix!.timestamp;
        offSamples = 3;
      }
      return view();
    },
  };
}

