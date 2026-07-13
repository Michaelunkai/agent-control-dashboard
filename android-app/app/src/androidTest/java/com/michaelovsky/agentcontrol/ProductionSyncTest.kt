package com.michaelovsky.agentcontrol

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.WorkManager
import com.michaelovsky.agentcontrol.data.AgentControlDatabase
import com.michaelovsky.agentcontrol.data.TaskRepository
import com.michaelovsky.agentcontrol.sync.ConfigStore
import com.michaelovsky.agentcontrol.sync.SyncWorker
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class ProductionSyncTest {
    @Test
    fun applicationSchedulesPeriodicSynchronization() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val scheduled = WorkManager.getInstance(context)
            .getWorkInfosForUniqueWork("agent-control-sync")
            .get(10, TimeUnit.SECONDS)
        assertTrue(scheduled.isNotEmpty())
    }

    @Test
    fun localTaskRoundTripsThroughConfiguredControlPlane() = runTest {
        val arguments = InstrumentationRegistry.getArguments()
        val apiUrl = arguments.getString("agentControlApiUrl").orEmpty()
        val ownerToken = arguments.getString("agentControlOwnerToken").orEmpty()
        assumeTrue(
            "Production credentials were not supplied",
            apiUrl.startsWith("https://") && ownerToken.isNotBlank()
        )

        val context = ApplicationProvider.getApplicationContext<Context>()
        val config = ConfigStore(context)
        val previousApiUrl = config.apiUrl
        val previousOwnerToken = config.ownerToken
        val previousCursor = config.syncCursor
        val previousSyncStatus = config.syncStatus
        config.apply {
            this.apiUrl = apiUrl
            this.ownerToken = ownerToken
            syncCursor = 0
        }
        val database = Room.inMemoryDatabaseBuilder(context, AgentControlDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        try {
            val repository = TaskRepository(database)
            val marker = "Create Agent Control production dispatch verification marker ${System.currentTimeMillis()}"
            val taskId = repository.createTask(marker, 5)
            val worker = TestListenableWorkerBuilder<SyncWorker>(context)
                .setWorkerFactory(SyncWorker.factoryFor(database, config))
                .build()

            assertEquals(androidx.work.ListenableWorker.Result.success(), worker.doWork())
            val task = repository.observeTasks().first().single { it.id == taskId }
            assertEquals("synced", task.syncState)
            assertTrue(task.title.startsWith("Create Agent Control production dispatch verification marker"))
            assertTrue(database.outboxDao().pending(10).isEmpty())
            assertEquals("success", config.syncStatus)
        } finally {
            database.close()
            config.apiUrl = previousApiUrl
            config.ownerToken = previousOwnerToken
            config.syncCursor = previousCursor
            config.syncStatus = previousSyncStatus
        }
    }
}
