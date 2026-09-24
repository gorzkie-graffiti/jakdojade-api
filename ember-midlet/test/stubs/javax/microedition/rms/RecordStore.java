package javax.microedition.rms;

import java.util.Hashtable;

/**
 * DESKTOP TEST SHIM ONLY - never compiled into Ember.jar.
 *
 * An in-memory stand-in for MIDP 2.0's RecordStore, good enough to exercise
 * HttpUtil.cacheSave()/cacheLoad()/cacheClear() off-device. Each store holds a
 * single record, always with record id 1, exactly like the MIDlet uses it.
 */
public class RecordStore {

    private static final Hashtable STORES = new Hashtable();

    private byte[] record;

    public static RecordStore openRecordStore(String name, boolean createIfNecessary)
            throws RecordStoreException {
        RecordStore store = (RecordStore) STORES.get(name);
        if (store == null) {
            if (!createIfNecessary) {
                throw new RecordStoreNotFoundException("record store not found: " + name);
            }
            store = new RecordStore();
            STORES.put(name, store);
        }
        return store;
    }

    public static void deleteRecordStore(String name) throws RecordStoreException {
        if (STORES.remove(name) == null) {
            throw new RecordStoreNotFoundException("record store not found: " + name);
        }
    }

    public int getNumRecords() {
        return record == null ? 0 : 1;
    }

    public int addRecord(byte[] data, int offset, int numBytes) throws RecordStoreException {
        byte[] copy = new byte[numBytes];
        System.arraycopy(data, offset, copy, 0, numBytes);
        record = copy;
        return 1;
    }

    public byte[] getRecord(int recordId) throws RecordStoreException {
        if (record == null || recordId != 1) {
            throw new RecordStoreException("no record " + recordId);
        }
        return record;
    }

    public void closeRecordStore() {
        // nothing to release in memory
    }
}
