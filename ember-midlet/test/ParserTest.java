import ember.HttpUtil;
import ember.Route;
import ember.WalkPart;

/**
 * Desktop tests for the parts of Ember that can run off-device: the /v parser,
 * the CLDC-safe splitter, URL encoding, shape scaling and the RMS cache.
 *
 * It compiles the real ember.HttpUtil / ember.Route / ember.WalkPart /
 * ember.TransitPart sources against desktop shims of the two MIDP APIs those
 * files touch (javax.microedition.io and javax.microedition.rms), so no copy of
 * the production code exists here.
 *
 * Run with:  ant test
 */
public class ParserTest {

    private static int failures;

    public static void main(String[] args) {
        try {
            routeList();
            shapes();
            splitter();
            urlEncoding();
            cache();
        } catch (Throwable t) {
            t.printStackTrace();
            failures++;
        }
        if (failures > 0) {
            System.out.println(failures + " test(s) FAILED");
            System.exit(1);
        }
        System.out.println("All tests passed");
    }

    // ------------------------------------------------------------------

    private static final String RESPONSE =
            "R|r1|507|Gocław|16:12|16:29|25\n"
            + "W|0|start|690|do przystanku Międzynarodowa|21.000000,52.000000;21.002000,52.002000\n"
            + "T|507|Gocław|Międzynarodowa|Saska|5\n"
            + "W|1|end|450|do celu|21.003000,52.003000;21.004000,52.004000\n"
            + "\n"
            + "R|r2|162|Pabianice|16:20|16:50|30\n"
            + "T|162|Pabianice|Międzynarodowa|Dworzec PKP|12\n";

    private static void routeList() {
        Route[] routes = HttpUtil.parseRoutes(RESPONSE);

        check(routes.length == 2, "two routes parsed");

        Route first = routes[0];
        check("507".equals(first.line), "route 1 line");
        check("Gocław".equals(first.dir), "route 1 direction (UTF-8)");
        check("16:12".equals(first.dep) && "16:29".equals(first.arr), "route 1 times");
        check(first.duration == 25, "route 1 duration");
        check(first.walks.length == 2, "route 1 has two walk parts");
        check(first.transits.length == 1, "route 1 has one transit part");
        check(first.hasWalks(), "route 1 reports walks");

        // order is walk, transit, walk -> 0, -1, 1
        check(first.order.length == 3
                && first.order[0] == 0 && first.order[1] == -1 && first.order[2] == 1,
                "route 1 part order");

        WalkPart start = first.walks[0];
        check(start.index == 0, "walk 0 index");
        check(start.distance == 690, "walk 0 distance");
        check("start".equals(start.type), "walk 0 type");
        check("do przystanku Międzynarodowa".equals(start.desc), "walk 0 description (UTF-8)");
        check(first.walks[1].index == 1 && first.walks[1].distance == 450, "walk 1 fields");

        check("507".equals(first.transits[0].line), "transit line");
        check("Saska".equals(first.transits[0].to), "transit destination");
        check(first.transits[0].stops == 5, "transit stop count");

        check(!"r2".equals(first.id) && "r2".equals(routes[1].id), "route id field");
        check(!routes[1].hasWalks(), "route 2 has no walks");
        check(routes[1].label().indexOf('*') != 0, "route 2 label has no walk marker");
        check(routes[0].label().indexOf('*') == 0, "route 1 label has walk marker");

        String expected = "* 507 " + Route.ARROW + " Gocław   16:12" + Route.DASH + "16:29  (25 min)";
        check(expected.equals(first.label()), "route label format: " + first.label());
        check(("507 " + Route.ARROW + " Gocław").equals(first.title()), "route title format");

        // An empty body or plain prose must not blow up.
        check(HttpUtil.parseRoutes("").length == 0, "empty body -> no routes");
        check(HttpUtil.parseRoutes(null).length == 0, "null body -> no routes");
        check(HttpUtil.parseRoutes("Czy mogę pomóc?\n\nProszę podać więcej szczegółów.").length == 0,
                "prose body -> no routes");
        check(HttpUtil.parseRoutes("R|only|1|A|1:00|1:05|5").length == 1,
                "response without trailing newline still parses");
    }

    private static void shapes() {
        Route[] routes = HttpUtil.parseRoutes(
                "R|s|1|A|1:00|1:10|10\n"
                + "W|0|start|100|trzy punkty|21.000000,52.000000;21.001000,52.001000;21.002000,52.002000\n"
                + "W|1|end|100|bez geometrii|\n"
                + "W|2|end|100|uszkodzona|21.000000\n");
        WalkPart[] walks = routes[0].walks;

        check(walks[0].shapeX != null && walks[0].shapeX.length == 3, "three shape points kept");
        check(walks[0].shapeX[0] == 0 && walks[0].shapeX[1] == 119 && walks[0].shapeX[2] == 239,
                "shape X scaled into 0..239: "
                + walks[0].shapeX[0] + "," + walks[0].shapeX[1] + "," + walks[0].shapeX[2]);
        check(walks[0].shapeY[0] == 319 && walks[0].shapeY[1] == 159 && walks[0].shapeY[2] == 0,
                "shape Y scaled and flipped into 0..319: "
                + walks[0].shapeY[0] + "," + walks[0].shapeY[1] + "," + walks[0].shapeY[2]);

        check(walks[1].shapeX == null, "empty shape -> null coords");
        check(walks[2].shapeX == null, "malformed shape -> null coords");
        check("uszkodzona".equals(walks[2].desc), "malformed shape keeps description");
    }

    private static void splitter() {
        String[] a = HttpUtil.split("W|0|start|690|desc|", '|');
        check(a.length == 6 && "W".equals(a[0]) && "desc".equals(a[4]) && "".equals(a[5]),
                "trailing empty field preserved (empty shape)");

        String[] b = HttpUtil.split("", '|');
        check(b.length == 1 && "".equals(b[0]), "empty string -> one empty field");

        String[] c = HttpUtil.split("R|r|507|Gocław|16:12|16:29|25", '|');
        check(c.length == 7 && "25".equals(c[6]), "R line split into seven fields");

        String[] d = HttpUtil.split("21.1,52.2", ',');
        check(d.length == 2 && "21.1".equals(d[0]) && "52.2".equals(d[1]), "coordinate pair split");
    }

    private static void urlEncoding() {
        check("Mi%C4%99dzynarodowa".equals(HttpUtil.urlEncode("Międzynarodowa")),
                "Polish query encoded as UTF-8: " + HttpUtil.urlEncode("Międzynarodowa"));
        check("%C5%81%C3%B3d%C5%BA".equals(HttpUtil.urlEncode("Łódź")),
                "Łódź encoded: " + HttpUtil.urlEncode("Łódź"));
        check("a%20b".equals(HttpUtil.urlEncode("a b")), "space -> %20");
        check("507".equals(HttpUtil.urlEncode("507")), "digits untouched");
    }

    private static void cache() throws Exception {
        HttpUtil.cacheClear();
        check(HttpUtil.cacheLoad() == null, "empty cache -> null (forces a fetch)");

        String body = "R|r1|507|Gocław|16:12|16:29|25\nW|0|start|690|Idź do Centrum|\n";
        HttpUtil.cacheSave(body);
        String loaded = HttpUtil.cacheLoad();
        check(body.equals(loaded), "cache round-trip preserves the exact body");
        check(loaded != null && HttpUtil.parseRoutes(loaded).length == 1,
                "cached body parses back into one route");

        HttpUtil.cacheClear();
        check(HttpUtil.cacheLoad() == null, "cleared cache -> null");
    }

    // ------------------------------------------------------------------

    private static void check(boolean ok, String label) {
        if (!ok) {
            failures++;
        }
        System.out.println((ok ? "PASS  " : "FAIL  ") + label);
    }
}
