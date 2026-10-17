import { type Coordinate, destination } from '@/src/positioning';

export const EVENTS_SOURCE =
  'https://dane.um.warszawa.pl/pl/catalogue/ba202e4b-dfa9-440c-83c0-0b3517520cb8';
const EVENTS_URL = 'https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen';
const CACHE_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type EventsQuery = {
  query?: string;
  from?: string;
  to?: string;
  sort?: 'distance' | 'time';
  limit?: number;
};
export type EventsOrigin = { coordinate: Coordinate; source: 'gps' | 'home' };
export type CityEvent = {
  title: string;
  description: string;
  url: string;
  start: string;
  end: string;
  allDay: boolean;
  ongoing: boolean;
  addresses: string[];
  districts: string[];
  categories: string[];
  locations: Coordinate[];
  distanceMeters: number | null;
};
export type EventsProvider = ReturnType<typeof createWarsawEvents>;

export function createWarsawEvents(apiKey: string, fetcher: typeof fetch = fetch, now = Date.now) {
  let cache: { events: unknown[]; fetchedAt: number } | null = null;

  async function load(signal: AbortSignal) {
    if (signal.aborted) throw new Error('Pobieranie wydarzeń przerwane.');
    if (cache && now() - cache.fetchedAt < CACHE_MS) return cache;
    if (!apiKey.trim())
      throw new Error(
        'Brakuje klucza wydarzeń. Ustaw EXPO_PUBLIC_WARSAW_API_TOKEN i uruchom Metro ponownie.',
      );
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 15000);
    try {
      // The new Warsaw API requires the raw JWT, without a Bearer prefix.
      const response = await fetcher(EVENTS_URL, {
        method: 'POST',
        headers: { Authorization: apiKey },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403)
        throw new EventsError('API Warszawy odrzuciło klucz wydarzeń. Sprawdź token w .env.');
      if (!response.ok)
        throw new EventsError('Nie mogę pobrać wydarzeń z API Warszawy. Spróbuj później.');
      const data: unknown = await response.json();
      if (!Array.isArray(data))
        throw new EventsError('API Warszawy nie zwróciło poprawnej listy wydarzeń.');
      if (signal.aborted) throw new EventsError('Pobieranie wydarzeń przerwane.');
      cache = { events: data, fetchedAt: now() };
      return cache;
    } catch (error) {
      // Provider bodies and credentials must never be returned to the model.
      if (signal.aborted) throw new Error('Pobieranie wydarzeń przerwane.');
      if (controller.signal.aborted)
        throw new Error(
          'API wydarzeń nie odpowiedziało w ciągu piętnastu sekund. Spróbuj później.',
        );
      if (error instanceof EventsError) throw error;
      throw new Error(
        'Nie mogę odczytać wydarzeń z API Warszawy. Sprawdź internet i spróbuj później.',
      );
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  return {
    async search(query: EventsQuery, origin: EventsOrigin, signal: AbortSignal) {
      const currentTime = now();
      const from = query.from ? timestamp(query.from) : currentTime;
      const to = query.to ? timestamp(query.to) : Math.max(from, currentTime) + 7 * DAY_MS;
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
        throw new Error('Podaj poprawny przedział dat wydarzeń z godziną i strefą czasową.');
      }
      if (
        query.limit !== undefined &&
        (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 10)
      ) {
        throw new Error('Liczba wydarzeń musi wynosić od jednego do dziesięciu.');
      }
      const data = await load(signal);
      // Re-filter on every search, even when using cached data: an event may just have ended.
      const checkedAt = now();
      const cutoff = Math.max(checkedAt, from);
      const needle = fold(query.query ?? '');
      const matches = data.events
        .map((row) => normalizeEvent(row, cutoff, to, checkedAt, origin.coordinate))
        .filter((event): event is CityEvent => !!event)
        .filter(
          (event) =>
            !needle ||
            fold(
              [
                event.title,
                event.description,
                ...event.addresses,
                ...event.districts,
                ...event.categories,
              ].join(' '),
            ).includes(needle),
        );
      const sort = query.sort ?? 'distance';
      matches.sort((a, b) => {
        const byTime = Math.max(timestamp(a.start), cutoff) - Math.max(timestamp(b.start), cutoff);
        const byDistance = (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity);
        return sort === 'time'
          ? byTime || byDistance || a.title.localeCompare(b.title, 'pl')
          : byDistance || byTime || a.title.localeCompare(b.title, 'pl');
      });
      // Deduplicate repeated publications of the same occurrence.
      const unique = [
        ...new Map(matches.map((event) => [`${event.url}|${event.start}`, event])).values(),
      ];
      return {
        source: { name: 'Miasto Stołeczne Warszawa — kalendarz wydarzeń', url: EVENTS_SOURCE },
        fetchedAt: new Date(data.fetchedAt).toISOString(),
        checkedAt: new Date(checkedAt).toISOString(),
        timeZone: 'Europe/Warsaw',
        from: new Date(cutoff).toISOString(),
        to: new Date(to).toISOString(),
        sort,
        origin,
        totalMatches: unique.length,
        events: unique.slice(0, query.limit ?? 5),
        notes: [
          'Uwzględniono wydarzenia trwające i przyszłe. Zakończone terminy są pomijane.',
          'Odległość jest w linii prostej. Brak współrzędnych lub kilka lokalizacji oznacza nieznaną odległość.',
          'Zakres dat wystawy nie potwierdza godzin otwarcia. Nie zakładaj wolnego wstępu ani dostępności miejsc bez potwierdzenia w opisie.',
          ...(origin.source === 'home'
            ? [
                'Odległość liczona od adresu domowego Jadwigi, ul. Racławicka 17 — brak aktualnego GPS.',
              ]
            : []),
        ],
      };
    },
  };
}

class EventsError extends Error {}

function timestamp(value: unknown): number {
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}(?::?\d{2})?)$/.test(value)) return NaN;
  return Date.parse(value.replace(/([+-]\d{2})$/, '$1:00'));
}

function plainText(value: unknown): string {
  if (typeof value !== 'string') return '';
  const entities: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    quot: '"',
    apos: "'",
    lt: '<',
    gt: '>',
  };
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|nbsp|amp|quot|apos|lt|gt);/gi, (original, key: string) => {
      if (!key.startsWith('#')) return entities[key.toLowerCase()] ?? original;
      const code =
        key[1]?.toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}
const fold = (text: string) =>
  text
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
const array = (value: unknown): any[] => (Array.isArray(value) ? value : []);

function normalizeEvent(
  raw: unknown,
  cutoff: number,
  to: number,
  now: number,
  origin: Coordinate,
): CityEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, any>;
  if (row.language && row.language !== 'pl_PL') return null;
  const title = plainText(row.title);
  if (!title || typeof row.url !== 'string' || !/^https?:\/\//i.test(row.url)) return null;
  const occurrence = array(row.occurrence)
    .filter((item) => {
      const start = timestamp(item?.from),
        end = timestamp(item?.to);
      return (
        Number.isFinite(start) && Number.isFinite(end) && end >= start && end > cutoff && start < to
      );
    })
    .sort((a, b) => Math.max(timestamp(a.from), cutoff) - Math.max(timestamp(b.from), cutoff))[0];
  if (!occurrence) return null;
  const features = array(row.map?.features);
  const locations: Coordinate[] = features.flatMap((feature) => {
    const coords = feature?.geometry?.coordinates;
    if (feature?.geometry?.type !== 'Point' || !Array.isArray(coords)) return [];
    const [longitude, latitude] = coords;
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 ||
      Math.abs(longitude) > 180
    )
      return [];
    return [{ latitude, longitude }];
  });
  const addresses = array(row.address)
    .map((address) =>
      [plainText(address?.name), plainText(address?.street)].filter(Boolean).join(', '),
    )
    .filter(Boolean);
  const mapAddresses = features
    .map((feature) => {
      const properties = feature?.properties;
      return [
        plainText(properties?.shortStreetName || properties?.fullStreetName),
        plainText(properties?.streetNumber),
      ]
        .filter(Boolean)
        .join(' ');
    })
    .filter(Boolean);
  const description = [plainText(row.lead), plainText(row.text)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 800);
  return {
    title,
    description,
    url: row.url,
    start: new Date(timestamp(occurrence.from)).toISOString(),
    end: new Date(timestamp(occurrence.to)).toISOString(),
    allDay: occurrence.daily === true,
    ongoing: timestamp(occurrence.from) <= now,
    addresses: [...new Set([...addresses, ...mapAddresses])],
    districts: [
      ...new Set(
        [
          ...array(row.localization).map((value) => plainText(value?.name)),
          ...features.map((value) => plainText(value?.properties?.district)),
        ].filter(Boolean),
      ),
    ],
    categories: array(row.category)
      .map((value) => plainText(value?.name))
      .filter(Boolean),
    locations,
    distanceMeters:
      locations.length === 1 ? Math.round(destination(origin, locations[0]!).distance) : null,
  };
}
