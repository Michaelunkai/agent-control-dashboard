package com.michaelovsky.agentcontrol

import android.content.ContentValues
import androidx.room.testing.MigrationTestHelper
import androidx.sqlite.db.framework.FrameworkSQLiteOpenHelperFactory
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.michaelovsky.agentcontrol.data.AgentControlDatabase
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DatabaseMigrationTest {
    private val databaseName = "agent-control-migration-test"

    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AgentControlDatabase::class.java.canonicalName,
        FrameworkSQLiteOpenHelperFactory()
    )

    @Test
    fun migration1To2PreservesTasksAndAddsApprovals() {
        helper.createDatabase(databaseName, 1).use { database ->
            database.insert(
                "tasks",
                0,
                ContentValues().apply {
                    put("id", "task-before-upgrade")
                    put("title", "Preserved task")
                    put("description", "Created before database version 2")
                    put("status", "BACKLOG")
                    put("priority", 2)
                    put("version", 1)
                    put("createdAt", "2026-07-12T00:00:00Z")
                    put("updatedAt", "2026-07-12T00:00:00Z")
                    putNull("assignedAgentId")
                    put("syncState", "pending")
                }
            )
            database.insert(
                "tasks",
                0,
                ContentValues().apply {
                    put("id", "valid-task-before-upgrade")
                    put("title", "Already valid task")
                    put("description", "Must preserve all existing values")
                    put("status", "IN_PROGRESS")
                    put("priority", 5)
                    put("version", 7)
                    put("createdAt", "2026-07-12T01:00:00Z")
                    put("updatedAt", "2026-07-12T02:00:00Z")
                    put("assignedAgentId", "windows-test")
                    put("syncState", "conflict")
                }
            )
        }

        helper.runMigrationsAndValidate(
            databaseName,
            2,
            true,
            AgentControlDatabase.MIGRATION_1_2
        ).use { database ->
            database.query("SELECT title, status FROM tasks WHERE id='task-before-upgrade'").use { cursor ->
                cursor.moveToFirst()
                assertEquals("Preserved task", cursor.getString(0))
                assertEquals("READY", cursor.getString(1))
            }
            database.query("SELECT COUNT(*) FROM approvals").use { cursor ->
                cursor.moveToFirst()
                assertEquals(0, cursor.getInt(0))
            }
            database.query(
                "SELECT status, priority, version, assignedAgentId, syncState FROM tasks " +
                    "WHERE id='valid-task-before-upgrade'"
            ).use { cursor ->
                cursor.moveToFirst()
                assertEquals("IN_PROGRESS", cursor.getString(0))
                assertEquals(5, cursor.getInt(1))
                assertEquals(7, cursor.getInt(2))
                assertEquals("windows-test", cursor.getString(3))
                assertEquals("conflict", cursor.getString(4))
            }
        }
    }
}
