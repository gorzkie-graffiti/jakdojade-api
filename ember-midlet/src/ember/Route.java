package ember;

/** One complete route: header line R plus its W (walk) and T (transit) parts. */
public class Route {

    /**
     * Separators used when building labels. Escaped so the source file stays
     * pure ASCII: U+2192 arrow and U+2013 en dash.
     *
     * The J20i font is not guaranteed to have the arrow glyph. If your device
     * shows a box here, change ARROW to "->" and DASH to "-": every label in
     * the MIDlet goes through these two constants.
     */
    public static final String ARROW = "\u2192";
    public static final String DASH = "\u2013";

    public String id;        // routeId
    public String line;      // e.g. "507"
    public String dir;       // e.g. "Gocław"
    public String dep;       // departure time "16:12"
    public String arr;       // arrival time "16:29"
    public int duration;     // minutes
    public WalkPart[] walks;
    public TransitPart[] transits;

    /**
     * Part order as sent by the server (W/T line sequence).
     * Value >= 0: index into walks. Value < 0: index into transits is -order-1.
     * Null when unknown (fallback: walks then transits).
     */
    public int[] order;

    public Route() {
    }

    /** True if the route has at least one walking part. */
    public boolean hasWalks() {
        return walks != null && walks.length > 0;
    }

    /** Screen 3 title, e.g. "507 → Gocław". */
    public String title() {
        return line + " " + ARROW + " " + dir;
    }

    /**
     * Screen 2 row, e.g. "* 507 → Gocław   16:12–16:29  (25 min)".
     * The leading '*' marks routes that contain walking parts (ASCII only:
     * J20i fonts vary too much for a real pedestrian glyph).
     */
    public String label() {
        StringBuffer sb = new StringBuffer(48);
        if (hasWalks()) {
            sb.append("* ");
        }
        sb.append(line).append(' ').append(ARROW).append(' ').append(dir);
        sb.append("   ").append(dep).append(DASH).append(arr);
        sb.append("  (").append(duration).append(" min)");
        return sb.toString();
    }

    /** Header row inside screen 3, e.g. "16:12 → 16:29  (25 min)". */
    public String timing() {
        return dep + " " + ARROW + " " + arr + "  (" + duration + " min)";
    }

    /** Number of parts (walk + transit) known for this route. */
    public int partCount() {
        int n = 0;
        if (walks != null) {
            n += walks.length;
        }
        if (transits != null) {
            n += transits.length;
        }
        return n;
    }
}
