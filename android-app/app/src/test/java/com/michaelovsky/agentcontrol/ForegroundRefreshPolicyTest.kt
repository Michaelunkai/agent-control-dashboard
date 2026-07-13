package com.michaelovsky.agentcontrol

import com.michaelovsky.agentcontrol.sync.SyncWorker
import com.michaelovsky.agentcontrol.ui.FOREGROUND_REFRESH_MILLIS
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ForegroundRefreshPolicyTest {
    @Test fun refreshCadenceIsInsideProductWindowAndUsesStableUniqueWorkName() {
        assertTrue(FOREGROUND_REFRESH_MILLIS in 2_000L..3_000L)
        assertEquals("agent-control-sync-now", SyncWorker.SYNC_NOW_WORK_NAME)
    }
}
