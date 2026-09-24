package javax.microedition.io;

import java.io.IOException;

/**
 * DESKTOP TEST SHIM ONLY - never compiled into Ember.jar.
 * Connector.open() always fails here; the parser tests never hit the network.
 */
public class Connector {

    public static final int READ = 1;
    public static final int WRITE = 2;
    public static final int READ_WRITE = 3;

    public static Connection open(String name, int mode, boolean timeouts) throws IOException {
        throw new IOException("desktop test shim: no network");
    }
}
