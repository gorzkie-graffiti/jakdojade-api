# Jakdojade API Client

A reverse-engineered Node.js client for the Jakdojade public transport API.

## Features

- **Route Search**: Find optimal public transport routes between coordinates, addresses, or stops.
- **Advanced Filtering**: Avoid specific lines, vehicle types, or operators.
- **Accessibility Options**: Filter for wheelchair-accessible vehicles.
- **Fluent Builder API**: Easily construct complex queries using `RouteQueryBuilder`.
- **Anonymous Registration**: Automatically handles device registration and request signing.

## Installation

```bash
npm install jakdojade-api
```

*(Note: This package is currently private/local. You can install it from this repository)*

## Usage

### Basic Usage

```javascript
const { JakdojadeClient } = require('jakdojade-api');

const client = new JakdojadeClient();

const start = {
    citySymbol: "WARSZAWA",
    coordinate: { y_lat: 52.2319, x_lon: 21.0067 },
    locationType: "ADDRESS",
    locationName: "Plac Defilad 1"
};

const destination = {
    citySymbol: "WARSZAWA",
    coordinate: { y_lat: 52.2299, x_lon: 21.0687 },
    locationType: "STOP_POINT",
    locationName: "Międzynarodowa",
    locationCode: "209802"
};

const timeOptions = {
    dateTime: new Date().toISOString(),
    queryTimeType: "DEPARTURE"
};

client.searchRoute(start, destination, timeOptions)
    .then(routes => console.log(routes));
```

### Using the Query Builder (Recommended)

The `RouteQueryBuilder` provides a fluent interface for constructing queries with advanced options.

```javascript
const { JakdojadeClient, RouteQueryBuilder } = require('jakdojade-api');

const client = new JakdojadeClient();

const query = new RouteQueryBuilder()
    .from(start)
    .to(destination)
    .departingAt(new Date())
    // Options
    .avoidLine(509)
    .avoidLine(159)
    .avoidChanges("AVOID_CHANGES") // DEFAULT, AVOID_CHANGES
    .connectionType("FAST")        // OPTIMAL, FAST, CONVENIENT
    .prohibitVehicle("VEHICLE_TYPE_TRAIN")
    .wheelchairAccessible()
    .build();

const results = await client.search(query);
```

### Builder Methods

- `.from(location)` / `.to(location)`: Set start and end points.
- `.departingAt(date)` / `.arrivingAt(date)`: Set time constraints.
- `.avoidLine(lineNo)`: Avoid a specific line (e.g., `509`).
- `.preferLine(lineNo)`: Prefer a specific line.
- `.avoidVehicle(type)`: Avoid vehicle types (e.g., `VEHICLE_TYPE_BUS`).
- `.prohibitVehicle(type)`: Strictly prohibit vehicle types.
- `.wheelchairAccessible()`: Request accessible vehicles only.
- `.avoidChanges(mode)`: Set change preference (`min`, `none`, etc.).
- `.connectionType(type)`: Set algorithm preference (`fast`, `optimal`, `convenient`).

## HTTP API (server/)

`server/` wraps this client in an HTTP service with two front-ends over the same
Jakdojade data: a compact text protocol for old phones, and full JSON for
anything modern. It is deployed at `http://34.61.173.205:5000`
(see `deploy/README.md`).

Legacy - old devices, tiny payloads, no JSON parsing:

- `GET /v?msg=z+A+do+B` -> `text/plain` UTF-8, up to 8 routes as `R`/`W`/`T` lines
- `GET /v/map?route=0&part=0` -> 240x320 baseline JPEG of that walk leg

Modern:

- `GET /api/routes?msg=z+A+do+B` -> JSON incl. walk geometries as `[lon, lat]`
- `GET /api/locations?q=text` -> location suggestions
- `GET /api/health` -> liveness

Shared query parameters: `city`, `from`, `to`, `at`, `limit`. The default city
is `WARSZAWA`; `LODZ` and `PABIANICE` are also valid, and queries that mention
Lodz/Pabianice are routed there automatically.

```sh
npm run serve          # PORT=5000 node server/index.js
node server/tools/smoke.js "z Placu Defilad do Miedzynarodowej"   # end-to-end check
```

MIDlet builds for the J2ME client are published at `/download/` on the same
service, so a phone can install over the air from
`http://34.61.173.205:5000/download/Ember.jad`.

## Contributors

- **Grok** – a little bit
- **DeepSeek** – main idea and prompter
- **GLM** – coded the J2ME app (if you don't see it i didn't just commit it yet)
- **Me** – copy pasted everything and kept click Accept
- **Gemini 3 Pro** – I don't remember what he did

## Disclaimer

This library is for educational purposes only. It is not affiliated with or endorsed by Jakdojade. Use responsibly.

This was fully vibecoded using Gemini 3 Pro, DeepSeek, Grok, and GLM. Any bugs report will be welcome <3


