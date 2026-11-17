# OMSI Schilderhilfe

**Was muss ich ins IBIS eingeben?** Die Schilderhilfe liest den Fahrplan einer OMSI-2-Karte und zeigt für jeden Umlauf, welche **Linie**, **Route** und welches **Ziel** du bei jeder Fahrt eingeben musst. Sie funktioniert mit jeder Karte und läuft komplett im Browser. Es wird nichts hochgeladen.

*English: A browser tool that reads an OMSI 2 map's timetable and hof file and shows, for every tour, the line, route and destination code to enter into the IBIS. Works with any map, runs locally in your browser.*

## So benutzt du sie

1. Seite öffnen.
2. Den Kartenordner `OMSI 2/maps/<Karte>` auf die Seite ziehen oder über **Ordner wählen** auswählen.
3. Einen Umlauf wählen (die Nummer steht im Spiel oben links im Fahrplan). Daneben steht die Schildertabelle.

Weitere Ansichten:
- **Fahrt finden:** Uhrzeit an der ersten Haltestelle eingeben, ohne den Umlauf zu kennen.
- **Ziele & Routen:** alle Zielcodes und Routen der Hof-Datei. Das funktioniert auch, wenn du nur die `.hof`-Datei hast.

Liegt die Hof-Datei nicht im Kartenordner, sondern nur in den Busordnern, wählst du sie zusätzlich über **Einzelne Dateien**.

## Woher die Daten kommen

| Datei | Inhalt |
|---|---|
| `TTData/*.ttl` | Linien und Umläufe: `[newtour]` Nummer, Depot, Tagesmaske; `[addtrip]` Fahrt, Profil, Abfahrt in Minuten |
| `TTData/*.ttp` | Fahrt: `[trip]` Strecke, Zielname, Linientext; `[station_typ2]` Haltestellen |
| `TTData/Busstops.cfg` | Namen der Haltestellen zu den Objekt-IDs |
| `*.hof` | Ziele (`[addterminus…]`) und Routen (`[infosystem_trip]`: Code = Linie × 100 + Route, Ziel, Haltestellen) |

Die `.ttp` sagt nicht, welche Route im IBIS gemeint ist. Darum ordnet die Schilderhilfe jede Fahrt der passenden Hof-Route zu, über den Namen, die Linie, das Ziel und die Reihenfolge der Haltestellen. Ist die Zuordnung nicht eindeutig, steht neben dem Ziel „wahrscheinlich“ oder „unsicher“.

Die Formate sind in der Dokumentation von [openOMSI](https://github.com/openOMSI-org/openOMSI) (`docs/FORMATS.md`, `docs/ROUTES.md`) beschrieben.

## Projektaufbau

```
index.html            Seite
assets/style.css      Aussehen (Farben als Variablen oben in der Datei)
assets/icon.svg
src/app.js            Oberfläche
src/i18n.js           Texte Deutsch/Englisch
src/io.js             Ordner/Dateien einlesen, Zeichensatz erkennen
src/load.js           Karte laden
src/model.js          Fahrt ↔ Hof-Route zuordnen, Umläufe aufbereiten
src/parse/cfg.js      OMSI-Blockformat [keyword]
src/parse/hof.js      Hof-Dateien (Listen- und klassisches Format)
src/parse/ttdata.js   .ttl, .ttp, Busstops.cfg
tests/                Tests mit einer erfundenen Mini-Karte „Testhausen“
```

Reines HTML, CSS und JavaScript, kein Build-Schritt, keine Abhängigkeiten.

## Lokal starten

Weil die Seite JavaScript-Module nutzt, braucht sie einen kleinen Webserver. Ein Doppelklick auf `index.html` reicht nicht.

```bash
python -m http.server 8080
# oder
npx http-server -p 8080
```

Dann `http://localhost:8080` öffnen.

Tests (Node 20 oder neuer):

```bash
npm test
```

## Auf GitHub Pages veröffentlichen

1. Neues Repository auf GitHub anlegen, zum Beispiel `omsi-schilderhilfe`.
2. Den Inhalt dieses Ordners hochladen (per „Add file → Upload files“ oder mit `git push`).
3. Im Repository unter **Settings → Pages** bei „Source“ **Deploy from a branch** wählen, Branch `main`, Ordner `/ (root)`.
4. Nach ein bis zwei Minuten läuft die Seite unter `https://<dein-name>.github.io/omsi-schilderhilfe/`.

## Noch offen

- [ ] Mit echten `TTData`-Ordnern mehrerer Karten testen (Lemmental-Neuenbreid, Thüringer Wald, Berlin-Spandau …)
- [ ] Chrono-Szenarien (`Chrono/*/TTData`) berücksichtigen, zum Beispiel für Event-Fahrten
- [ ] Zeichensatz wählbar machen (z. B. Windows-1250/1251 für polnische und russische Karten)
- [ ] Ankunftszeiten aus den Fahrtprofilen berechnen
- [ ] Gestaltung und Hintergrund

## Lizenz

MIT, siehe [LICENSE](LICENSE). OMSI ist eine Marke von MR-Software und Aerosoft. Dieses Projekt ist von beiden unabhängig.
