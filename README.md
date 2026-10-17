# ProwadźMnie

Nawigator pieszy dla osób starszych. Patrzysz przez aparat telefonu, a aplikacja pokazuje, w którą stronę iść. Możesz też zapytać głosem, a ona odpowie prostymi słowami.

## Co robi

- Pokazuje na obrazie z aparatu duży znak celu, odległość i strzałkę: „Idź prosto”, „Skręć w prawo”, „Odwróć się”.
- Ma główny przycisk na dole: **Przytrzymaj i mów**. Trzymasz, mówisz, puszczasz.
- Czyta na głos po polsku sam tekst nowych powiadomień, bez dodatkowego wstępu. Wśród nich jest wiadomość od córki Marii, która chce odwiedzić Jadwigę z wnuczkiem Kajetanem; ta wiadomość nie zmienia celu nawigacji. Jeśli trwa rozmowa, czeka na jej zakończenie; kolejne powiadomienia czyta po kolei. Zamknięcie karty nie usuwa powiadomienia z kolejki odczytu.
- Ma przycisk **SOS / Pomoc** na dole po lewej, także przed zgodą na aparat i GPS. Zatrzymuje rozmowę i nawigację, a potem pozwala wybrać kontakt, opisać sytuację albo zamknąć pomoc.
- Odpowiada po polsku, krótko i spokojnie, jeden krok naraz. Przypomina o ostrożności przy przejściach.
- Wyszukuje nadchodzące wydarzenia z miejskiego kalendarza Warszawy, pomijając zakończone terminy.
- Pomaga dojść w nowe miejsce, np. „Zaprowadź mnie do apteki”, i pamięta, na którym etapie drogi jesteś.
- Duże litery i mocny kontrast, w kolorach podobnych do jakdojade.

## Jak używać

1. Otwórz aplikację i naciśnij **Zaczynamy**. Zgódź się na aparat i lokalizację.
2. Wyjdź na zewnątrz i trzymaj telefon przed sobą.
3. Idź za strzałką. Gdy masz pytanie, przytrzymaj żółty przycisk i mów.

## Pomoc

Naciśnięcie **SOS / Pomoc** od razu przerywa odpowiedź asystenta, rozpoznawanie mowy, czytanie powiadomień i oczekujące żądania sieciowe. Wszystkie aktywne trasy zostają wstrzymane, a cel kompasowy usunięty. Zapisane drogi pozostają w pamięci i wymagają wyraźnego wznowienia; zamknięcie pomocy ani powrót z aplikacji Telefon nie uruchamia prowadzenia.

Ekran pomocy pyta i mówi: „Co się stało, Jadwigo? Czy potrzebujesz pomocy?”. Pokazuje tylko trzy przyciski: **Zadzwoń**, **Opisz / opowiedz** i **Pomyłka**. Nie ma wyboru kategorii problemu.

**Zadzwoń** pokazuje Marię (111-111-111), pogotowie (999) i numer alarmowy (112). Wybranie kontaktu od razu otwiera aplikację Telefon z przygotowanym numerem, bez kolejnego potwierdzenia w naszej aplikacji. Użytkowniczka sama zatwierdza połączenie w telefonie. Aplikacja nie wykonuje połączeń ani nie korzysta z uprawnienia bezpośredniego dzwonienia. Numery służb: [Pacjent.gov.pl](https://pacjent.gov.pl/pogotowie-i-numer-alarmowy).

**Opisz / opowiedz** pozwala wpisać opis albo świadomie włączyć mikrofon do dyktowania. Opis pozostaje widoczny przy wyborze kontaktu, żeby można było przeczytać go przez telefon; nie jest automatycznie wysyłany do Marii, służb ani asystenta AI. Wyjście z tego ekranu zatrzymuje mikrofon. **Pomyłka**, cofnięcie i samo otwarcie SOS nie otwierają telefonu ani nie wznawiają nawigacji.

Przyciski pomocy i wpisywanie opisu nie wymagają OpenRouter, map, aparatu, GPS ani internetu. Dyktowanie korzysta z usługi rozpoznawania mowy telefonu i może wymagać internetu. Testy używają atrap i nigdy nie wywołują rzeczywistych numerów.

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

Asystent wybiera domyślnie jedną propozycję, najwyżej dwie, i odpowiada w maksymalnie dwóch zdaniach oraz 35 słowach. Więcej szczegółów podaje na prośbę. Uwzględnia ból nóg Jadwigi, okresowe migreny i unikanie znacznego wysiłku: preferuje bliskie, krótkie, spokojne spotkania z siedzeniami, jeśli opis potwierdza takie warunki. Nie proponuje długich spacerów, długiego stania ani wydarzeń z potwierdzonym hałasem lub migającym światłem. Brak istotnych danych zaznacza krótko, zamiast zakładać dostępność lub bezpieczeństwo. Pięć wyników narzędzia służy porównaniu kandydatów, nie odczytaniu całej listy.

Odległość jest liczona w linii prostej od aktualnego GPS, a przy jego braku od adresu Jadwigi przy Racławickiej 17; odpowiedź zaznacza ten drugi przypadek. Wydarzenia bez współrzędnych lub z kilkoma lokalizacjami mają nieznaną odległość i trafiają za pozostałymi. Trwająca wystawa nie oznacza otwarcia przez całą dobę, a brak ceny nie oznacza bezpłatnego wstępu. Narzędzie nie zmienia celu nawigacji. Przykładowe pytanie: „Jakie są najbliższe wydarzenia w okolicy?”.

Potrzebny jest zainstalowany build deweloperski (nie Expo Go). Nowy build Androida uruchamiaj tylko na wyraźną prośbę użytkownika — limity EAS są małe. Szczegóły w `AGENTS.md`.

Sprawdzanie:

```sh
bun run check
bun run typecheck
bun test
```

Formatowanie i porządkowanie importów: `bun run format`. Projekt używa Biome. Wszystkie lokalne importy, również dynamiczne, korzystają z aliasu `@/` wskazującego katalog główny, np. `@/src/assistant` i `@/App`. Biome odrzuca importy względne `./` i `../`.

Powiadomienia są przewijaną nakładką nad kamerą i nie zmieniają jej położenia ani rozmiaru. Podgląd oraz zamrożony kadr wypełniają ten sam obszar; celowo nie ustawiamy `ratio="16:9"`, które w Expo na Androidzie wybiera dopasowanie `FIT_CENTER`. Wiersz wskazówek rezerwuje wysokość strzałki również przy krótkim statusie GPS. Regresję sprawdza `bun test src/cameraLayout.test.ts`: rzeczywisty JSX `CameraSession` jest układany w Yoga w osobnym procesie, z atrapami sprzętu.
