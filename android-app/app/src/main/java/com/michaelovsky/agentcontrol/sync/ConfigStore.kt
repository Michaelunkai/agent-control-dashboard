package com.michaelovsky.agentcontrol.sync

import android.content.Context
import androidx.core.content.edit
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.michaelovsky.agentcontrol.BuildConfig
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

internal object SyncStatusBus {
    val updates = MutableStateFlow<String?>(null)

    fun publish(status: String) {
        updates.value = status
    }
}

class ConfigStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "agent-control-secrets",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    var apiUrl: String
        get() = preferences.getString("api_url", null) ?: BuildConfig.DEFAULT_API_URL
        set(value) {
            preferences.edit {
                putString("api_url", value.trimEnd('/'))
                putString("sync_status", "pending")
            }
            SyncStatusBus.publish("pending")
        }

    var ownerToken: String
        get() = preferences.getString("owner_token", "") ?: ""
        set(value) {
            preferences.edit {
                putString("owner_token", value)
                putString("sync_status", "pending")
            }
            SyncStatusBus.publish("pending")
        }

    var syncCursor: Long
        get() = preferences.getLong("sync_cursor", 0L)
        set(value) = preferences.edit { putLong("sync_cursor", value) }

    var syncStatus: String
        get() = preferences.getString("sync_status", "pending") ?: "pending"
        set(value) {
            preferences.edit { putString("sync_status", value) }
            SyncStatusBus.publish(value)
        }

    fun observeSyncStatus(): Flow<String> =
        SyncStatusBus.updates.map { it ?: syncStatus }.distinctUntilChanged()

    val isConfigured: Boolean get() = apiUrl.startsWith("https://") && ownerToken.isNotBlank()
}
