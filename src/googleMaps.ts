import { TENDUR_KEBAB } from '@/src/banners';
import type { MapSource, NavigationProvider, Place, RouteStep } from '@/src/navigation';
import { type Coordinate, destination } from '@/src/positioning';

class MapsError extends Error {}
const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export function googleMapsProvider(
  apiKey: string,
  fetcher: typeof fetch = fetch,
): NavigationProvider {
  let unavailableUntil = 0;
  async function post(url: string, fields: string, body: object, signal: AbortSignal) {
    if (!apiKey.trim())
      throw new MapsError(
        'Brakuje klucza map. Ustaw EXPO_PUBLIC_GOOGLE_MAPS_API_KEY i uruchom Metro ponownie.',
      );
    if (signal.aborted) throw new MapsError('Pobieranie mapy przerwane.');
    if (Date.now() < unavailableUntil)
      throw new MapsError(
        'Limit Google Maps jest chwilowo niedostępny. Poczekaj minutę. Zapisana trasa pozostaje w pamięci.',
      );
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 20000);
    try {
      const response = await fetcher(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': fields,
        },
        body: JSON.stringify(body),
      });
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const seconds = Number(retryAfter);
        const delay = Number.isFinite(seconds)
          ? seconds * 1000
          : Date.parse(retryAfter || '') - Date.now();
        unavailableUntil = Date.now() + Math.max(60000, Number.isFinite(delay) ? delay : 60000);
        throw new MapsError(
          'Google Maps zwróciło 429: brak dostępnego limitu. Sprawdź limity projektu w Google Cloud. Rozmowa nadal działa przez OpenRouter.',
        );
      }
      if (!response.ok)
        throw new MapsError(
          response.status === 401 || response.status === 403
            ? 'Google Maps odrzuciło dostęp. Sprawdź klucz, billing oraz włączenie Places API (New) i Routes API w Google Cloud.'
            : 'Nie mogę pobrać mapy z Google Maps. Zapisana trasa pozostaje w pamięci. Spróbuj później.',
        );
      const data = await response.json();
      if (signal.aborted) throw new MapsError('Pobieranie mapy przerwane.');
      return data;
    } catch (error) {
      if (signal.aborted) throw new MapsError('Pobieranie mapy przerwane.');
      if (controller.signal.aborted)
        throw new MapsError(
          'Google Maps nie odpowiedziało w ciągu dwudziestu sekund. Zapisana trasa pozostaje w pamięci.',
        );
      // Never surface provider bodies, request headers or API keys to the assistant.
      if (error instanceof MapsError) throw error;
      throw new MapsError(
        'Nie mogę pobrać poprawnych danych z Google Maps. Sprawdź internet i spróbuj później.',
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    async search(query, origin, openNow, signal) {
      const data = await post(
        PLACES_URL,
        'places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.currentOpeningHours',
        {
          textQuery: query,
          languageCode: 'pl',
          maxResultCount: 5,
          openNow,
          locationBias: { circle: { center: coordinateOnly(origin), radius: 3000 } },
        },
        signal,
      );
      if (data.places !== undefined && !Array.isArray(data.places))
        throw new MapsError('Google Maps nie zwróciło poprawnej listy miejsc.');
      const places: Place[] = (data.places ?? [])
        .filter(
          (place: any) =>
            typeof place.id === 'string' &&
            !!place.id &&
            validCoordinate(place.location) &&
            typeof place.displayName?.text === 'string',
        )
        .map((place: any) => ({
          id: place.id,
          name: place.displayName.text,
          address: place.formattedAddress ?? '',
          location: coordinateOnly(place.location),
          ...(typeof place.currentOpeningHours?.openNow === 'boolean'
            ? { openNow: place.currentOpeningHours.openNow }
            : {}),
          hours: Array.isArray(place.currentOpeningHours?.weekdayDescriptions)
            ? place.currentOpeningHours.weekdayDescriptions.filter(
                (value: unknown) => typeof value === 'string',
              )
            : [],
          sources: [placeSource(place.id, place.displayName.text)],
        }));
      return places.sort(
        (a, b) =>
          destination(origin, a.location).distance - destination(origin, b.location).distance,
      );
    },
    async route(origin, place, signal) {
      const fixed = place.id === TENDUR_KEBAB.id;
      const target = fixed ? coordinateOnly(TENDUR_KEBAB) : coordinateOnly(place.location);
      const data = await post(
        ROUTES_URL,
        'routes.distanceMeters,routes.duration,routes.warnings,routes.legs.steps',
        {
          origin: { location: { latLng: coordinateOnly(origin) } },
          destination: fixed ? { location: { latLng: target } } : { placeId: place.id },
          travelMode: 'WALK',
          languageCode: 'pl-PL',
          units: 'METRIC',
          polylineEncoding: 'GEO_JSON_LINESTRING',
        },
        signal,
      );
      const route = data.routes?.[0];
      if (!route || !Array.isArray(route.legs))
        throw new MapsError('Google Maps nie znalazło trasy pieszej. Nie będę zgadywać drogi.');
      const steps: RouteStep[] = route.legs.flatMap((leg: any) =>
        (Array.isArray(leg.steps) ? leg.steps : []).map((step: any) => ({
          instruction: step.navigationInstruction?.instructions ?? '',
          distance: step.distanceMeters ?? 0,
          path: (step.polyline?.geoJsonLinestring?.coordinates ?? []).map((point: any) =>
            Array.isArray(point) ? { longitude: point[0], latitude: point[1] } : null,
          ),
        })),
      );
      const duration =
        typeof route.duration === 'string' && /^\d+(?:\.\d+)?s$/.test(route.duration)
          ? parseFloat(route.duration)
          : NaN;
      if (
        !steps.length ||
        !nonnegative(route.distanceMeters ?? 0) ||
        !nonnegative(duration) ||
        steps.some(
          (step) =>
            !step.instruction.trim() ||
            !nonnegative(step.distance) ||
            step.path.length < 2 ||
            !step.path.every(validCoordinate),
        )
      ) {
        throw new MapsError(
          'Google Maps nie zwróciło kompletnej geometrii i instrukcji trasy pieszej. Zapisana trasa pozostaje w pamięci.',
        );
      }
      const directions = new URLSearchParams({
        api: '1',
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${target.latitude},${target.longitude}`,
        travelmode: 'walking',
        ...(!fixed ? { destination_place_id: place.id } : {}),
      });
      const sources: MapSource[] = [
        {
          title: `Trasa piesza do: ${place.name}`,
          uri: `https://www.google.com/maps/dir/?${directions}`,
        },
        ...(place.sources ?? []),
      ];
      return {
        steps,
        distance: route.distanceMeters ?? 0,
        durationSeconds: duration,
        geometry: 'street',
        sources,
        warnings: Array.isArray(route.warnings)
          ? route.warnings.filter((value: unknown) => typeof value === 'string')
          : [],
      };
    },
  };
}

const coordinateOnly = (value: Coordinate): Coordinate => ({
  latitude: value.latitude,
  longitude: value.longitude,
});
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
function validCoordinate(value: any): value is Coordinate {
  return (
    value &&
    Number.isFinite(value.latitude) &&
    Math.abs(value.latitude) <= 90 &&
    Number.isFinite(value.longitude) &&
    Math.abs(value.longitude) <= 180
  );
}
function placeSource(id: string, name: string): MapSource {
  const query = new URLSearchParams({ api: '1', query: name, query_place_id: id });
  return { title: name, uri: `https://www.google.com/maps/search/?${query}`, placeId: id };
}
