# ProwadźMnie

Nawigator pieszy dla osób starszych. Patrzysz przez aparat telefonu, a aplikacja pokazuje, w którą stronę iść. Możesz też zapytać głosem, a ona odpowie prostymi słowami.

## Co robi

- Pokazuje na obrazie z aparatu duży znak celu, odległość i strzałkę: „Idź prosto”, „Skręć w prawo”, „Odwróć się”.
- Ma jeden przycisk na dole: **Przytrzymaj i mów**. Trzymasz, mówisz, puszczasz.
- Odpowiada po polsku, krótko i spokojnie, jeden krok naraz. Przypomina o ostrożności przy przejściach.
- Wyszukuje nadchodzące wydarzenia z miejskiego kalendarza Warszawy, pomijając zakończone terminy.
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
- rozpoznawanie mowy (usługa Google w telefonie),
- zapytanie o wspólny kalendarz wydarzeń (API Warszawy, bez wysyłania położenia użytkowniczki); kilka dopasowanych wyników trafia potem do OpenRouter.

## Dla programistów

Aplikacja na Androida (Google Pixel 6a) w Expo i React Native.

```sh
bun install
cp .env.example .env   # wpisz klucze API
bun run start
```

W `.env` ustaw `EXPO_PUBLIC_OPENROUTER_API_KEY` do rozmowy i `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` do miejsc i tras. Dla klucza map włącz **Places API (New)**, **Routes API** i billing w Google Cloud. Do wydarzeń ustaw także `EXPO_PUBLIC_WARSAW_API_TOKEN` (JWT z nowego portalu danych Warszawy). Klucze `EXPO_PUBLIC_*` są częścią tej osobistej aplikacji, więc nie umieszczaj ich w repozytorium. Po zmianie `.env` zrestartuj Metro.

Tool nawigacji pobiera trasę pieszą wraz z instrukcjami i geometrią. Zachowuje ją podczas rozmowy, przerw i wznowień; nowe pytanie nie pobiera jej od nowa. Kolejny odcinek wymaga prośby użytkownika i GPS w pobliżu końca bieżącego odcinka. Zwykłe pytania i streszczanie historii korzystają tylko z OpenRouter.

Tool `warsaw_events` pobiera dane przez `POST https://dane.um.warszawa.pl/api/action/get_bmm_kalendarz_wydarzen` z surowym JWT w nagłówku `Authorization`, bez prefiksu Bearer. Źródło: [Kalendarz wydarzeń — m.st. Warszawa](https://dane.um.warszawa.pl/pl/catalogue/ba202e4b-dfa9-440c-83c0-0b3517520cb8); dokumentacja: [parametry](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pa.json), [przykład](https://dane.um.warszawa.pl/files/bmm_kalendarz_wydarzen_pw.json).

Kalendarz jest pobierany dopiero przy wywołaniu toola i trzymany w pamięci przez 10 minut. Każde wyszukiwanie ponownie usuwa zakończone terminy, również w danych z pamięci. Dla wydarzenia cyklicznego zwraca jeden najbliższy aktualny lub przyszły termin. Domyślnie szuka w najbliższych siedmiu dniach i zwraca do pięciu wyników posortowanych według odległości. Obsługuje też frazę, zakres dat ISO ze strefą, sortowanie po terminie i limit do dziesięciu wyników. Do modelu trafiają tylko wyniki z krótkim opisem, miejscem, terminem i odnośnikiem, bez całego katalogu i bez klucza API.

Odległość jest liczona w linii prostej od aktualnego GPS, a przy jego braku od adresu Jadwigi przy Racławickiej 17; odpowiedź zaznacza ten drugi przypadek. Wydarzenia bez współrzędnych lub z kilkoma lokalizacjami mają nieznaną odległość i trafiają za pozostałymi. Trwająca wystawa nie oznacza otwarcia przez całą dobę, a brak ceny nie oznacza bezpłatnego wstępu. Narzędzie nie zmienia celu nawigacji. Przykładowe pytanie: „Jakie są najbliższe wydarzenia w okolicy?”.

Potrzebny jest zainstalowany build deweloperski (nie Expo Go). Nowy build Androida uruchamiaj tylko na wyraźną prośbę użytkownika — limity EAS są małe. Szczegóły w `AGENTS.md`.

Sprawdzanie:

```sh
bun run check
bun run typecheck
bun test
```

Formatowanie i porządkowanie importów: `bun run format`. Projekt używa Biome. Wszystkie lokalne importy, również dynamiczne, korzystają z aliasu `@/` wskazującego katalog główny, np. `@/src/assistant` i `@/App`. Biome odrzuca importy względne `./` i `../`.
