package ember;

import javax.microedition.lcdui.Alert;
import javax.microedition.lcdui.AlertType;
import javax.microedition.lcdui.Canvas;
import javax.microedition.lcdui.Command;
import javax.microedition.lcdui.CommandListener;
import javax.microedition.lcdui.Display;
import javax.microedition.lcdui.Displayable;
import javax.microedition.lcdui.Font;
import javax.microedition.lcdui.Form;
import javax.microedition.lcdui.Gauge;
import javax.microedition.lcdui.Graphics;
import javax.microedition.lcdui.Image;
import javax.microedition.lcdui.List;
import javax.microedition.lcdui.StringItem;
import javax.microedition.lcdui.TextBox;
import javax.microedition.lcdui.TextField;
import javax.microedition.midlet.MIDlet;
import javax.microedition.midlet.MIDletStateChangeException;

import java.util.Vector;

/**
 * Ember - a MIDP 2.0 / CLDC 1.1 client for the Lodz / Pabianice transit backend.
 *
 * Target device: Sony Ericsson J20i (240x320, T9 keypad, D-pad, Polish locale).
 *
 * Screens:
 *   1. QueryScreen      - enter a destination, GET /v?msg=...
 *   2. RouteListScreen  - one row per route
 *   3. DetailScreen     - R header + W/T parts, with the "Menu" soft key
 *   4. WalkViewerScreen - walking parts only, D-pad navigation
 *   5. MapViewerScreen  - server rendered 240x320 JPEG
 *
 * All network work happens on a dedicated Thread and results are handed back
 * to the event thread with Display.callSerially(); the AMS thread is never
 * blocked. No timers and no animation are used anywhere.
 */
public class Ember extends MIDlet {

    /**
     * Plain HTTP: the backend has no TLS endpoint and MIDP would need HTTPS.
     * Port 5000 hosts the transit API (legacy /v text + /v/map JPEG); port 3000
     * is the separate Next.js Ember app.
     */
    static final String BASE_URL = "http://34.61.173.205:5000";

    static final String DEFAULT_QUERY = "Międzynarodowa";

    /** Black text on white, orange title bars. */
    static final int ORANGE = 0xFF8C00;
    static final int BLACK = 0x000000;
    static final int WHITE = 0xFFFFFF;
    static final int GREY = 0x666666;

    /** Where the map screen was opened from, so "Wstecz" goes back correctly. */
    private static final int ORIGIN_DETAIL = 0;
    private static final int ORIGIN_WALK = 1;

    /*
     * MIDP 2.0's Canvas has no KEY_UP/KEY_DOWN/KEY_LEFT/KEY_RIGHT constants -
     * only the game actions UP/DOWN/LEFT/RIGHT and KEY_NUM0..KEY_NUM9. The
     * key codes below are the ones the MIDP spec recommends implementations to
     * report for the D-pad, and are used only as a fallback when
     * Canvas.getGameAction() returns 0.
     */
    private static final int RAW_UP = -1;
    private static final int RAW_DOWN = -2;
    private static final int RAW_LEFT = -3;
    private static final int RAW_RIGHT = -4;

    private Display display;
    private Route[] routes;
    private String lastQuery = DEFAULT_QUERY;

    /** Bumped per search so stale worker results are dropped. */
    private int jobSeq;

    // ------------------------------------------------------------------
    // MIDlet lifecycle
    // ------------------------------------------------------------------

    public void startApp() {
        display = Display.getDisplay(this);

        // Less than 5 minutes old? Show the cached result instead of re-fetching.
        String cached = HttpUtil.cacheLoad();
        if (cached != null) {
            Route[] parsed = HttpUtil.parseRoutes(cached);
            if (parsed.length > 0) {
                routes = parsed;
                display.setCurrent(new RouteListScreen());
                return;
            }
        }
        display.setCurrent(new QueryScreen());
    }

    public void pauseApp() {
        // No background work to suspend.
    }

    public void destroyApp(boolean unconditional) throws MIDletStateChangeException {
        // Nothing to release: the record store is closed after every use.
    }

    void exit() {
        try {
            destroyApp(true);
        } catch (Exception ignore) {
            // destroyApp never fails here
        }
        notifyDestroyed();
    }

    // ------------------------------------------------------------------
    // Navigation
    // ------------------------------------------------------------------

    private void openDetail(int routeIndex) {
        if (routes == null || routeIndex < 0 || routeIndex >= routes.length) {
            return;
        }
        display.setCurrent(new DetailScreen(routeIndex));
    }

    private void openMap(int routeIndex, int walkPosition, int origin) {
        if (routes == null || routeIndex < 0 || routeIndex >= routes.length) {
            return;
        }
        WalkPart[] walks = routes[routeIndex].walks;
        if (walks == null || walkPosition < 0 || walkPosition >= walks.length) {
            return;
        }
        display.setCurrent(new MapViewerScreen(routeIndex, walkPosition, origin));
    }

    private Displayable previousScreen() {
        if (routes != null && routes.length > 0) {
            return new RouteListScreen();
        }
        return new QueryScreen();
    }

    // ------------------------------------------------------------------
    // Networking (thread per fetch, results applied via callSerially)
    // ------------------------------------------------------------------

    void search(String query) {
        String trimmed = query == null ? "" : query.trim();
        lastQuery = trimmed.length() == 0 ? DEFAULT_QUERY : trimmed;

        final String requested = lastQuery;
        final int job = ++jobSeq;

        display.setCurrent(new LoadingScreen());

        new Thread(new Runnable() {
            public void run() {
                try {
                    String url = BASE_URL + "/v?msg=" + HttpUtil.urlEncode(requested);
                    byte[] body = HttpUtil.get(url, HttpUtil.TIMEOUT_MS);
                    final String text = HttpUtil.utf8(body);
                    HttpUtil.cacheSave(text);
                    final Route[] parsed = HttpUtil.parseRoutes(text);
                    display.callSerially(new Runnable() {
                        public void run() {
                            if (job == jobSeq) {
                                onRoutes(text, parsed);
                            }
                        }
                    });
                } catch (Exception ex) {
                    final String message = describe(ex);
                    display.callSerially(new Runnable() {
                        public void run() {
                            if (job == jobSeq) {
                                onFailure(message);
                            }
                        }
                    });
                }
            }
        }).start();
    }

    private void onRoutes(String raw, Route[] parsed) {
        if (parsed != null && parsed.length > 0) {
            routes = parsed;
            display.setCurrent(new RouteListScreen());
            return;
        }

        // HTTP 200 but nothing that looks like R/W/T lines: the backend answered
        // 200 with prose. Show it verbatim instead of pretending the search
        // failed, so the app is still useful while the contract is unavailable.
        if (raw != null && raw.trim().length() > 0) {
            TextBox box = new TextBox("Odpowiedź serwera", raw.trim(), 4096, TextField.ANY);
            box.addCommand(new Command("Wstecz", Command.BACK, 1));
            box.setCommandListener(new CommandListener() {
                public void commandAction(Command c, Displayable d) {
                    display.setCurrent(new QueryScreen());
                }
            });
            display.setCurrent(box);
            return;
        }

        Alert alert = new Alert("Brak wyników",
                "Nie znaleziono tras dla: " + lastQuery, null, AlertType.INFO);
        display.setCurrent(alert, new QueryScreen());
    }

    private void onFailure(String message) {
        Alert alert = new Alert("Błąd", message, null, AlertType.ERROR);
        display.setCurrent(alert, previousScreen());
    }

    // ------------------------------------------------------------------
    // Screen 1 - query
    // ------------------------------------------------------------------

    private class QueryScreen extends Form implements CommandListener {
        private final TextField queryField;
        private final Command searchCmd = new Command("Szukaj", Command.OK, 1);
        private final Command exitCmd = new Command("Wyjście", Command.EXIT, 2);

        QueryScreen() {
            super("Ember");
            queryField = new TextField("Cel / przystanek:", DEFAULT_QUERY, 64, TextField.ANY);
            append(queryField);
            append(new StringItem(null, "Łódź / Pabianice - trasy na żywo"));
            addCommand(searchCmd);
            addCommand(exitCmd);
            setCommandListener(this);
        }

        public void commandAction(Command c, Displayable d) {
            if (c == exitCmd) {
                exit();
            } else {
                search(queryField.getString());
            }
        }
    }

    /** Static "Łączenie..." placeholder shown while a fetch is in flight. */
    private class LoadingScreen extends Form {
        LoadingScreen() {
            super("Łączenie...");
            append(new StringItem(null, "Łączenie..."));
            append(new Gauge(null, false, Gauge.INDEFINITE, Gauge.CONTINUOUS_RUNNING));
        }
    }

    // ------------------------------------------------------------------
    // Screen 2 - route list
    // ------------------------------------------------------------------

    private class RouteListScreen extends List implements CommandListener {
        private final Command selectCmd = new Command("Wybierz", Command.OK, 1);
        private final Command exitCmd = new Command("Wyjście", Command.EXIT, 2);

        RouteListScreen() {
            super("Trasy (" + routes.length + ")", List.IMPLICIT);
            for (int i = 0; i < routes.length; i++) {
                append(routes[i].label(), null);
            }
            setSelectCommand(selectCmd);   // right soft key
            addCommand(exitCmd);           // left soft key
            setCommandListener(this);
        }

        public void commandAction(Command c, Displayable d) {
            if (c == exitCmd) {
                exit();
            } else {
                openDetail(getSelectedIndex());
            }
        }
    }

    // ------------------------------------------------------------------
    // Screen 3 - route detail
    // ------------------------------------------------------------------

    private class DetailScreen extends List implements CommandListener {
        private final int routeIndex;
        /** Per row: index into route.walks, or -1 for the header and bus rows. */
        private final int[] walkOf;
        private final Command menuCmd = new Command("Menu", Command.SCREEN, 1);

        DetailScreen(int index) {
            super(routes[index].title(), List.IMPLICIT);
            this.routeIndex = index;
            Route route = routes[index];

            String[] walkText = new String[route.walks == null ? 0 : route.walks.length];
            for (int i = 0; i < walkText.length; i++) {
                WalkPart w = route.walks[i];
                walkText[i] = "Idź " + w.distance + "m " + w.desc;
            }

            String[] rideText = new String[route.transits == null ? 0 : route.transits.length];
            for (int i = 0; i < rideText.length; i++) {
                TransitPart t = route.transits[i];
                rideText[i] = "Bus " + t.line + " do " + t.to + " (" + t.stops + " przyst.)";
            }

            // Follow the server part order when we have it, walk-then-ride otherwise.
            Vector rows = new Vector();
            Vector rowWalk = new Vector();
            if (route.order != null && route.order.length > 0) {
                for (int i = 0; i < route.order.length; i++) {
                    int o = route.order[i];
                    if (o >= 0) {
                        if (o < walkText.length) {
                            rows.addElement(walkText[o]);
                            rowWalk.addElement(new Integer(o));
                        }
                    } else {
                        int t = -o - 1;
                        if (t < rideText.length) {
                            rows.addElement(rideText[t]);
                            rowWalk.addElement(new Integer(-1));
                        }
                    }
                }
            } else {
                for (int i = 0; i < walkText.length; i++) {
                    rows.addElement(walkText[i]);
                    rowWalk.addElement(new Integer(i));
                }
                for (int i = 0; i < rideText.length; i++) {
                    rows.addElement(rideText[i]);
                    rowWalk.addElement(new Integer(-1));
                }
            }

            append(route.timing(), null);   // row 0: departure -> arrival
            for (int i = 0; i < rows.size(); i++) {
                append((String) rows.elementAt(i), null);
            }

            walkOf = new int[rowWalk.size() + 1];
            walkOf[0] = -1;
            for (int i = 0; i < rowWalk.size(); i++) {
                walkOf[i + 1] = ((Integer) rowWalk.elementAt(i)).intValue();
            }

            addCommand(menuCmd);   // left soft key
            setCommandListener(this);
        }

        private int selectedWalk() {
            int selected = getSelectedIndex();
            if (selected < 0 || selected >= walkOf.length) {
                return -1;
            }
            return walkOf[selected];
        }

        public void commandAction(Command c, Displayable d) {
            int walk = selectedWalk();
            if (c == List.SELECT_COMMAND && walk >= 0) {
                openMap(routeIndex, walk, ORIGIN_DETAIL);
            } else {
                display.setCurrent(new ActionMenuScreen(routeIndex, walk));
            }
        }
    }

    /** Screen 3's "Menu" soft key contents. */
    private class ActionMenuScreen extends List implements CommandListener {
        private final int routeIndex;
        private final int walkPosition;
        private final Vector actions = new Vector();

        ActionMenuScreen(int index, int walk) {
            super("Menu", List.IMPLICIT);
            this.routeIndex = index;
            this.walkPosition = walk;

            if (routes[index].hasWalks()) {
                append("Pokaż części piesze", null);
                actions.addElement("walks");
            }
            if (walk >= 0) {
                append("Mapa", null);
                actions.addElement("map");
            }
            append("Odśwież", null);
            actions.addElement("refresh");
            append("Powrót", null);
            actions.addElement("back");

            setCommandListener(this);
        }

        public void commandAction(Command c, Displayable d) {
            int index = getSelectedIndex();
            if (index < 0 || index >= actions.size()) {
                return;
            }
            String action = (String) actions.elementAt(index);
            if ("walks".equals(action)) {
                display.setCurrent(new WalkViewerScreen(routeIndex, 0));
            } else if ("map".equals(action)) {
                openMap(routeIndex, walkPosition, ORIGIN_DETAIL);
            } else if ("refresh".equals(action)) {
                search(lastQuery);
            } else {
                display.setCurrent(new RouteListScreen());
            }
        }
    }

    // ------------------------------------------------------------------
    // Screen 4 - walking parts viewer
    // ------------------------------------------------------------------

    private class WalkViewerScreen extends Canvas implements CommandListener {
        private final int routeIndex;
        private int position;
        private String[] lines = new String[0];
        private int scroll;

        private final Command mapCmd = new Command("Mapa", Command.SCREEN, 1);
        private final Command backCmd = new Command("Wstecz", Command.BACK, 2);

        WalkViewerScreen(int index, int walk) {
            this.routeIndex = index;
            addCommand(mapCmd);   // left soft key
            addCommand(backCmd);  // right soft key
            setCommandListener(this);
            select(walk);
        }

        private void select(int pos) {
            WalkPart[] walks = routes[routeIndex].walks;
            if (walks == null || walks.length == 0) {
                return;
            }
            if (pos < 0) {
                pos = 0;
            }
            if (pos >= walks.length) {
                pos = walks.length - 1;
            }
            position = pos;
            scroll = 0;
            lines = wrap(walks[pos].desc, 26);
            repaint();
        }

        public void commandAction(Command c, Displayable d) {
            if (c == mapCmd) {
                openMap(routeIndex, position, ORIGIN_WALK);
            } else {
                display.setCurrent(new DetailScreen(routeIndex));
            }
        }

        protected void paint(Graphics g) {
            int w = getWidth();
            int h = getHeight();
            Font font = Font.getDefaultFont();
            g.setFont(font);

            g.setColor(WHITE);
            g.fillRect(0, 0, w, h);

            int titleH = font.getHeight() + 4;
            g.setColor(ORANGE);
            g.fillRect(0, 0, w, titleH);

            WalkPart[] walks = routes[routeIndex].walks;
            int total = walks == null ? 0 : walks.length;
            g.setColor(BLACK);
            g.drawString("Pieszo " + (position + 1) + "/" + total, w / 2, 2,
                    Graphics.TOP | Graphics.HCENTER);

            int lineH = font.getHeight();
            int footerH = lineH + 4;
            int visible = (h - titleH - footerH) / lineH;
            if (visible < 1) {
                visible = 1;
            }

            int y = titleH + 3;
            for (int i = 0; i < visible && (scroll + i) < lines.length; i++) {
                g.drawString(lines[scroll + i], 3, y + i * lineH, Graphics.TOP | Graphics.LEFT);
            }

            g.setColor(GREY);
            g.drawString("1-9 skok", 2, h - lineH - 2, Graphics.TOP | Graphics.LEFT);
            if (lines.length > visible) {
                g.drawString((scroll + 1) + "/" + lines.length, w - 2, h - lineH - 2,
                        Graphics.TOP | Graphics.RIGHT);
            }
        }

        protected void keyPressed(int keyCode) {
            // Digits first: '1'..'9' jumps to part N-1, exactly as specified.
            if (keyCode >= KEY_NUM1 && keyCode <= KEY_NUM9) {
                WalkPart[] walks = routes[routeIndex].walks;
                int target = keyCode - KEY_NUM1;
                if (walks != null && target < walks.length) {
                    select(target);
                }
                return;
            }

            int action = getGameAction(keyCode);
            if (action == 0) {
                // Some firmwares deliver raw D-pad codes rather than game actions.
                if (keyCode == RAW_LEFT) {
                    action = LEFT;
                } else if (keyCode == RAW_RIGHT) {
                    action = RIGHT;
                } else if (keyCode == RAW_UP) {
                    action = UP;
                } else if (keyCode == RAW_DOWN) {
                    action = DOWN;
                }
            }

            if (action == LEFT) {
                select(position - 1);
            } else if (action == RIGHT) {
                select(position + 1);
            } else if (action == UP) {
                if (scroll > 0) {
                    scroll--;
                    repaint();
                }
            } else if (action == DOWN) {
                if (scroll < lines.length - 1) {
                    scroll++;
                    repaint();
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Screen 5 - server rendered map
    // ------------------------------------------------------------------

    private class MapViewerScreen extends Canvas implements CommandListener {
        private final int routeIndex;
        private final int walkPosition;
        private final int origin;

        private Image image;
        private String error;
        private boolean loading;
        private int fetchSeq;

        private final Command refreshCmd = new Command("Odśwież", Command.SCREEN, 1);
        private final Command backCmd = new Command("Wstecz", Command.BACK, 2);

        MapViewerScreen(int index, int walk, int openedFrom) {
            this.routeIndex = index;
            this.walkPosition = walk;
            this.origin = openedFrom;
            addCommand(refreshCmd);   // left soft key
            addCommand(backCmd);      // right soft key
            setCommandListener(this);
            load();
        }

        private void load() {
            loading = true;
            error = null;
            image = null;
            repaint();

            final int seq = ++fetchSeq;
            final int part = routes[routeIndex].walks[walkPosition].index;
            final String url = BASE_URL + "/v/map?route=" + routeIndex + "&part=" + part;

            new Thread(new Runnable() {
                public void run() {
                    try {
                        byte[] body = HttpUtil.get(url, HttpUtil.TIMEOUT_MS);
                        final Image decoded = Image.createImage(body, 0, body.length);
                        display.callSerially(new Runnable() {
                            public void run() {
                                if (seq == fetchSeq) {
                                    image = decoded;
                                    error = null;
                                    loading = false;
                                    repaint();
                                }
                            }
                        });
                    } catch (Exception ex) {
                        final String message = describe(ex);
                        display.callSerially(new Runnable() {
                            public void run() {
                                if (seq == fetchSeq) {
                                    image = null;
                                    error = message;
                                    loading = false;
                                    repaint();
                                }
                            }
                        });
                    }
                }
            }).start();
        }

        private String description() {
            WalkPart[] walks = routes[routeIndex].walks;
            if (walks == null || walkPosition >= walks.length) {
                return "";
            }
            String desc = walks[walkPosition].desc;
            return desc == null ? "" : desc;
        }

        public void commandAction(Command c, Displayable d) {
            if (c == refreshCmd) {
                load();
            } else if (origin == ORIGIN_WALK) {
                display.setCurrent(new WalkViewerScreen(routeIndex, walkPosition));
            } else {
                display.setCurrent(new DetailScreen(routeIndex));
            }
        }

        protected void paint(Graphics g) {
            int w = getWidth();
            int h = getHeight();
            Font font = Font.getDefaultFont();
            g.setFont(font);

            g.setColor(WHITE);
            g.fillRect(0, 0, w, h);

            if (image != null) {
                g.drawImage(image, 0, 0, Graphics.TOP | Graphics.LEFT);
            } else {
                g.setColor(BLACK);
                String text = loading
                        ? "Ładowanie mapy..."
                        : "Błąd mapy: " + (error == null ? "?" : error);
                g.drawString(text, w / 2, h / 2, Graphics.TOP | Graphics.HCENTER);
            }

            int barH = font.getHeight() + 3;
            g.setColor(ORANGE);
            g.fillRect(0, h - barH, w, barH);
            g.setColor(BLACK);
            g.drawString(clip(font, description(), w - 4), 2, h - barH + 1,
                    Graphics.TOP | Graphics.LEFT);
        }
    }

    // ------------------------------------------------------------------
    // Small shared helpers
    // ------------------------------------------------------------------

    /** "java.io.IOException: HTTP 500" -> "IOException: HTTP 500". */
    static String describe(Throwable t) {
        String name = t.getClass().getName();
        int dot = name.lastIndexOf('.');
        if (dot >= 0) {
            name = name.substring(dot + 1);
        }
        String message = t.getMessage();
        if (message == null || message.length() == 0) {
            return name;
        }
        return name + ": " + message;
    }

    /** Word wraps at `width` characters, hard-breaking words that are longer. */
    static String[] wrap(String text, int width) {
        Vector out = new Vector();
        if (text == null) {
            text = "";
        }
        StringBuffer current = new StringBuffer(width + 8);
        int i = 0;
        int length = text.length();

        while (i < length) {
            while (i < length && text.charAt(i) == ' ') {
                i++;
            }
            int start = i;
            while (i < length && text.charAt(i) != ' ') {
                i++;
            }
            if (start == i) {
                continue;
            }
            String word = text.substring(start, i);

            if (current.length() > 0 && current.length() + 1 + word.length() > width) {
                out.addElement(current.toString());
                current = new StringBuffer(width + 8);
            }
            if (word.length() > width) {
                if (current.length() > 0) {
                    out.addElement(current.toString());
                    current = new StringBuffer(width + 8);
                }
                int p = 0;
                while (p + width < word.length()) {
                    out.addElement(word.substring(p, p + width));
                    p += width;
                }
                current.append(word.substring(p));
            } else {
                if (current.length() > 0) {
                    current.append(' ');
                }
                current.append(word);
            }
        }
        if (current.length() > 0) {
            out.addElement(current.toString());
        }
        if (out.size() == 0) {
            out.addElement("");
        }

        String[] result = new String[out.size()];
        out.copyInto(result);
        return result;
    }

    /** Truncates a string so it fits `maxWidth` pixels. */
    static String clip(Font font, String text, int maxWidth) {
        if (text == null) {
            return "";
        }
        if (font.stringWidth(text) <= maxWidth) {
            return text;
        }
        int end = text.length();
        while (end > 0 && font.stringWidth(text.substring(0, end)) + font.stringWidth("...") > maxWidth) {
            end--;
        }
        return text.substring(0, end) + "...";
    }
}
