package javax.microedition.io;

import java.io.IOException;

/**
 * DESKTOP TEST SHIM ONLY - never compiled into Ember.jar.
 * Mirrors the parts of MIDP 2.0's Connection that HttpUtil touches.
 */
public interface Connection {
    void close() throws IOException;
}
