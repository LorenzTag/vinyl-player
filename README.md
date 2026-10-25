# Vinyl Player

Web-App für das iPad, die deine Spotify-Bibliothek als Plattensammlung zeigt und
später die Spotify-App per **Spotify Connect** steuert. Sie spielt selbst keinen
Ton ab und läuft als Homescreen-App (PWA) im Vollbild.

**Stand: Menü und Plattenspieler, noch ohne Spotify.** Die Daten sind Mock-Daten
(je 12 Playlists und Alben, 8 „Zuletzt gehört", Titellisten). Ein simuliertes
Abspielgerät verhält sich wie Spotify Connect: Es verwaltet Titel, Fortschritt
und Pause und springt am Titelende weiter. Ton gibt es noch keinen.

## Starten

Voraussetzung: Python 3 (auf dem Mac vorhanden). Kein `npm install`, kein Build.

```bash
python3 dev-server.py
```

Der Server zeigt beim Start zwei Adressen:

- **Mac:** `http://127.0.0.1:8080`
- **iPad:** `http://<IP-des-Mac>:8080`. Beide Geräte müssen im selben WLAN sein.

Anderer Port: `python3 dev-server.py 8081`. Fragt macOS beim ersten Start, ob
Python eingehende Verbindungen annehmen darf, mit **Erlauben** antworten. Sonst
erreicht das iPad den Server nicht.

Der Server schickt `Cache-Control: no-store`. Safari lädt deshalb nach jeder
Änderung den aktuellen Code, Neuladen genügt. Im Terminal erscheinen nur Fehler
(z. B. `404 /pfad`) und neu verbundene Geräte. So sieht man auch, ob das iPad
den Server erreicht.

### Auf den Homescreen legen (iPad)

In Safari die Adresse öffnen, dann **Teilen → Zum Home-Bildschirm**. Die App
startet danach im Vollbild ohne Safari-Leiste.

Zum Testen reicht die WLAN-Adresse. Für den Spotify-Login (Schritt 2) braucht es
HTTPS, also GitHub Pages (siehe unten).

### Testmodi

Fehlerfälle lassen sich per URL-Parameter simulieren:

| Parameter     | Wirkung                                                           |
|---------------|-------------------------------------------------------------------|
| `?mock=slow`  | 2,5 s Ladezeit (Ladeanzeige)                                      |
| `?mock=error` | jede Anfrage scheitert, nach 2 automatischen Versuchen kommt die Fehleranzeige |
| `?mock=flaky` | erster Versuch scheitert, die automatische Wiederholung klappt    |
| `?mock=empty` | leere Bibliothek                                                  |
| `?mock=nodevice` | Abspielen scheitert mit „kein aktives Gerät" (Tonarm geht zurück) |

## Bedienung

- **Tabs:** Playlists, Alben, Zuletzt gehört
- **Umschalter oben rechts:** *Stapel* (Cover-Flow auf Filz) oder *Regal*
  (Holzregal mit Papier-Etiketten). Die Wahl wird gespeichert.
- **Stapel:** wischen, mit Schwung, die Hüllen rasten ein. Eine seitliche Hülle
  antippen holt sie in die Mitte, die mittlere antippen öffnet sie.
  Am Mac gehen auch Pfeiltasten, Trackpad und Mausrad.
- **Plattenspieler:** Hintergrund, Vinyl (farbig, marmoriert) und Etikett nehmen
  die Farben des Covers an.
  - **Tonarm auf die Platte ziehen** startet die Wiedergabe, herunterziehen
    pausiert. Wo die Nadel landet, bestimmt den Titel, wie bei echtem Vinyl. Beim
    Ziehen zeigt ein Hinweis, welcher Titel unter der Nadel liegt. Während der
    Wiedergabe wandert der Arm langsam nach innen. Antippen schaltet ebenfalls um.
  - **Nach links/rechts wischen:** nächster/vorheriger Titel. „Zurück“ startet
    nach 3 Sekunden zuerst den laufenden Titel neu.
  - **Platte zur Hülle ziehen:** Die Platte wird eingepackt, die Wiedergabe endet,
    und du bist zurück in der Sammlung.
  - **Leiste:** „Sammlung“ geht zurück, die Musik läuft dabei weiter. Außerdem
    ⏮ ▶/❚❚ ⏭ und die **Titelliste** (Beiblatt). Ein Titel antippen spielt genau diesen.
- **Mini-Player:** Läuft eine Platte, schwebt in der Sammlung unten ein
  Mini-Player mit Pause und Weiter. Ein Tipp darauf öffnet den Plattenspieler wieder.
- **Zurück:** „Sammlung“-Button, Escape oder die Zurück-Geste des Browsers

## Aufbau

```
index.html              Einstieg, PWA-Meta-Tags
manifest.webmanifest    PWA-Manifest
icons/                  App-Icons (erzeugt von tools/make-icons.py)
dev-server.py           lokaler Dev-Server (WLAN, ohne Cache)
src/
  main.js               verbindet Datenquelle → Zustand → Oberfläche
  data/                 Datenschicht
    types.js            eigene Datentypen (unabhängig vom Spotify-JSON)
    errors.js           einheitliche Fehler (Netz, Timeout, 429, kein Gerät …)
    source.js           wählt die Datenquelle ← hier kommt in Schritt 2 Spotify rein
    mock-source.js      Mock-Daten inkl. Titellisten und simulierter Fehler
  playback/             Abspielgerät
    device.js           wählt das Gerät ← hier kommt in Schritt 2 Spotify Connect rein
    mock-device.js      simuliertes Gerät (Titel, Fortschritt, Pause, Weiter)
  state/                Zustand
    store.js            minimaler Store (set/subscribe)
    app-state.js        Form des Zustands, gemerkte Einstellungen
    library.js          Laden mit Abbruch, automatischen Wiederholungen, „wieder online"
    playback.js         Wiedergabe-Befehle (nacheinander), Titellisten-Cache, Fehler
  ui/                   Oberfläche (kennt nur Zustand und Domänen-Typen)
    app.js              Kopfleiste, Ansichten, Öffnen/Schließen, History
    crate-view.js       Stapel (Cover-Flow), eigene Wischgeste
    shelf-view.js       Regal
    record-player.js    Plattenspieler: Animation, Gesten, Leiste
    tonearm.js          Tonarm (Ziehen, Titelwahl, Fortschritt)
    tracklist.js        Titelliste als Beiblatt
    mini-player.js      Mini-Player in der Sammlung
    cover-art.js        echtes Cover oder generiertes Platzhalter-Cover
    cover-colors.js     Farben für Hintergrund und Vinyl aus dem Cover
    …
  styles/               tokens, Texturen (CSS + SVG-Rauschen), je Ansicht ein File
tools/make-icons.py     erzeugt die PNG-Icons ohne Abhängigkeiten
```

**Datenquelle austauschen:** Jede Quelle erfüllt die Schnittstelle `LibrarySource`
aus `src/data/types.js` (`getPlaylists`, `getAlbums`, `getRecentlyPlayed`) und
liefert `RecordItem`s. Die Spotify-Quelle übersetzt API-Antworten in diese Form.
In `src/data/source.js` wird sie statt der Mock-Quelle eingehängt. UI und Zustand
bleiben dabei unverändert. Hat ein Eintrag eine `imageUrl`, zeigt die Hülle das
echte Cover. Lädt das Bild nicht, erscheint wieder das Platzhalter-Cover.

**Icons neu erzeugen:** `python3 tools/make-icons.py`

## Technik und Grundsätze

- Vanilla HTML/CSS/JS mit nativen ES-Modulen, **keine Abhängigkeiten, kein Build**.
  Der Ordner ist so, wie er ist, statisch hostbar (GitHub Pages).
- Typen per JSDoc und `// @ts-check`: VS Code prüft sie, ohne Compiler.
- Animiert werden nur `transform` und `opacity`. Jede Animation hat eine
  Zeitgrenze und endet garantiert in einem sauberen Zustand, auch wenn sie
  unterbrochen wird.
- Texturen (Holz, Filz, Papier) sind reines CSS plus selbst erzeugtes
  SVG-Rauschen. Es gibt keine Bilddateien von Dritten und keine Web-Fonts:
  Genutzt werden die Systemschriften New York und SF Pro.
- Safe Areas, Hoch- und Querformat sowie Touch-Ziele ≥ 44 px werden berücksichtigt.
- Noch kein Service Worker, damit während der Entwicklung keine alte Version im
  Cache hängen bleibt. Er kommt mit versioniertem Cache vor dem Deploy.

## Ausblick: Schritt 2 (Spotify)

Vorbereitet, aber noch nicht gebaut:

- Login per Authorization Code Flow mit PKCE. Es gibt kein Client-Secret, also
  nichts Geheimes im Repo.
- Ein zentraler HTTP-Wrapper übernimmt:
  - Timeout für jede Anfrage
  - 401: einmalige Token-Erneuerung, auch wenn mehrere Anfragen gleichzeitig scheitern
  - 429: die Wartezeit aus `Retry-After` einhalten
  - Netz- und 5xx-Fehler: erneut versuchen mit wachsender Pause
  - typisierte Fehler (`src/data/errors.js`)
- Geplant für „Kein aktives Gerät": ein Button „Spotify öffnen", der die App
  aufweckt, danach wird die Wiedergabe aufs iPad übertragen.

Wichtig dafür:

- Spotify akzeptiert als Redirect-URI nur HTTPS oder `http://127.0.0.1`. Der Login
  funktioniert also auf dem Mac über 127.0.0.1 und auf dem iPad über GitHub Pages,
  **nicht** über die WLAN-IP.
- Homescreen-App und Safari haben auf iOS getrennten Speicher. Anmelden muss man
  sich deshalb in der installierten App.
- Die Steuerung über die Web API erfordert Spotify Premium.
