# Ember

A J2ME MIDlet (MIDP 2.0 / CLDC 1.1) client for the Łódź / Pabianice transit
backend, written for the **Sony Ericsson J20i** (240x320, T9 keypad + D-pad,
NetFront, Polish locale).

Plain HTTP only, no JSON, no `String.split()`, no threads other than one per
network fetch, `InputStreamReader("UTF-8")` throughout.

```
ember-midlet/
├── Ember.jad                     application descriptor (UTF-8)
├── build.xml                     ant build: compile, preverify, package
├── src/ember/
│   ├── Ember.java                MIDlet + all five screens
│   ├── HttpUtil.java             HTTP, parser, RMS cache
│   ├── Route.java                R line + label/title formatting
│   ├── WalkPart.java             W line
│   └── TransitPart.java          T line
└── test/                         desktop tests (see "Tests" below)
    ├── ParserTest.java
    └── stubs/javax/microedition/  shims compiled ONLY for the tests
```

## Screens

| # | Screen | Notes |
|---|--------|-------|
| 1 | `QueryScreen` | `TextField` defaulting to *Międzynarodowa*; **Szukaj** / **Wyjście** |
| 2 | `RouteListScreen` | `* 507 → Gocław   16:12–16:29  (25 min)`; left **Wyjście**, right **Wybierz** |
| 3 | `DetailScreen` | title `507 → Gocław`, rows = `Idź 690m do Centrum`, `Bus 507 do Saska (5 przyst.)`; left **Menu** |
| 4 | `WalkViewerScreen` | `Pieszo 1/3`, description wrapped at 26 chars; ◄/► part, ▲/▼ scroll, `1`-`9` jump; left **Mapa**, right **Wstecz** |
| 5 | `MapViewerScreen` | full-screen 240x320 JPEG, `Ładowanie mapy...`, status bar with the walk description; left **Odśwież**, right **Wstecz** |

Screen 3's **Menu** offers *Pokaż części piesze* (only when the route has `W`
parts), *Mapa* (only when a walking row is selected), *Odśwież* and *Powrót*.

## Backend contract as implemented

```
GET /v?msg=<query>                      -> line-delimited UTF-8 text
GET /v/map?route=<routeIndex>&part=<walkPartIndex>  -> 240x320 baseline JPEG

R|<routeId>|<line>|<direction>|<depTime>|<arrTime>|<durationMin>
W|<partIndex>|<type>|<distanceM>|<description>|<lon,lat;lon,lat;...>
T|<line>|<direction>|<fromStop>|<toStop>|<stopCount>
```

Requests set `User-Agent: EmberMIDP/1.0` and `Connection: close` (Sony Ericsson
firmwares are happier without keep-alive). The body is read with `getLength()`
when the server sends a size, otherwise in 512-byte chunks into a
`ByteArrayOutputStream`. `HttpConnection` has **no** `setTimeout()` in MIDP 2.0,
so a watchdog thread closes the connection after 15 s; the resulting
`IOException` is surfaced as `Timeout 15s`.

**This contract is implemented by `server/` in this repo** and deployed at
`http://34.61.173.205:5000` (port **5000**, not 3000 - 3000 is the separate
Next.js Ember app, which answers `/v` with chat prose for its own legacy client
`EmberVeer`). `BASE_URL` in `Ember.java` already points at 5000.

The MIDlet is defensive about the server anyway: when a `200` body contains no
`R/W/T` lines it shows the raw answer in an *Odpowiedź serwera* `TextBox`
instead of reporting a fake error, and a non-JPEG map body is reported as
`Błąd mapy: IllegalArgumentException: ...`.

## Build with the Sun WTK and `ant` (verified)

Two JDKs are involved. The **compiler must be a JDK 8 javac**: from Java 7 on,
`javac` compiles `+` on strings with `java.lang.StringBuilder`, which does not
exist in CLDC 1.1, so `-source 7` cannot even compile against `cldcapi11.jar`.
`-source 1.4 -target 1.4` also keeps the class files at version 48.0, which is
what a CLDC 1.1 VM accepts.

```sh
export WTK_HOME=/opt/sun-wtk                 # WTK 2.5.2, needs lib/cldcapi11.jar + lib/midpapi20.jar
export JAVA8_HOME=/usr/lib/jvm/java-8-openjdk

ant            # -> dist/Ember.jar (preverified) + dist/Ember.jad with real MIDlet-Jar-Size
ant test       # desktop parser tests, no WTK needed
ant clean
```

The `dist` target runs, in order:

```sh
javac -bootclasspath "$WTK_HOME/lib/cldcapi11.jar:$WTK_HOME/lib/midpapi20.jar" \
      -source 1.4 -target 1.4 -encoding UTF-8 -d build/classes src/ember/*.java
"$WTK_HOME/bin/preverify" -classpath "$WTK_HOME/lib/cldcapi11.jar:$WTK_HOME/lib/midpapi20.jar" \
      -d build/preverified build/classes
jar  ... # manifest carries MIDlet-1 / MicroEdition-Profile / MicroEdition-Configuration
```

The preverify step is the real gate: it fails on anything MIDP 2.0 does not
have, so a green build means no MIDP 3.0 or HTTPS-only API slipped in.
On Windows pass `-Dpreverify.tool=%WTK_HOME%\bin\preverify.exe`.

The checked-in `Ember.jad` intentionally carries the placeholder
`MIDlet-Jar-Size: 0`; `ant dist` writes `dist/Ember.jad` with the real size
filled in. If you package by hand, update that line (or the phone will refuse
the install with "invalid descriptor").

## Build with NetBeans Mobility

1. Install **NetBeans IDE 8.2** with the *Java ME* plugin plus the **Java ME
   SDK 8.2** or **Sun WTK 2.5.2** at *Tools → Java Platforms → Add Platform*.
2. *File → New Project → Java ME → Mobile Application*; name it `Ember`,
   uncheck *Create Hello MIDlet*, and set **Emulation/Device** to
   *DefaultCldcPhone1* or the *Sony Ericsson* profile if present.
3. Delete the generated `HelloMIDlet`, then right-click the project → *Add
   Existing Sources* → pick `src/ember/*.java` (package `ember`).
4. Open the project's **Application Descriptor** (*Ember.jad*) tab and copy the
   values from `Ember.jad` — at minimum `MIDlet-1: Ember, , ember.Ember`,
   `MIDP-2.0`, `CLDC-1.1`. NetBeans regenerates `MIDlet-Jar-Size` for you.
5. *Project Properties → Sources*: **Source Level 1.4**, encoding **UTF-8**.
6. *Run* builds the suite and launches the platform emulator.

## Run in MicroEmulator

```sh
java -jar microemulator.jar dist/Ember.jad
# or simply drag dist/Ember.jar onto the MicroEmulator window
```

MicroEmulator 2.0.4 speaks `javax.microedition.io` over the desktop's
`java.net`, so plain HTTP works and no WTK is needed. Notes:

* Pick a 240x320 device profile (*Resizable device* → 240x320) so the map page
  and the walk viewer lay out like on the J20i.
* Soft keys are the two on-screen buttons; command priorities map the same way
  as on the device.
* It has no NetFront and a different default font, so the `→`/`–` glyphs and
  the alert text can look different from the phone.

## Sideload onto the J20i

**Over the air (easiest)**

Open `http://34.61.173.205:5000/download/` on the phone and install `Ember.jad`
(the JAD's `MIDlet-Jar-URL` is relative, so the JAR is fetched from the same
directory automatically). That directory is served by the transit API itself.

**Bluetooth**

1. Pair the phone with the PC (phone PIN, e.g. `0000`).
2. Put the phone into *Receive* / make it discoverable, then send the file:
   ```sh
   bluetooth-sendto --device=AA:BB:CC:DD:EE:FF dist/Ember.jar     # or use the GUI "Send to"
   ```
   Send `dist/Ember.jar` — it already carries `MIDlet-1` in its manifest, so the
   phone can install from the jar alone. Send `dist/Ember.jad` as well only if
   your firmware insists on a descriptor pair.
3. On the phone: *Menu → Organizer → File manager → Received files* → select
   `Ember.jar` → *Install* → choose *Other*/*Applications* folder.
4. Allow unsigned installation if prompted
   (*Menu → Settings → General → Security → allow untrusted*).

**Cable / mass storage**

1. Connect the USB cable and mount the phone as a mass storage device.
2. Copy `dist/Ember.jar` (and `dist/Ember.jad`) into the `Other/` folder on the
   memory card.
3. On the phone: *File manager → Other → Ember.jar → Install*.
   Sony Ericsson PC Suite / MyPhoneExplorer can also install `.jad` + `.jar`
   pairs directly.

**First run**

* The MIDlet asks for network permission on the first fetch — allow it. Grant
  it "always" for the session if your firmware offers that.
* If the fetch fails with `IOException: HTTP ...`, check *Settings →
  Connectivity → Internet settings*: the Java app follows the phone's default
  internet profile, which must be a real APN (not MMS/WAP).
* Nothing is signed; a trusted (signed) MIDlet is only needed if you later add
  JSR-75 file access.

## Encoding and locale

* All sources are UTF-8 and must be compiled with `-encoding UTF-8` (the ant
  build sets it). `Ember.jad` is UTF-8 as well; `build.xml` keeps it ASCII.
* The response is decoded with `InputStreamReader(..., "UTF-8")`, and the query
  string is percent-encoded as UTF-8 (`Międzynarodowa` →
  `Mi%C4%99dzynarodowa`), so Polish input and Polish stop names both survive.
* The J20i font may lack `U+2192` (→) and `U+2013` (–). If you see boxes on the
  phone, open `Route.java` and set `ARROW = "->"`, `DASH = "-"`: every label in
  the MIDlet is built from those two constants. The walk marker is already
  plain ASCII (`*`) for the same reason.

## Cache

On every successful `/v` fetch the raw response plus a timestamp are stored in
the RMS record store `emberCache` (one record: `<millis>\n<body>`). On launch, a
cache younger than 5 minutes is parsed and shown immediately instead of
re-fetching. Map JPEGs are deliberately **not** cached — the J20i record limit
is about 64 KB and it would burn heap for no benefit.

## Tests

```sh
ant test
```

`test/ParserTest.java` compiles the real `HttpUtil`/`Route`/`WalkPart`/
`TransitPart` sources against desktop shims of `javax.microedition.io` and
`javax.microedition.rms` (the shims are never part of `Ember.jar`; the `jar`
target only reads `build/preverified`) and checks:

* `R`/`W`/`T` parsing, UTF-8 descriptions, part ordering, label formatting;
* a `200` body that is prose or empty yields zero routes instead of an exception;
* the splitter keeps trailing empty fields (so a `W` line without geometry works);
* UTF-8 percent-encoding of Polish queries;
* shape scaling onto 240x320, with empty/malformed shapes left as `null`;
* the RMS cache round-trip and the empty-cache path.

## Known limitations

* HTTP only, by design — see the brief.
* Timeouts rely on a watchdog thread because MIDP 2.0 has no `HttpConnection.setTimeout()`.
* `W` shapes are parsed and scaled but never drawn: the server renders the map.
* At most the 8 routes the backend returns; there is no paging and no
  "next departures" refresh, and the walking viewer scrolls one line per key press.
