package ember;

/** One walking leg of a route (W line from the backend). */
public class WalkPart {
    public int index;      // partIndex from the W line
    public String type;    // start | transfer | end
    public int distance;   // meters
    public String desc;    // UTF-8 Polish description
    public int[] shapeX;   // scaled X coords (unpacked shape, may be null)
    public int[] shapeY;   // scaled Y coords (unpacked shape, may be null)

    public WalkPart() {
    }
}
