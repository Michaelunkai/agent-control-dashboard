package com.michaelovsky.agentcontrol.sync

import android.content.Context
import androidx.room.withTransaction
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerFactory
import androidx.work.WorkerParameters
import com.michaelovsky.agentcontrol.data.AgentControlDatabase
import com.michaelovsky.agentcontrol.data.TaskEntity
import com.michaelovsky.agentcontrol.data.AgentEntity
import com.michaelovsky.agentcontrol.data.ApprovalEntity
import com.michaelovsky.agentcontrol.domain.TaskStatus
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class SyncWorker(
    context: Context,
    parameters: WorkerParameters,
    private val databaseOverride: AgentControlDatabase? = null,
    private val configOverride: ConfigStore? = null
) : CoroutineWorker(context, parameters) {
    constructor(context: Context, parameters: WorkerParameters) :
        this(context, parameters, null, null)

    override suspend fun doWork(): Result {
        val config = configOverride ?: ConfigStore(applicationContext)
        if (!config.isConfigured) {
            config.syncStatus = "offline"
            return Result.success()
        }
        config.syncStatus = "syncing"
        val database = databaseOverride ?: AgentControlDatabase.get(applicationContext)
        for (item in database.outboxDao().pending(25)) {
            try {
                val endpoint = when (item.operation) {
                    "create_task" -> "/v1/tasks"
                    "dispatch_task" -> "/v1/tasks/${item.aggregateId}/dispatch"
                    "cancel_task" -> "/v1/tasks/${item.aggregateId}/cancel"
                    "approval_decision" -> "/v1/approvals/${item.aggregateId}/decision"
                    else -> {
                        database.outboxDao().recordFailure(item.id, "unsupported_operation")
                        continue
                    }
                }
                val connection = URL("${config.apiUrl}$endpoint").openConnection() as HttpURLConnection
                connection.requestMethod = "POST"
                connection.connectTimeout = 15_000
                connection.readTimeout = 30_000
                connection.doOutput = true
                connection.setRequestProperty("content-type", "application/json")
                connection.setRequestProperty("authorization", "Bearer ${config.ownerToken}")
                connection.outputStream.bufferedWriter().use { writer ->
                    writer.write(item.payload)
                }
                val code = connection.responseCode
                if (code in 200..299) {
                    database.withTransaction {
                        database.outboxDao().remove(item.id)
                        database.taskDao().markSynced(item.aggregateId)
                    }
                } else if (code == 409) {
                    database.withTransaction {
                        database.outboxDao().remove(item.id)
                        database.taskDao().markConflict(item.aggregateId)
                    }
                } else {
                    database.outboxDao().recordFailure(item.id, "HTTP $code")
                    if (code >= 500) {
                        config.syncStatus = "error"
                        return Result.retry()
                    }
                }
            } catch (error: Exception) {
                database.outboxDao().recordFailure(item.id, error.javaClass.simpleName)
                config.syncStatus = "error"
                return Result.retry()
            }
        }
        try {
            val connection = URL("${config.apiUrl}/v1/sync?cursor=${config.syncCursor}").openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 15_000
            connection.readTimeout = 30_000
            connection.setRequestProperty("authorization", "Bearer ${config.ownerToken}")
            if (connection.responseCode !in 200..299) {
                config.syncStatus = "error"
                return Result.retry()
            }
            val response = connection.inputStream.bufferedReader().use { it.readText() }
            val root = JSONObject(response)
            val tasks = root.getJSONArray("tasks")
            val mapped = buildList {
                for (index in 0 until tasks.length()) {
                    val task = tasks.getJSONObject(index)
                    add(TaskEntity(
                        id = task.getString("id"),
                        title = task.getString("title"),
                        description = task.getString("description"),
                        status = TaskStatus.valueOf(task.getString("status")),
                        priority = task.getInt("priority"),
                        version = task.getLong("version"),
                        createdAt = task.getString("createdAt"),
                        updatedAt = task.getString("updatedAt"),
                        assignedAgentId = task.optString("assignedAgentId").ifBlank { null },
                        syncState = "synced"
                    ))
                }
            }
            database.withTransaction {
                database.taskDao().upsertAll(mapped)
                config.syncCursor = root.getLong("cursor")
            }
            val agentsConnection = URL("${config.apiUrl}/v1/agents").openConnection() as HttpURLConnection
            agentsConnection.requestMethod = "GET"
            agentsConnection.connectTimeout = 15_000
            agentsConnection.readTimeout = 30_000
            agentsConnection.setRequestProperty("authorization", "Bearer ${config.ownerToken}")
            if (agentsConnection.responseCode in 200..299) {
                val agentsRoot = JSONObject(agentsConnection.inputStream.bufferedReader().use { it.readText() })
                val agents = agentsRoot.getJSONArray("agents")
                val mappedAgents = buildList {
                    for (index in 0 until agents.length()) {
                        val agent = agents.getJSONObject(index)
                        add(AgentEntity(
                            id = agent.getString("id"),
                            name = agent.getString("name"),
                            kind = agent.getString("kind"),
                            availability = agent.getString("availability"),
                            capabilities = agent.getJSONArray("capabilities").let { values ->
                                (0 until values.length()).joinToString(", ") { values.getString(it) }
                            },
                            currentTaskId = agent.optString("currentTaskId").ifBlank { null },
                            lastHeartbeatAt = agent.getString("lastHeartbeatAt")
                        ))
                    }
                }
                database.agentDao().upsertAll(mappedAgents)
            } else {
                config.syncStatus = "error"
                return Result.retry()
            }
            val approvalsConnection = URL("${config.apiUrl}/v1/approvals").openConnection() as HttpURLConnection
            approvalsConnection.requestMethod = "GET"
            approvalsConnection.connectTimeout = 15_000
            approvalsConnection.readTimeout = 30_000
            approvalsConnection.setRequestProperty("authorization", "Bearer ${config.ownerToken}")
            if (approvalsConnection.responseCode in 200..299) {
                val approvalsRoot = JSONObject(approvalsConnection.inputStream.bufferedReader().use { it.readText() })
                val approvals = approvalsRoot.getJSONArray("approvals")
                val mappedApprovals = buildList {
                    for (index in 0 until approvals.length()) {
                        val approval = approvals.getJSONObject(index)
                        add(ApprovalEntity(
                            id = approval.getString("id"),
                            taskId = approval.getString("taskId"),
                            question = approval.getString("question"),
                            risk = approval.getString("risk"),
                            status = approval.getString("status"),
                            createdAt = approval.getString("createdAt"),
                            decidedAt = approval.optString("decidedAt").ifBlank { null }
                        ))
                    }
                }
                database.approvalDao().upsertAll(mappedApprovals)
            } else {
                config.syncStatus = "error"
                return Result.retry()
            }
        } catch (_: Exception) {
            config.syncStatus = "error"
            return Result.retry()
        }
        config.syncStatus = "success"
        return Result.success()
    }

    companion object {
        fun factoryFor(database: AgentControlDatabase, config: ConfigStore): WorkerFactory =
            object : WorkerFactory() {
                override fun createWorker(
                    appContext: Context,
                    workerClassName: String,
                    workerParameters: WorkerParameters
                ): androidx.work.ListenableWorker? =
                    if (workerClassName == SyncWorker::class.java.name) {
                        SyncWorker(appContext, workerParameters, database, config)
                    } else {
                        null
                    }
            }

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "agent-control-sync",
                ExistingPeriodicWorkPolicy.UPDATE,
                request
            )
        }

        fun enqueueNow(context: Context) {
            val request = androidx.work.OneTimeWorkRequestBuilder<SyncWorker>()
                .setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
