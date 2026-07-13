package com.michaelovsky.agentcontrol.sync

import kotlinx.coroutines.async
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class ConfigStoreTest {
    @Test
    fun statusChangesPropagateAcrossPublishers() = runTest {
        SyncStatusBus.publish("pending")

        val observed = async {
            SyncStatusBus.updates.first { it == "success" }
        }
        SyncStatusBus.publish("success")

        assertEquals("success", observed.await())
    }
}
