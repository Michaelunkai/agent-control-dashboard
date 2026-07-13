package com.michaelovsky.agentcontrol.data

import androidx.room.withTransaction
import com.michaelovsky.agentcontrol.domain.TaskPolicy
import com.michaelovsky.agentcontrol.domain.TaskStatus
import com.michaelovsky.agentcontrol.domain.ExecutorKind
import kotlinx.coroutines.flow.Flow
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

class TaskRepository(
    private val database: AgentControlDatabase,
    private val onOutboxChanged: () -> Unit = {}
) {
    fun observeTasks(): Flow<List<TaskEntity>> = database.taskDao().observeAll()
    fun observeAgents(): Flow<List<AgentEntity>> = database.agentDao().observeAll()
    fun observeApprovals(): Flow<List<ApprovalEntity>> = database.approvalDao().observePending()
    fun observePendingSyncCount(): Flow<Int> = database.outboxDao().observePendingCount()
    fun observeTask(id: String): Flow<TaskEntity?> = database.taskDao().observe(id)
    fun observeTaskEvents(id: String): Flow<List<TaskEventEntity>> = database.taskEventDao().observeForTask(id)

    suspend fun createTask(
        title: String,
        description: String,
        priority: Int,
        executor: ExecutorKind
    ): String {
        val id = UUID.randomUUID().toString()
        val createdAt = Instant.now()
        val now = createdAt.toString()
        val dispatchAt = createdAt.plusMillis(1).toString()
        val task = TaskEntity(
            id = id,
            title = title.trim().ifBlank { TaskPolicy.createTitle(description) },
            description = description.trim(),
            status = TaskStatus.QUEUED,
            priority = priority.coerceIn(1, 5),
            version = 2,
            createdAt = now,
            updatedAt = now
        )
        val payload = JSONObject()
            .put("clientId", id)
            .put("description", task.description)
            .put("title", task.title)
            .put("priority", task.priority)
            .put("requiredCapabilities", org.json.JSONArray().put("coding"))
            .toString()
        val dispatchPayload = JSONObject()
            .put("preferredExecutor", executor.name.lowercase())
            .put("expectedVersion", 1)
            .toString()
        database.withTransaction {
            database.taskDao().upsert(task)
            database.outboxDao().insert(
                OutboxEntity(
                    id = UUID.randomUUID().toString(),
                    operation = "create_task",
                    aggregateId = id,
                    payload = payload,
                    createdAt = now
                )
            )
            database.outboxDao().insert(
                OutboxEntity(
                    id = UUID.randomUUID().toString(),
                    operation = "dispatch_task",
                    aggregateId = id,
                    payload = dispatchPayload,
                    createdAt = dispatchAt
                )
            )
        }
        onOutboxChanged()
        return id
    }

    suspend fun createTask(description: String, priority: Int): String =
        createTask(TaskPolicy.createTitle(description), description, priority, ExecutorKind.WINDOWS)

    suspend fun dispatch(id: String, executor: ExecutorKind) {
        val current = database.taskDao().get(id) ?: error("task_not_found")
        require(TaskPolicy.canTransition(current.status, TaskStatus.QUEUED)) { "invalid_status_transition" }
        val now = Instant.now().toString()
        val changed = current.copy(
            status = TaskStatus.QUEUED,
            version = current.version + 1,
            updatedAt = now,
            syncState = "pending"
        )
        val payload = JSONObject()
            .put("preferredExecutor", executor.name.lowercase())
            .put("expectedVersion", current.version)
            .toString()
        enqueueChange(changed, "dispatch_task", payload, now)
    }

    suspend fun cancel(id: String) {
        val current = database.taskDao().get(id) ?: error("task_not_found")
        require(TaskPolicy.canTransition(current.status, TaskStatus.CANCELLED)) { "invalid_status_transition" }
        val now = Instant.now().toString()
        val payload = JSONObject()
            .put("expectedVersion", current.version)
            .put("reason", "owner_cancelled")
            .toString()
        enqueueChange(
            current.copy(
                status = TaskStatus.CANCELLED,
                version = current.version + 1,
                updatedAt = now,
                syncState = "pending"
            ),
            "cancel_task",
            payload,
            now
        )
    }

    suspend fun decideApproval(id: String, decision: String) {
        require(decision == "approved" || decision == "rejected")
        val current = database.approvalDao().get(id) ?: error("approval_not_found")
        val now = Instant.now().toString()
        database.withTransaction {
            database.approvalDao().upsert(current.copy(status = decision, decidedAt = now))
            database.outboxDao().insert(
                OutboxEntity(
                    id = UUID.randomUUID().toString(),
                    operation = "approval_decision",
                    aggregateId = id,
                    payload = JSONObject().put("decision", decision).toString(),
                    createdAt = now
                )
            )
        }
        onOutboxChanged()
    }

    private suspend fun enqueueChange(task: TaskEntity, operation: String, payload: String, now: String) {
        database.withTransaction {
            database.taskDao().upsert(task)
            database.outboxDao().insert(
                OutboxEntity(
                    id = UUID.randomUUID().toString(),
                    operation = operation,
                    aggregateId = task.id,
                    payload = payload,
                    createdAt = now
                )
            )
        }
        onOutboxChanged()
    }
}
