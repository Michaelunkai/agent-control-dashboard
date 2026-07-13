package com.michaelovsky.agentcontrol

import com.michaelovsky.agentcontrol.domain.Availability
import com.michaelovsky.agentcontrol.domain.ExecutorKind
import com.michaelovsky.agentcontrol.domain.TaskPolicy
import com.michaelovsky.agentcontrol.domain.TaskStatus
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TaskPolicyTest {
    @Test
    fun verifiedLifecycleAllowsCompletion() {
        assertTrue(TaskPolicy.canTransition(TaskStatus.IN_PROGRESS, TaskStatus.VERIFYING))
        assertTrue(TaskPolicy.canTransition(TaskStatus.VERIFYING, TaskStatus.DONE))
        assertFalse(TaskPolicy.canTransition(TaskStatus.IN_PROGRESS, TaskStatus.DONE))
    }

    @Test
    fun unavailableCloudQuotaIsExplicit() {
        val result = TaskPolicy.waitingStatus(
            Availability(network = true, pc = false, android = true, quota = false),
            ExecutorKind.CLOUD
        )
        assertEquals(TaskStatus.WAITING_QUOTA, result)
    }

    @Test
    fun titleIsReadableAndBounded() {
        assertEquals(
            "Fix login redirect in Android application",
            TaskPolicy.createTitle("Please fix the login redirect in the Android application immediately")
        )
        assertTrue(TaskPolicy.createTitle("Implement " + "detailed functionality ".repeat(20)).length <= 80)
    }
}
