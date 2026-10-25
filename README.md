# Vinyl Player

Web-App für das iPad, die deine Spotify-Bibliothek als Plattensammlung zeigt und
später die Spotify-App per **Spotify Connect** steuert. Sie spielt selbst keinen
Ton ab und läuft als Homescreen-App (PWA) im Vollbild.

**Stand: mit Spotify verbunden.** Nach der Anmeldung zeigt die App deine
Playlists, Alben und zuletzt gehörte Platten und steuert die Spotify-App per
Spotify Connect. Ohne Anmeldung gibt es eine **Demo** mit Beispieldaten und
einem simulierten Abspielgerät.

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

### Spotify einrichten (einmalig)

1. Auf https://developer.spotify.com/dashboard eine App anlegen (**Web API**).
2. Bei **Redirect URIs** genau die Adressen eintragen, unter denen die App läuft:
   - `http://127.0.0.1:8080/` für die Entwicklung am Mac
   - `https://lorenztag.github.io/vinyl-player/` für GitHub Pages bzw. das iPad
3. Die **Client ID** steht in `src/config.js`. Sie ist kein Geheimnis, denn der
   Login nutzt PKCE ohne Client Secret. Das Secret gehört nie in den Code.
4. Im Entwicklermodus braucht der App-Inhaber Spotify Premium. Es dürfen höchstens
   5 Nutzer zugreifen, weitere Konten unter **User Management** eintragen.

Wichtig für den Login:
- Am Mac die App über `http://127.0.0.1:8080` öffnen, **nicht** über `localhost`.
- Über die WLAN-IP (`http://10.…`) geht kein Login, Spotify verlangt dafür HTTPS.
  Fürs iPad die App über GitHub Pages öffnen.
- Im eingebauten Browser-Fenster von Claude scheitert Spotifys Login-Seite. Dafür
  einen normalen Browser nehmen.

### Auf den Homescreen legen (iPad)

In Safari die Adresse öffnen, dann **Teilen → Zum Home-Bildschirm**. Die App
startet danach im Vollbild ohne Safari-Leiste.

Für die Demo reicht die WLAN-Adresse, für Spotify braucht es HTTPS (GitHub
Pages). Homescreen-App und Safari speichern getrennt: Anmelden musst du dich in
der installierten App.

### Testmodi

Fehlerfälle lassen sich per URL-Parameter simulieren:

| Parameter     | Wirkung                                                           |
|---------------|-------------------------------------------------------------------|
| `?mock=slow`  | 2,5 s Ladezeit (Ladeanzeige)                                      |
| `?mock=error` | jede Anfrage scheitert, nach 2 automatischen Versuchen kommt die Fehleranzeige |
| `?mock=flaky` | erster Versuch scheitert, die automatische Wiederholung klappt    |
| `?mock=empty` | leere Bibliothek                                                  |
| `?mock=nodevice` | Abspielen scheitert mit „kein aktives Gerät" (Tonarm geht zurück) |

Jeder `?mock=…`-Parameter startet die Demo, unabhängig von einer Anmeldung.

## Bedienung

- **Tabs:** Playlists, Alben, Zuletzt gehört
- **Umschalter oben rechts:** *Stapel* (Cover-Flow auf Filz) oder *Regal*
  (Holzregal mit Papier-Etiketten). Die Wahl wird gespeichert.
- **Stapel:** wischen, mit Schwung, die Hüllen rasten ein. Eine seitliche Hülle
  antippen holt sie in die Mitte, die mittlere antippen öffnet sie.
  Am Mac gehen auch Pfeiltasten, Trackpad und Mausrad.
- **Plattenspieler:** Hintergrund, Vinyl und Etikett nehmen die Farben des Covers
  an. Etikett und Cover zeigen das aktuelle Lied, bei Playlists das jeweilige
  Album-Cover. Alles geht mit Gesten, die Leiste unten ist optional:

  | Geste | Wirkung |
  |---|---|
  | Tonarm auf die Platte ziehen oder antippen | Abspielen / Pause |
  | Nach oben / unten wischen | nächstes / vorheriges Lied (läuft die Platte noch nicht: Lied auswählen) |
  | Nach links wischen | Titelliste fährt von rechts herein, Plattenspieler rutscht nach links |
  | Nach rechts wischen | Titelliste zu, ohne Titelliste: zurück zur Sammlung (Musik läuft weiter) |
  | Platte aufs Cover ziehen | einpacken: Wiedergabe endet, zurück zur Sammlung |
  | Ins Leere tippen | Standby: Leiste aus- / einblenden |

  Die Leiste bietet dasselbe noch einmal als Knöpfe: Sammlung, ⏮ ▶/❚❚ ⏭ und
  Titelliste. Befehle wirken sofort auf Arm und Platte, Spotify zieht kurz danach nach.
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
  main.js               Start: Spotify oder Demo, Rückkehr vom Login
  data/                 Datenschicht
    types.js            eigene Datentypen (unabhängig vom Spotify-JSON)
    errors.js           einheitliche Fehler (Netz, Timeout, 429, kein Gerät …)
    source.js           Demo-Datenquelle wählen (Spotify-Quelle: src/spotify/)
    mock-source.js      Mock-Daten inkl. Titellisten und simulierter Fehler
  config.js             Spotify Client ID, Berechtigungen, Redirect-URI
  spotify/              Spotify-Anbindung
    auth.js             Login (PKCE), Token-Erneuerung
    api.js              HTTP-Schicht: Timeout, 401, 429, Wiederholungen, Fehler
    spotify-source.js   Bibliothek und Titellisten → eigene Datentypen
    spotify-device.js   Spotify Connect: abspielen, pausieren, Status-Abfrage
  playback/             Abspielgerät
    device.js           Demo-Gerät wählen (Spotify-Gerät: src/spotify/)
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

## Spotify: Verhalten und Grenzen

- **Wiedergabe:** Abgespielt wird auf dem aktiven Spotify-Gerät, sonst auf einem
  iPad/Tablet, sonst auf dem ersten verfügbaren Gerät.
- **Eingefrorene Spotify-App:** iOS friert die Spotify-App im Hintergrund ein, sie
  verschwindet dann aus der Geräteliste. Die App zeigt dafür **Spotify öffnen**.
  Nach der Rückkehr wird der Befehl einmal automatisch wiederholt.
- **Wiedergabe von anderswo:** Was auf einem anderen Gerät oder vor dem Neuladen
  gestartet wurde, erkennt die App und zeigt es im Mini-Player an.
- **Titellisten fremder Playlists:** Spotify gibt sie seit 2026 nur noch für eigene
  oder gemeinsame Playlists heraus. Fremde Playlists werden trotzdem abgespielt,
  der Tonarm wählt den Titel dann über die Position.
- **Einpacken:** Spotify kennt kein Stopp. Beim Einpacken wird pausiert und die
  Platte ausgeblendet, bis wieder etwas läuft.
- **Status-Abfrage:** Spotify meldet keine Änderungen von selbst. Die App fragt
  deshalb alle 3 s nach (pausiert alle 8 s), aber nur, solange sie sichtbar ist.
- **Fehlerbehandlung:** zentral in `src/spotify/api.js`.
  - Jede Anfrage hat ein Timeout.
  - Bei 401 wird das Token einmal erneuert.
  - Bei 429 hält die App die Wartezeit ein.
  - Bei Netzfehlern wird erneut versucht, aber nur bei Leseanfragen. Befehle wie
    „Weiter“ werden nie blind wiederholt.
