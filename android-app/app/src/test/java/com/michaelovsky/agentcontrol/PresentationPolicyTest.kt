package com.michaelovsky.agentcontrol

import com.michaelovsky.agentcontrol.data.TaskEntity
import com.michaelovsky.agentcontrol.bridge.LauncherBridge
import com.michaelovsky.agentcontrol.domain.ProgressPresentation
import com.michaelovsky.agentcontrol.domain.TaskStatus
import com.michaelovsky.agentcontrol.domain.UiPolicy
import com.michaelovsky.agentcontrol.ui.syncLabel
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PresentationPolicyTest {
    private fun task(status: TaskStatus, progress: Int? = null) = TaskEntity(
        "id-$status", "Title", "Description", status, 3, 1,
        "2026-07-12T00:00:00Z", "2026-07-12T00:00:00Z", progressPercent = progress
    )

    @Test fun attentionIncludesFailuresBlocksConflictsAndApprovals() {
        assertTrue(UiPolicy.needsAttention(task(TaskStatus.FAILED)))
        assertTrue(UiPolicy.needsAttention(task(TaskStatus.BLOCKED)))
        assertTrue(UiPolicy.needsAttention(task(TaskStatus.READY).copy(syncState = "conflict")))
        assertFalse(UiPolicy.needsAttention(task(TaskStatus.QUEUED)))
    }

    @Test fun missingProgressIsIndeterminateRatherThanZero() {
        assertEquals(ProgressPresentation.Indeterminate, UiPolicy.progress(task(TaskStatus.IN_PROGRESS)))
        assertEquals(ProgressPresentation.Determinate(40), UiPolicy.progress(task(TaskStatus.IN_PROGRESS, 40)))
        assertEquals(ProgressPresentation.Hidden, UiPolicy.progress(task(TaskStatus.READY)))
    }

    @Test fun dispatchControlsOnlyAppearForLegallyDispatchableStates() {
        assertTrue(UiPolicy.canDispatch(task(TaskStatus.READY)))
        assertTrue(UiPolicy.canDispatch(task(TaskStatus.FAILED)))
        assertTrue(UiPolicy.canDispatch(task(TaskStatus.WAITING_PC)))
        assertFalse(UiPolicy.canDispatch(task(TaskStatus.QUEUED)))
        assertFalse(UiPolicy.canDispatch(task(TaskStatus.IN_PROGRESS)))
        assertFalse(UiPolicy.canDispatch(task(TaskStatus.VERIFYING)))
        assertFalse(UiPolicy.canDispatch(task(TaskStatus.DONE)))
    }

    @Test fun heartbeatFreshnessOverridesStaleOnlineFlag() {
        val now = Instant.parse("2026-07-13T10:00:00Z")
        assertTrue(UiPolicy.isAgentFresh("2026-07-13T09:59:10Z", now))
        assertFalse(UiPolicy.isAgentFresh("2026-07-13T09:54:00Z", now))
    }

    @Test fun configuredDashboardReportsOfflineStateHonestly() {
        assertEquals("Saved offline - reconnect to synchronize", syncLabel(true, 0, "offline"))
    }

    @Test fun phoneLaunchTargetsTheOfficialCodexRemoteRoute() {
        assertEquals("com.openai.chat://codex/open", LauncherBridge.CODEX_REMOTE_URI)
    }
}
