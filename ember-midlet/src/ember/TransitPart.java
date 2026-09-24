package ember;

/** One transit leg of a route (T line from the backend). */
public class TransitPart {
    public String line;   // e.g. "507"
    public String dir;    // e.g. "Gocław"
    public String from;   // boarding stop
    public String to;     // alighting stop
    public int stops;     // number of stops passed

    public TransitPart() {
    }
}
