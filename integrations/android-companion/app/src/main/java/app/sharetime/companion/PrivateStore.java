package app.sharetime.companion;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypt values with a non-exportable Android Keystore key. Never stores a plaintext token. */
final class PrivateStore {
    private static final Object LOCK = new Object();
    private static final String ALIAS = "share-time-companion-v1";
    private final SharedPreferences preferences;

    PrivateStore(Context context) {
        preferences = context.getSharedPreferences("private-data", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,
                    "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(ALIAS, null);
    }

    String get(String name, String fallback) {
        synchronized (LOCK) {
            String saved = preferences.getString(name, null);
            if (saved == null) return fallback;
            try {
                String[] parts = saved.split(":", -1);
                if (parts.length != 2) throw new IllegalStateException();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128,
                        Base64.decode(parts[0], Base64.NO_WRAP)));
                cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
                return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)),
                        StandardCharsets.UTF_8);
            } catch (Exception ignored) {
                // Corrupt or invalidated storage must not silently fall back to a new identity/token.
                throw new IllegalStateException("端末内の暗号化データを開けません。接続を解除して再設定してください。");
            }
        }
    }

    void put(String name, String value) {
        synchronized (LOCK) {
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.ENCRYPT_MODE, key());
                cipher.updateAAD(name.getBytes(StandardCharsets.UTF_8));
                String encrypted = Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
                        + Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),
                        Base64.NO_WRAP);
                if (!preferences.edit().putString(name, encrypted).commit()) {
                    throw new IllegalStateException();
                }
            } catch (Exception ignored) {
                throw new IllegalStateException("端末内の暗号化保存に失敗しました。");
            }
        }
    }

    void clear() {
        synchronized (LOCK) {
            if (!preferences.edit().clear().commit()) {
                throw new IllegalStateException("端末内のデータを消去できませんでした。");
            }
        }
    }
}
