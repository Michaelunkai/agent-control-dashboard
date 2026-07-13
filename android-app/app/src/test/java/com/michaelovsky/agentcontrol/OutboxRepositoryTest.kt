package com.michaelovsky.agentcontrol

import android.content.Context
import android.app.Application
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.michaelovsky.agentcontrol.data.AgentControlDatabase
import com.michaelovsky.agentcontrol.data.TaskRepository
import com.michaelovsky.agentcontrol.data.ApprovalEntity
import com.michaelovsky.agentcontrol.domain.ExecutorKind
import com.michaelovsky.agentcontrol.domain.TaskStatus
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class OutboxRepositoryTest {
    private lateinit var database: AgentControlDatabase
    private lateinit var repository: TaskRepository

    @Before
    fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AgentControlDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repository = TaskRepository(database)
    }

    @After
    fun close() = database.close()

    @Test
    fun createTaskWritesTaskAndOutboxAtomically() = runTest {
        repository.createTask("Upgrade dashboard accessibility", 4)
        assertEquals(1, repository.observeTasks().first().size)
        assertEquals(1, repository.observePendingSyncCount().first())
        val pending = database.outboxDao().pending(10)
        assertEquals(1, pending.size)
        assertTrue(pending.single().payload.contains("Upgrade dashboard accessibility"))
        assertTrue(pending.single().payload.contains("\"clientId\""))
    }

    @Test
    fun offlineDispatchUpdatesBoardAndQueuesVersionCheckedAction() = runTest {
        val id = repository.createTask("Run Android release verification", 5)
        repository.dispatch(id, ExecutorKind.WINDOWS)
        val task = repository.observeTasks().first().single()
        assertEquals(TaskStatus.QUEUED, task.status)
        assertEquals(2, task.version)
        val pending = database.outboxDao().pending(10)
        assertEquals(2, pending.size)
        assertEquals("dispatch_task", pending.last().operation)
        assertTrue(pending.last().payload.contains("\"preferredExecutor\":\"windows\""))
    }

    @Test
    fun cancellationIsImmediateAndDurablyQueued() = runTest {
        val id = repository.createTask("Cancel this work safely", 2)
        repository.cancel(id)
        val task = repository.observeTasks().first().single()
        assertEquals(TaskStatus.CANCELLED, task.status)
        assertEquals("cancel_task", database.outboxDao().pending(10).last().operation)
    }

    @Test
    fun approvalDecisionUpdatesOfflineAndQueuesSynchronization() = runTest {
        database.approvalDao().upsert(
            ApprovalEntity(
                id = "approval-1", taskId = "task-1", question = "Deploy?",
                risk = "Production change", status = "pending", createdAt = "2026-07-12T00:00:00Z"
            )
        )
        repository.decideApproval("approval-1", "approved")
        assertTrue(repository.observeApprovals().first().isEmpty())
        val queued = database.outboxDao().pending(10).single()
        assertEquals("approval_decision", queued.operation)
        assertTrue(queued.payload.contains("\"decision\":\"approved\""))
    }
}
