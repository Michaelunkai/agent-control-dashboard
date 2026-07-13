package com.michaelovsky.agentcontrol.sync

import com.michaelovsky.agentcontrol.data.TaskEntity
import com.michaelovsky.agentcontrol.data.TaskEventEntity
import com.michaelovsky.agentcontrol.domain.TaskStatus
import org.json.JSONObject

data class SyncPayload(
    val cursor: Long,
    val tasks: List<TaskEntity>,
    val events: List<TaskEventEntity>
)

object SyncPayloadMapper {
    fun parse(payload: String): SyncPayload {
        val root = JSONObject(payload)
        val tasksJson = root.optJSONArray("tasks")
        val tasks = buildList {
            if (tasksJson != null) for (index in 0 until tasksJson.length()) {
                val task = tasksJson.getJSONObject(index)
                add(TaskEntity(
                    id = task.getString("id"),
                    title = task.getString("title"),
                    description = task.getString("description"),
                    status = TaskStatus.valueOf(task.getString("status")),
                    priority = task.getInt("priority"),
                    version = task.getLong("version"),
                    createdAt = task.getString("createdAt"),
                    updatedAt = task.getString("updatedAt"),
                    assignedAgentId = task.nullableString("assignedAgentId"),
                    progressPercent = if (task.has("progressPercent") && !task.isNull("progressPercent")) task.getInt("progressPercent") else null,
                    currentStep = task.nullableString("currentStep"),
                    startedAt = task.nullableString("startedAt"),
                    completedAt = task.nullableString("completedAt"),
                    syncState = "synced"
                ))
            }
        }
        val eventsJson = root.optJSONArray("events")
        val events = buildList {
            if (eventsJson != null) for (index in 0 until eventsJson.length()) {
                val event = eventsJson.getJSONObject(index)
                val detail = event.optJSONObject("payload") ?: JSONObject()
                add(TaskEventEntity(
                    id = event.getString("id"),
                    taskId = event.getString("taskId"),
                    type = event.getString("type"),
                    message = eventMessage(event.getString("type"), detail),
                    createdAt = event.optString("occurredAt").ifBlank { event.optString("createdAt") },
                    progressPercent = if (detail.has("progressPercent") && !detail.isNull("progressPercent")) detail.getInt("progressPercent") else null
                ))
            }
        }
        return SyncPayload(root.getLong("cursor"), tasks, events)
    }

    private fun JSONObject.nullableString(name: String): String? =
        if (has(name) && !isNull(name)) optString(name).ifBlank { null } else null

    private fun eventMessage(type: String, detail: JSONObject): String {
        detail.optString("message").ifBlank { null }?.let { return it }
        detail.optString("summary").ifBlank { null }?.let { return it }
        detail.optString("currentStep").ifBlank { null }?.let { return it }
        detail.optString("title").ifBlank { null }?.let { return it }
        if (type == "status_changed") {
            val status = detail.optString("to").lowercase().replace('_', ' ')
                .replaceFirstChar { it.titlecase() }
            val reason = detail.optString("reason")
            val explanation = when {
                reason.startsWith("claimed:") -> "claimed by ${reason.substringAfter(':')}"
                reason.startsWith("dispatch:") -> "sent to ${reason.substringAfter(':')}"
                else -> reason.replace('_', ' ')
            }
            return listOf(status, explanation).filter { it.isNotBlank() }.joinToString(" - ")
        }
        detail.optString("status").ifBlank { null }?.let {
            return it.lowercase().replace('_', ' ').replaceFirstChar { char -> char.titlecase() }
        }
        return type.replace('_', ' ').replaceFirstChar { it.titlecase() }
    }
}
