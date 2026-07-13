package com.michaelovsky.agentcontrol.domain

enum class TaskStatus {
    INBOX, READY, QUEUED, DISPATCHING, IN_PROGRESS, WAITING_NETWORK, WAITING_PC,
    WAITING_ANDROID, WAITING_QUOTA, WAITING_APPROVAL, BLOCKED, VERIFYING, REVIEW,
    DONE, FAILED, CANCELLED
}

enum class ExecutorKind { CLOUD, ANDROID, WINDOWS, FUTURE }

data class Availability(
    val network: Boolean,
    val pc: Boolean,
    val android: Boolean,
    val quota: Boolean
)

object TaskPolicy {
    private val transitions = mapOf(
        TaskStatus.INBOX to setOf(TaskStatus.READY, TaskStatus.CANCELLED),
        TaskStatus.READY to setOf(
            TaskStatus.QUEUED, TaskStatus.WAITING_NETWORK, TaskStatus.WAITING_PC,
            TaskStatus.WAITING_ANDROID, TaskStatus.WAITING_QUOTA, TaskStatus.BLOCKED,
            TaskStatus.CANCELLED
        ),
        TaskStatus.QUEUED to setOf(
            TaskStatus.DISPATCHING, TaskStatus.IN_PROGRESS, TaskStatus.WAITING_NETWORK,
            TaskStatus.WAITING_PC, TaskStatus.WAITING_ANDROID, TaskStatus.WAITING_QUOTA,
            TaskStatus.CANCELLED
        ),
        TaskStatus.DISPATCHING to setOf(
            TaskStatus.IN_PROGRESS, TaskStatus.WAITING_NETWORK, TaskStatus.WAITING_PC,
            TaskStatus.WAITING_ANDROID, TaskStatus.WAITING_QUOTA, TaskStatus.FAILED,
            TaskStatus.CANCELLED
        ),
        TaskStatus.IN_PROGRESS to setOf(
            TaskStatus.VERIFYING, TaskStatus.WAITING_NETWORK, TaskStatus.WAITING_PC,
            TaskStatus.WAITING_ANDROID, TaskStatus.WAITING_QUOTA, TaskStatus.WAITING_APPROVAL,
            TaskStatus.BLOCKED, TaskStatus.FAILED, TaskStatus.CANCELLED
        ),
        TaskStatus.WAITING_NETWORK to setOf(TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.WAITING_PC to setOf(TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.WAITING_ANDROID to setOf(TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.WAITING_QUOTA to setOf(TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.WAITING_APPROVAL to setOf(TaskStatus.QUEUED, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED),
        TaskStatus.BLOCKED to setOf(TaskStatus.READY, TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.VERIFYING to setOf(TaskStatus.REVIEW, TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.FAILED),
        TaskStatus.REVIEW to setOf(TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.CANCELLED),
        TaskStatus.DONE to emptySet(),
        TaskStatus.FAILED to setOf(TaskStatus.QUEUED, TaskStatus.CANCELLED),
        TaskStatus.CANCELLED to emptySet()
    )

    fun canTransition(from: TaskStatus, to: TaskStatus) = from == to || transitions[from]?.contains(to) == true

    fun waitingStatus(availability: Availability, executor: ExecutorKind): TaskStatus? = when {
        !availability.network -> TaskStatus.WAITING_NETWORK
        executor == ExecutorKind.CLOUD && !availability.quota -> TaskStatus.WAITING_QUOTA
        executor == ExecutorKind.WINDOWS && !availability.pc -> TaskStatus.WAITING_PC
        executor == ExecutorKind.ANDROID && !availability.android -> TaskStatus.WAITING_ANDROID
        else -> null
    }

    fun createTitle(description: String): String {
        val cleaned = description
            .replace(Regex("^(please|could you|can you|i want you to|i need you to)\\s+", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\b(immediately|please|for me)\\b", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\bthe\\s+(?=(android|windows|dashboard|login)\\b)", RegexOption.IGNORE_CASE), "")
            .replace(Regex("\\s+"), " ")
            .trim()
            .trimEnd('.', '!', '?')
        if (cleaned.isBlank()) return "Untitled task"
        val titled = cleaned.replaceFirstChar { it.uppercase() }
        if (titled.length <= 80) return titled
        val prefix = titled.take(77).substringBeforeLast(' ', titled.take(77)).trimEnd()
        return "$prefix..."
    }
}
