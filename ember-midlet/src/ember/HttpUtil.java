package ember;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.Vector;

import javax.microedition.io.Connector;
import javax.microedition.io.HttpConnection;
import javax.microedition.rms.RecordStore;

/**
 * Network access, response parsing and the RMS cache for the Ember MIDlet.
 *
 * Everything in here is plain CLDC 1.1 / MIDP 2.0:
 *   - javax.microedition.io.HttpConnection over plain HTTP (never HTTPS)
 *   - own splitter (String.split() does not exist in CLDC 1.1)
 *   - InputStreamReader("UTF-8") for decoding Polish descriptions
 *   - RecordStore "emberCache" for the last good /v response
 *
 * The backend contract, per line:
 *   R|routeId|line|direction|depTime|arrTime|durationMin
 *   W|partIndex|type|distanceM|description|lon,lat;lon,lat;...
 *   T|line|direction|fromStop|toStop|stopCount
 */
public final class HttpUtil {

    /** Record store holding timestamp + raw response of the last fetch. */
    public static final String CACHE_STORE = "emberCache";

    /** Cached results older than this are ignored on startup (5 minutes). */
    public static final long CACHE_TTL = 5L * 60L * 1000L;

    /** Hard network deadline; enforced by a watchdog thread (see get()). */
    public static final int TIMEOUT_MS = 15000;

    /** Everything is read in chunks of this size when getLength() is unknown. */
    private static final int CHUNK = 512;

    /** Map canvas bounds, used when scaling W shapes to local coordinates. */
    public static final int MAP_W = 240;
    public static final int MAP_H = 320;

    private static final char[] HEX = "0123456789ABCDEF".toCharArray();

    private HttpUtil() {
        // static only
    }

    // ------------------------------------------------------------------
    // HTTP
    // ------------------------------------------------------------------

    /**
     * GETs a URL and returns the whole body as bytes.
     *
     * MIDP 2.0's HttpConnection has no setTimeout(), so a watchdog thread is
     * started that closes the connection when the deadline expires; the read
     * then fails with an IOException that is reported as a timeout.
     */
    public static byte[] get(String url, int timeoutMs) throws IOException {
        Watchdog watchdog = new Watchdog(timeoutMs);
        new Thread(watchdog).start();

        HttpConnection conn = null;
        try {
            // Connector.READ, timeouts=false: we manage the deadline ourselves.
            conn = (HttpConnection) Connector.open(url, Connector.READ, true);
            watchdog.attach(conn);

            conn.setRequestMethod(HttpConnection.GET);
            conn.setRequestProperty("User-Agent", "EmberMIDP/1.0");
            conn.setRequestProperty("Connection", "close");

            int code = conn.getResponseCode();
            if (code != HttpConnection.HTTP_OK) {
                throw new IOException("HTTP " + code + " " + safeMessage(conn));
            }
            byte[] body = readBody(conn);
            if (body.length == 0) {
                throw new IOException("Puste ciało odpowiedzi");
            }
            return body;
        } catch (IOException e) {
            if (watchdog.timedOut()) {
                throw new IOException("Timeout " + (timeoutMs / 1000) + "s");
            }
            throw e;
        } finally {
            watchdog.cancel();
            if (conn != null) {
                try {
                    conn.close();
                } catch (IOException ignore) {
                    // nothing useful to do while tearing down
                }
            }
        }
    }

    private static String safeMessage(HttpConnection conn) {
        try {
            String m = conn.getResponseMessage();
            return m == null ? "" : m;
        } catch (IOException e) {
            return "";
        }
    }

    /**
     * Reads the full body: getLength() when the server told us the size,
     * otherwise 512-byte chunks into a ByteArrayOutputStream.
     */
    private static byte[] readBody(HttpConnection conn) throws IOException {
        int declared = (int) conn.getLength();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        InputStream in = conn.openInputStream();
        try {
            if (declared > 0) {
                byte[] head = new byte[declared];
                int got = 0;
                while (got < declared) {
                    int r = in.read(head, got, declared - got);
                    if (r < 0) {
                        break;
                    }
                    got += r;
                }
                out.write(head, 0, got);
            }
            byte[] chunk = new byte[CHUNK];
            int r = in.read(chunk);
            while (r > 0) {
                out.write(chunk, 0, r);
                r = in.read(chunk);
            }
        } finally {
            try {
                in.close();
            } catch (IOException ignore) {
                // ignore
            }
        }
        return out.toByteArray();
    }

    /** Waits for the fetch to finish or closes the connection on timeout. */
    private static final class Watchdog implements Runnable {
        private final int timeoutMs;
        private HttpConnection conn;
        private boolean done;
        private boolean expired;

        Watchdog(int timeoutMs) {
            this.timeoutMs = timeoutMs;
        }

        synchronized void attach(HttpConnection c) {
            conn = c;
        }

        synchronized boolean timedOut() {
            return expired;
        }

        synchronized void cancel() {
            done = true;
            notifyAll();
        }

        public void run() {
            synchronized (this) {
                long deadline = System.currentTimeMillis() + timeoutMs;
                while (!done) {
                    long wait = deadline - System.currentTimeMillis();
                    if (wait <= 0) {
                        break;
                    }
                    try {
                        wait(wait);
                    } catch (InterruptedException ignore) {
                        // re-check the deadline
                    }
                }
                if (done) {
                    return;
                }
                expired = true;
                if (conn != null) {
                    try {
                        conn.close();
                    } catch (IOException ignore) {
                        // the fetch thread will see the IOException
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Text helpers (UTF-8, URL encoding, own splitter)
    // ------------------------------------------------------------------

    /** Decodes a byte range as UTF-8 using the mandated CLDC reader. */
    public static String utf8(byte[] data, int offset, int length) throws IOException {
        InputStreamReader reader =
                new InputStreamReader(new ByteArrayInputStream(data, offset, length), "UTF-8");
        StringBuffer sb = new StringBuffer(length > 0 ? length : 32);
        char[] buf = new char[CHUNK];
        int n = reader.read(buf);
        while (n > 0) {
            sb.append(buf, 0, n);
            n = reader.read(buf);
        }
        reader.close();
        return sb.toString();
    }

    public static String utf8(byte[] data) throws IOException {
        return utf8(data, 0, data.length);
    }

    /** Percent-encodes a query value; Polish characters become UTF-8 escapes. */
    public static String urlEncode(String s) {
        if (s == null) {
            return "";
        }
        try {
            byte[] bytes = s.getBytes("UTF-8");
            StringBuffer sb = new StringBuffer(bytes.length * 3);
            for (int i = 0; i < bytes.length; i++) {
                int c = bytes[i] & 0xFF;
                if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
                        || (c >= '0' && c <= '9')
                        || c == '-' || c == '_' || c == '.' || c == '~') {
                    sb.append((char) c);
                } else {
                    sb.append('%').append(HEX[c >> 4]).append(HEX[c & 0x0F]);
                }
            }
            return sb.toString();
        } catch (Exception e) {
            return s; // cannot happen for UTF-8, but never break the URL
        }
    }

    /** Splits on a single character, keeping empty fields (CLDC has no split()). */
    public static String[] split(String s, char separator) {
        Vector parts = new Vector();
        int start = 0;
        while (true) {
            int idx = s.indexOf(separator, start);
            if (idx < 0) {
                parts.addElement(s.substring(start));
                break;
            }
            parts.addElement(s.substring(start, idx));
            start = idx + 1;
        }
        String[] out = new String[parts.size()];
        parts.copyInto(out);
        return out;
    }

    private static String field(String[] fields, int index) {
        if (index < 0 || index >= fields.length || fields[index] == null) {
            return "";
        }
        return fields[index];
    }

    private static int intOf(String s, int fallback) {
        try {
            return Integer.parseInt(s.trim(), 10);
        } catch (Exception e) {
            return fallback;
        }
    }

    private static boolean isDigit(char c) {
        return c >= '0' && c <= '9';
    }

    /** "21.068713" -> microdegrees 21068713 (no floating point on CLDC). */
    private static int microdegrees(String s) {
        s = s.trim();
        int i = 0;
        boolean negative = false;
        if (i < s.length() && (s.charAt(i) == '-' || s.charAt(i) == '+')) {
            negative = s.charAt(i) == '-';
            i++;
        }
        long whole = 0;
        while (i < s.length() && isDigit(s.charAt(i))) {
            whole = whole * 10 + (s.charAt(i) - '0');
            i++;
        }
        long frac = 0;
        int digits = 0;
        if (i < s.length() && s.charAt(i) == '.') {
            i++;
            while (digits < 6 && i < s.length() && isDigit(s.charAt(i))) {
                frac = frac * 10 + (s.charAt(i) - '0');
                digits++;
                i++;
            }
        }
        while (digits < 6) {
            frac *= 10;
            digits++;
        }
        long value = whole * 1000000L + frac;
        return (int) (negative ? -value : value);
    }

    /**
     * Unpacks "lon,lat;lon,lat;..." and scales it onto the 240x320 map canvas.
     * The server sends the rendered JPEG, so these are only kept for local use.
     */
    private static void parseShape(String shape, WalkPart part) {
        if (shape == null || shape.length() == 0) {
            return;
        }
        String[] points = split(shape, ';');
        int[] lons = new int[points.length];
        int[] lats = new int[points.length];
        int count = 0;
        for (int i = 0; i < points.length; i++) {
            if (points[i].length() == 0) {
                continue;
            }
            String[] pair = split(points[i], ',');
            if (pair.length < 2 || pair[0].length() == 0 || pair[1].length() == 0) {
                continue;
            }
            lons[count] = microdegrees(pair[0]);
            lats[count] = microdegrees(pair[1]);
            count++;
        }
        if (count == 0) {
            return;
        }

        int minLon = lons[0];
        int maxLon = lons[0];
        int minLat = lats[0];
        int maxLat = lats[0];
        for (int i = 1; i < count; i++) {
            if (lons[i] < minLon) {
                minLon = lons[i];
            }
            if (lons[i] > maxLon) {
                maxLon = lons[i];
            }
            if (lats[i] < minLat) {
                minLat = lats[i];
            }
            if (lats[i] > maxLat) {
                maxLat = lats[i];
            }
        }

        int spanX = maxLon - minLon;
        int spanY = maxLat - minLat;
        part.shapeX = new int[count];
        part.shapeY = new int[count];
        for (int i = 0; i < count; i++) {
            part.shapeX[i] = spanX > 0
                    ? (int) (((long) (lons[i] - minLon) * (MAP_W - 1)) / spanX) : 0;
            part.shapeY[i] = spanY > 0
                    ? (int) (((long) (maxLat - lats[i]) * (MAP_H - 1)) / spanY) : 0;
        }
    }

    // ------------------------------------------------------------------
    // Parser
    // ------------------------------------------------------------------

    /** Parses a full /v response into routes (R lines plus their W/T parts). */
    public static Route[] parseRoutes(String text) {
        Vector routes = new Vector();
        if (text == null) {
            return toRoutes(routes);
        }

        Route current = null;
        Vector walks = null;
        Vector transits = null;
        Vector order = null;

        int i = 0;
        int length = text.length();
        while (i <= length) {
            int newline = text.indexOf('\n', i);
            String line;
            if (newline < 0) {
                line = text.substring(i);
                i = length + 1;
            } else {
                line = text.substring(i, newline);
                i = newline + 1;
            }
            if (line.length() > 0 && line.charAt(line.length() - 1) == '\r') {
                line = line.substring(0, line.length() - 1);
            }
            if (line.length() == 0) {
                continue; // blank line = end of a route
            }

            String[] f = split(line, '|');
            char kind = line.charAt(0);

            if (kind == 'R') {
                if (current != null) {
                    attachParts(current, walks, transits, order);
                    routes.addElement(current);
                }
                current = new Route();
                walks = new Vector();
                transits = new Vector();
                order = new Vector();
                current.id = field(f, 1);
                current.line = field(f, 2);
                current.dir = field(f, 3);
                current.dep = field(f, 4);
                current.arr = field(f, 5);
                current.duration = intOf(field(f, 6), 0);
            } else if (kind == 'W' && current != null) {
                WalkPart w = new WalkPart();
                w.index = intOf(field(f, 1), walks.size());
                w.type = field(f, 2);
                w.distance = intOf(field(f, 3), 0);
                w.desc = field(f, 4);
                parseShape(field(f, 5), w);
                order.addElement(new Integer(walks.size()));
                walks.addElement(w);
            } else if (kind == 'T' && current != null) {
                TransitPart t = new TransitPart();
                t.line = field(f, 1);
                t.dir = field(f, 2);
                t.from = field(f, 3);
                t.to = field(f, 4);
                t.stops = intOf(field(f, 5), 0);
                // Route.order encodes walks as >= 0 and transits as -index-1
                order.addElement(new Integer(-(transits.size()) - 1));
                transits.addElement(t);
            }
        }

        if (current != null) {
            attachParts(current, walks, transits, order);
            routes.addElement(current);
        }
        return toRoutes(routes);
    }

    private static void attachParts(Route route, Vector walks, Vector transits, Vector order) {
        route.walks = new WalkPart[walks.size()];
        walks.copyInto(route.walks);
        route.transits = new TransitPart[transits.size()];
        transits.copyInto(route.transits);
        route.order = new int[order.size()];
        for (int i = 0; i < route.order.length; i++) {
            route.order[i] = ((Integer) order.elementAt(i)).intValue();
        }
    }

    private static Route[] toRoutes(Vector v) {
        Route[] out = new Route[v.size()];
        v.copyInto(out);
        return out;
    }

    // ------------------------------------------------------------------
    // RMS cache (raw response + timestamp, one record)
    // ------------------------------------------------------------------

    /** Stores the raw response (prefixed with the timestamp) in RMS. */
    public static void cacheSave(String text) {
        RecordStore rs = null;
        try {
            // One small record only: recreating keeps the id stable and simple.
            try {
                RecordStore.deleteRecordStore(CACHE_STORE);
            } catch (Exception ignore) {
                // not present yet
            }
            rs = RecordStore.openRecordStore(CACHE_STORE, true);
            byte[] head = (String.valueOf(System.currentTimeMillis()) + "\n").getBytes("UTF-8");
            byte[] body = text.getBytes("UTF-8");
            byte[] record = new byte[head.length + body.length];
            System.arraycopy(head, 0, record, 0, head.length);
            System.arraycopy(body, 0, record, head.length, body.length);
            rs.addRecord(record, 0, record.length);
        } catch (Exception ignore) {
            // The cache is a nicety: never let it break a search.
        } finally {
            if (rs != null) {
                try {
                    rs.closeRecordStore();
                } catch (Exception ignore) {
                    // ignore
                }
            }
        }
    }

    /**
     * Returns the cached response body when it is younger than CACHE_TTL,
     * otherwise null so the caller re-fetches.
     */
    public static String cacheLoad() {
        byte[] record = null;
        RecordStore rs = null;
        try {
            rs = RecordStore.openRecordStore(CACHE_STORE, false);
            if (rs.getNumRecords() == 0) {
                return null;
            }
            record = rs.getRecord(1);
        } catch (Exception e) {
            return null;
        } finally {
            if (rs != null) {
                try {
                    rs.closeRecordStore();
                } catch (Exception ignore) {
                    // ignore
                }
            }
        }
        if (record == null) {
            return null;
        }

        int newline = -1;
        for (int i = 0; i < record.length; i++) {
            if (record[i] == '\n') {
                newline = i;
                break;
            }
        }
        if (newline <= 0) {
            return null;
        }

        long stamp;
        String body;
        try {
            stamp = Long.parseLong(utf8(record, 0, newline));
            body = utf8(record, newline + 1, record.length - newline - 1);
        } catch (Exception e) {
            return null;
        }
        if (System.currentTimeMillis() - stamp > CACHE_TTL) {
            return null;
        }
        return body;
    }

    /** Removes the cache (used by the "Odśwież" action paths). */
    public static void cacheClear() {
        try {
            RecordStore.deleteRecordStore(CACHE_STORE);
        } catch (Exception ignore) {
            // nothing cached
        }
    }
}
