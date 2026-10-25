# Vinyl Player

Web-App für das iPad, die deine Spotify-Bibliothek als Plattensammlung zeigt und
später die Spotify-App per **Spotify Connect** steuert. Sie spielt selbst keinen
Ton ab und läuft als Homescreen-App (PWA) im Vollbild.

**Stand: Schritt 1 – Menü.** Die Daten sind noch Mock-Daten (je 12 Playlists und
Alben, 8 „Zuletzt gehört"). Ein Tipp auf eine Hülle zieht die Platte heraus und
zeigt einen Platzhalter für den Player aus Schritt 2.

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

## Bedienung

- **Tabs:** Playlists, Alben, Zuletzt gehört
- **Umschalter oben rechts:** *Stapel* (Cover-Flow auf Filz) oder *Regal*
  (Holzregal mit Papier-Etiketten). Die Wahl wird gespeichert.
- **Stapel:** wischen, mit Schwung, die Hüllen rasten ein. Eine seitliche Hülle
  antippen holt sie in die Mitte, die mittlere antippen öffnet sie.
  Am Mac gehen auch Pfeiltasten, Trackpad und Mausrad.
- **Plattenteller:** Den Tonarm auf die Platte ziehen startet die Wiedergabe,
  herunterziehen stoppt sie. Antippen des Arms oder der Play/Stopp-Knopf in der
  Leiste schalten ebenfalls um. Echten Ton gibt es erst mit Spotify (Schritt 2).
- **Zurück:** Button, Escape oder die Zurück-Geste des Browsers

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
    mock-source.js      Mock-Daten inkl. simulierter Fehler
  state/                Zustand
    store.js            minimaler Store (set/subscribe)
    app-state.js        Form des Zustands, gemerkte Einstellungen
    library.js          Laden mit Abbruch, automatischen Wiederholungen, „wieder online"
  ui/                   Oberfläche (kennt nur Zustand und Domänen-Typen)
    app.js              Kopfleiste, Ansichten, Öffnen/Schließen, History
    crate-view.js       Stapel (Cover-Flow), eigene Wischgeste
    shelf-view.js       Regal
    record-player.js    Hülle → Platte gleitet heraus → Platzhalter-Player
    cover-art.js        echtes Cover oder generiertes Platzhalter-Cover
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
