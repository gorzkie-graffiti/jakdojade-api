const { JakdojadeClient, RouteQueryBuilder } = require('./src/index');
const fs = require('fs');

async function main() {
    console.log('Initializing Jakdojade Client...');
    const client = new JakdojadeClient();

    // Jutro 18:00
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(18, 0, 0, 0);

    const start = {
        citySymbol: "WARSZAWA",
        coordinate: { y_lat: 52.2319, x_lon: 21.0067 },
        locationType: "ADDRESS",
        locationName: "Plac Defilad 1"
    };

    const destination = {
        citySymbol: "WARSZAWA",
        coordinate: { y_lat: 52.22997, x_lon: 21.068713 },
        locationType: "STOP_POINT",
        locationName: "Międzynarodowa",
        locationCode: "209802"
    };

    console.log('\n--- Wyszukiwanie tras (ulepszony Builder) ---');

    try {
        const query = new RouteQueryBuilder()
            .from(start)
            .to(destination)
            .departingAt(tomorrow)

            // ========== ZMIENIAJ TUTAJ ==========
            .routesCount(8)                    // ile tras zwrócić
            .connectionType("FAST")            // FAST / OPTIMAL / CONVENIENT
            .avoidChanges("AVOID_CHANGES")     // DEFAULT / NO_CHANGES / AVOID_CHANGES
            // .forcedChangeTime(5)            // minuty
            // .wheelchairAccessible()         // tylko dostępne dla wózków
            // .realtimeMode("REALTIME_ENABLED")
            // .routesCorrelation("UPDATE")

            .avoidLine(509)
            .avoidLine(159)
            // .preferLine(520)
            // .prohibitVehicle("VEHICLE_TYPE_TRAIN")
            // .avoidVehicle("VEHICLE_TYPE_TRAM")
            // .avoidLineType("LINE_TYPE_FAST")
            // ===================================

            .build();

        console.log('Wysyłam zapytanie...');
        const result = await client.search(query);

        fs.writeFileSync('route_dump.json', JSON.stringify(result, null, 2));
        console.log(`✅ Znaleziono ${result.routes?.length || 0} tras.`);
        console.log('Szczegóły zapisane do: route_dump.json');
        console.log('Request zapisany do: request.log');

    } catch (e) {
        console.error('❌ Błąd:', e.message);
        if (e.response?.data) console.error(e.response.data);
    }
}

main();
