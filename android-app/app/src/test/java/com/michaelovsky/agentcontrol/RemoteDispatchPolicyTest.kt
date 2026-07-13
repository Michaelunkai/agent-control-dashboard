package com.michaelovsky.agentcontrol

import com.michaelovsky.agentcontrol.bridge.BridgeResult
import com.michaelovsky.agentcontrol.ui.dispatchAfterRemoteOpen
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RemoteDispatchPolicyTest {
    @Test fun failedRemoteOpenDoesNotDispatch() = runTest {
        var dispatched = false
        val message = dispatchAfterRemoteOpen(
            { BridgeResult(false, "Unable to open Codex Remote") },
            { dispatched = true }
        )
        assertFalse(dispatched)
        assertEquals("Unable to open Codex Remote", message)
    }

    @Test fun successfulRemoteOpenDispatchesExactlyOnce() = runTest {
        var count = 0
        val message = dispatchAfterRemoteOpen(
            { BridgeResult(true, "Opening Codex Remote") },
            { count += 1 }
        )
        assertTrue(count == 1)
        assertEquals("Opening Codex Remote", message)
    }
}
