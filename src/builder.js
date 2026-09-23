class RouteQueryBuilder {
    constructor() {
        this.query = {
            engine: "DEFAULT",                    // DEFAULT
            fetchType: "SYNC",                    // SYNC
            routesCorrelation: "NONE",            // NONE / UPDATE
            userLocation: null,

            searchQuery: {
                realtimeSearchMode: "REALTIME_ENABLED",   // REALTIME_ENABLED / REALTIME_DISABLED
                routesCount: 8,
                userConnectionTypePreference: "OPTIMAL",  // OPTIMAL / FAST / CONVENIENT

                publicTransportOptions: {
                    avoidChanges: "DEFAULT",              // DEFAULT / NO_CHANGES / AVOID_CHANGES
                    forcedChangeTime: null,               // minutes, e.g. 3, 5
                    accessibilityOptions: "NONE",         // NONE / ALL_VEHICLES_WHEELCHAIR_ACCESSIBLE
                    avoidLines: [],
                    preferredLines: [],
                    avoidVehicles: [],
                    prohibitedVehicles: [],
                    avoidLineTypes: [],
                    prohibitedOperators: []
                }
            }
        };
    }

    // === LOKALIZACJE ===
    from(location) {
        this.query.searchQuery.start = location;
        return this;
    }

    to(location) {
        this.query.searchQuery.destination = location;
        return this;
    }

    // === CZAS ===
    departingAt(date) {
        this.query.searchQuery.timeOptions = {
            dateTime: date.toISOString().split('.')[0] + '+02:00',
            queryTimeType: "DEPARTURE"
        };
        return this;
    }

    arrivingAt(date) {
        this.query.searchQuery.timeOptions = {
            dateTime: date.toISOString().split('.')[0] + '+02:00',
            queryTimeType: "ARRIVAL"
        };
        return this;
    }

    // === GŁÓWNE OPCJE ===
    routesCount(count) {
        this.query.searchQuery.routesCount = count;
        return this;
    }

    connectionType(preference = "OPTIMAL") {
        // OPTIMAL / FAST / CONVENIENT
        this.query.searchQuery.userConnectionTypePreference = preference;
        return this;
    }

    routesCorrelation(mode = "NONE") {
        // NONE / UPDATE
        this.query.routesCorrelation = mode;
        return this;
    }

    realtimeMode(mode = "REALTIME_ENABLED") {
        // REALTIME_ENABLED / REALTIME_DISABLED
        this.query.searchQuery.realtimeSearchMode = mode;
        return this;
    }

    // === OPCJE TRANSPORTU ===
    avoidChanges(mode = "DEFAULT") {
        // DEFAULT / NO_CHANGES / AVOID_CHANGES
        this.query.searchQuery.publicTransportOptions.avoidChanges = mode;
        return this;
    }

    forcedChangeTime(minutes) {
        this.query.searchQuery.publicTransportOptions.forcedChangeTime = minutes;
        return this;
    }

    wheelchairAccessible(enabled = true) {
        this.query.searchQuery.publicTransportOptions.accessibilityOptions =
            enabled ? "ALL_VEHICLES_WHEELCHAIR_ACCESSIBLE" : "NONE";
        return this;
    }

    // === LINIE ===
    avoidLine(line) {
        const lines = this.query.searchQuery.publicTransportOptions.avoidLines;
        if (!lines.includes(String(line))) lines.push(String(line));
        return this;
    }

    preferLine(line) {
        const lines = this.query.searchQuery.publicTransportOptions.preferredLines;
        if (!lines.includes(String(line))) lines.push(String(line));
        return this;
    }

    avoidLineType(lineType) {
        const types = this.query.searchQuery.publicTransportOptions.avoidLineTypes;
        if (!types.includes(lineType)) types.push(lineType);
        return this;
    }

    // === POJAZDY ===
    avoidVehicle(vehicleType) {
        const vehicles = this.query.searchQuery.publicTransportOptions.avoidVehicles;
        if (!vehicles.includes(vehicleType)) vehicles.push(vehicleType);
        return this;
    }

    prohibitVehicle(vehicleType) {
        const vehicles = this.query.searchQuery.publicTransportOptions.prohibitedVehicles;
        if (!vehicles.includes(vehicleType)) vehicles.push(vehicleType);
        return this;
    }

    // === OPERATORZY ===
    prohibitOperator(operator) {
        const operators = this.query.searchQuery.publicTransportOptions.prohibitedOperators;
        if (!operators.includes(operator)) operators.push(operator);
        return this;
    }

    build() {
        if (!this.query.searchQuery.start || !this.query.searchQuery.destination) {
            throw new Error("Musisz podać .from() i .to()");
        }

        if (!this.query.searchQuery.timeOptions) {
            this.departingAt(new Date());
        }

        return this.query;
    }
}

module.exports = RouteQueryBuilder;
