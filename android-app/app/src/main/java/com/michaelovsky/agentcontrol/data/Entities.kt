package com.michaelovsky.agentcontrol.data

import androidx.room.Entity
import androidx.room.PrimaryKey
import com.michaelovsky.agentcontrol.domain.TaskStatus

@Entity(tableName = "tasks")
data class TaskEntity(
    @PrimaryKey val id: String,
    val title: String,
    val description: String,
    val status: TaskStatus,
    val priority: Int,
    val version: Long,
    val createdAt: String,
    val updatedAt: String,
    val assignedAgentId: String? = null,
    val syncState: String = "pending"
)

@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey val id: String,
    val operation: String,
    val aggregateId: String,
    val payload: String,
    val createdAt: String,
    val attempts: Int = 0,
    val lastError: String? = null
)

@Entity(tableName = "agents")
data class AgentEntity(
    @PrimaryKey val id: String,
    val name: String,
    val kind: String,
    val availability: String,
    val capabilities: String,
    val currentTaskId: String? = null,
    val lastHeartbeatAt: String
)

@Entity(tableName = "approvals")
data class ApprovalEntity(
    @PrimaryKey val id: String,
    val taskId: String,
    val question: String,
    val risk: String,
    val status: String,
    val createdAt: String,
    val decidedAt: String? = null
)
