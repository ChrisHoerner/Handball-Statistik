# Spielstatistik-PWA – Einrichtung

Ersetzt die alte Excel-Datei durch: einmalige Kaderpflege in einem Google Sheet +
eine installierbare Web-App für die Live-Erfassung, die auch ohne Netz weiterläuft
und Daten synchronisiert, sobald wieder Verbindung besteht.

## 1. Google Sheet anlegen

Neues Google Sheet, mit genau diesen Tabs (Tab-Namen exakt so schreiben):

| Tab | Spalten |
|---|---|
| `Kader` | `Name` \| `Rückennummer` \| `Position` |
| `Kader_Runde` | `Name` \| `Runde` \| `Status` |
| `Spiele` | `SpielID` \| `Datum` \| `Gegner` \| `Runde` \| `Tore_eigene` \| `Tore_gegner` |
| `Aktionen` | `AktionID` \| `SpielID` \| `SpielerinID` \| `Halbzeit` \| `Aktionstyp` \| `Ergebnis` \| `Quelle` \| `Zeitstempel` |
| `Einsatz` | `SpielID` \| `SpielerinID` \| `Start` \| `Ende` *(in Version 1 noch nicht angebunden, siehe unten)* |

Keine eigene Spielerinnen-ID nötig – die Verknüpfung zwischen `Kader` und
`Kader_Runde` läuft direkt über den Namen. In `Aktionen`/`Einsatz` trägt die
Spalte `SpielerinID` trotzdem nur den Namen ein (Spaltenname historisch so
benannt, Inhalt ist schlicht z. B. `Mara`).

`Position` in `Kader` ist entweder `Feld` oder `TW` – steuert, ob in der App die
Feldspielerinnen- oder die Torwart-Ansicht erscheint.

`Status` in `Kader_Runde` ist `aktiv` oder `inaktiv` – das ist die Stelle, an der
Kaderwechsel pro Runde eingetragen werden. Der Name selbst steht nur einmal in
`Kader`.

Tragen Sie Ihren aktuellen Kader einmal in `Kader` ein und in `Kader_Runde` je
eine Zeile pro Spielerin und Runde mit Status `aktiv`. Der Name muss in beiden
Tabs exakt gleich geschrieben sein (Groß-/Kleinschreibung bei Status ist egal,
beim Namen zählt sie).

## 2. Backend (Google Apps Script)

1. Im Sheet: **Erweiterungen → Apps Script**.
2. Inhalt von `apps-script.gs` einfügen (überschreibt den leeren Code.gs).
3. **Bereitstellen → Neue Bereitstellung → Web-App**.
   - Ausführen als: **Ich**
   - Zugriff: **Jeder** (die URL ist geheim genug für diesen Zweck, nicht weitergeben)
4. Die erzeugte URL (endet auf `/exec`) kopieren – die brauchen Sie gleich in der App.

## 3. App hosten (GitHub Pages, kostenlos)

1. Neues GitHub-Repository anlegen, z. B. `handball-statistik`.
2. Alle Dateien aus diesem Ordner hochladen (`index.html`, `app.js`, `style.css`,
   `manifest.json`, `sw.js`, `icons/`).
3. **Settings → Pages → Branch: main → Save.**
4. Nach ein bis zwei Minuten ist die App unter
   `https://<ihr-github-name>.github.io/handball-statistik/` erreichbar.
5. Auf dem Handy der Betreuerin die Seite öffnen → Browser-Menü →
   **„Zum Startbildschirm hinzufügen"**. Ab dann startet die App wie eine normale
   App, auch ohne Netz.

## 4. Vor dem ersten Spiel

1. App öffnen, Tab **Einstellungen**: Apps-Script-URL eintragen, Runde eintragen
   (z. B. `2026/27 Rückrunde`), **Speichern**.
2. **„Kader jetzt laden"** tippen – das braucht einmalig Internet (zu Hause,
   nicht erst in der Halle). Der Kader liegt danach lokal auf dem Gerät und
   funktioniert ab da auch ohne Netz.

## 5. Am Spieltag

1. Tab **Spiel**: Gegner + Datum eintragen, **Spiel starten**. Funktioniert auch
   offline – das Spiel wird beim nächsten Sync nachgereicht.
2. Tab **Erfassung**: Halbzeit oben wählen, Spielerin antippen, dann die
   passende Aktion antippen. Jeder Tipp ist sofort gespeichert – kein
   „Speichern"-Knopf nötig.
3. Die Statusleiste oben zeigt an, ob gerade online/offline gesynct wird und
   wie viele Einträge noch warten.
4. Fehltipp passiert: unten bei „Letzte Aktionen" mit **↩ Rückgängig** sofort
   korrigieren.

## Bekannte Einschränkungen von Version 1 (bewusst nicht mitgebaut)

- **Einsatzzeit (Ein-/Auswechslung) ist noch nicht in der App abgebildet.**
  Der Tab `Einsatz` existiert im Schema, aber die App schreibt aktuell nichts
  hinein. Das lohnt einen eigenen Anlauf, um es nicht hastig dranzuflicken.
- **Rückgängig nach erfolgtem Sync** löscht nur lokal auf dem Gerät und warnt
  Sie – die Zeile im Google Sheet muss dann noch von Hand gelöscht werden.
- **Kader-Update während der Saison**: Wenn sich der Kader ändert, muss vor dem
  nächsten Spiel einmal wieder „Kader jetzt laden" gedrückt werden (mit Netz).
  Das passiert nicht automatisch im Hintergrund.
- Die App wurde nicht in einer echten Sporthalle getestet – vor dem ersten
  Pflichtspiel unbedingt bei einem Training einmal durchspielen, inklusive
  Flugmodus an/aus, um den Offline-Sync wirklich zu sehen.
