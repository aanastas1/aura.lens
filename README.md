# ProwadźMnie

Nawigator pieszy dla osób starszych. Patrzysz przez aparat telefonu, a aplikacja pokazuje, w którą stronę iść. Możesz też zapytać głosem, a ona odpowie prostymi słowami.

## Co robi

- Pokazuje na obrazie z aparatu duży znak celu, odległość i strzałkę: „Idź prosto”, „Skręć w prawo”, „Odwróć się”.
- Ma jeden przycisk na dole: **Przytrzymaj i mów**. Trzymasz, mówisz, puszczasz.
- Odpowiada po polsku, krótko i spokojnie, jeden krok naraz. Przypomina o ostrożności przy przejściach.
- Pomaga dojść w nowe miejsce, np. „Zaprowadź mnie do apteki”, i pamięta, na którym etapie drogi jesteś.
- Duże litery i mocny kontrast, w kolorach podobnych do jakdojade.

## Jak używać

1. Otwórz aplikację i naciśnij **Zaczynamy**. Zgódź się na aparat i lokalizację.
2. Wyjdź na zewnątrz i trzymaj telefon przed sobą.
3. Idź za strzałką. Gdy masz pytanie, przytrzymaj żółty przycisk i mów.

## Twoje dane

Aplikacja nie ma żadnej zewnętrznej bazy danych. Wszystko zostaje w telefonie i znika po zamknięciu aplikacji. Do internetu trafia tylko to, co potrzebne do odpowiedzi:

- pytanie i zdjęcie z aparatu (do asystenta AI przez OpenRouter),
- cel i położenie przy szukaniu drogi (bezpośrednio do Google Places i Google Routes),
- rozpoznawanie mowy (usługa Google w telefonie).

## Dla programistów

Aplikacja na Androida (Google Pixel 6a) w Expo i React Native.

```sh
bun install
cp .env.example .env   # wpisz klucze API
bun run start
```

W `.env` ustaw `EXPO_PUBLIC_OPENROUTER_API_KEY` do rozmowy i `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` do miejsc i tras. Dla klucza map włącz **Places API (New)**, **Routes API** i billing w Google Cloud. Po zmianie `.env` zrestartuj Metro.

Tool nawigacji pobiera trasę pieszą wraz z instrukcjami i geometrią. Zachowuje ją podczas rozmowy, przerw i wznowień; nowe pytanie nie pobiera jej od nowa. Kolejny odcinek wymaga prośby użytkownika i GPS w pobliżu końca bieżącego odcinka. Zwykłe pytania i streszczanie historii korzystają tylko z OpenRouter.

Potrzebny jest zainstalowany build deweloperski (nie Expo Go). Nowy build Androida uruchamiaj tylko na wyraźną prośbę użytkownika — limity EAS są małe. Szczegóły w `AGENTS.md`.

Sprawdzanie:

```sh
bun run typecheck
bun test
```
