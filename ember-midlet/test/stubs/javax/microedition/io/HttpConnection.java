package javax.microedition.io;

import java.io.IOException;
import java.io.InputStream;

/**
 * DESKTOP TEST SHIM ONLY - never compiled into Ember.jar.
 * Mirrors the parts of MIDP 2.0's HttpConnection that HttpUtil touches.
 */
public interface HttpConnection extends Connection {

    String GET = "GET";
    int HTTP_OK = 200;

    void setRequestMethod(String method) throws IOException;

    void setRequestProperty(String key, String value) throws IOException;

    int getResponseCode() throws IOException;

    String getResponseMessage() throws IOException;

    long getLength();

    InputStream openInputStream() throws IOException;
}
