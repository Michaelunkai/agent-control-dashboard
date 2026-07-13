package com.michaelovsky.agentcontrol.domain

import com.michaelovsky.agentcontrol.data.TaskEntity
import java.time.Duration
import java.time.Instant

sealed interface ProgressPresentation {
    data object Hidden : ProgressPresentation
    data object Indeterminate : ProgressPresentation
    data class Determinate(val percent: Int) : ProgressPresentation
}

object UiPolicy {
    fun canDispatch(task: TaskEntity): Boolean =
        task.status != TaskStatus.QUEUED && TaskPolicy.canTransition(task.status, TaskStatus.QUEUED)

    fun needsAttention(task: TaskEntity): Boolean =
        task.status in setOf(TaskStatus.FAILED, TaskStatus.BLOCKED, TaskStatus.WAITING_APPROVAL) ||
            task.syncState == "conflict"

    fun progress(task: TaskEntity): ProgressPresentation = when {
        task.status !in setOf(TaskStatus.DISPATCHING, TaskStatus.IN_PROGRESS, TaskStatus.VERIFYING) ->
            ProgressPresentation.Hidden
        task.progressPercent == null -> ProgressPresentation.Indeterminate
        else -> ProgressPresentation.Determinate(task.progressPercent.coerceIn(0, 100))
    }

    fun isAgentFresh(heartbeat: String, now: Instant = Instant.now()): Boolean = runCatching {
        Duration.between(Instant.parse(heartbeat), now).seconds in 0..120
    }.getOrDefault(false)
}
