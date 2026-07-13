package com.michaelovsky.agentcontrol.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverter
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.michaelovsky.agentcontrol.domain.TaskStatus

class Converters {
    @TypeConverter fun statusToString(value: TaskStatus): String = value.name
    @TypeConverter fun stringToStatus(value: String): TaskStatus = TaskStatus.valueOf(value)
}

@Database(
    entities = [TaskEntity::class, OutboxEntity::class, AgentEntity::class, ApprovalEntity::class],
    version = 2,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AgentControlDatabase : RoomDatabase() {
    abstract fun taskDao(): TaskDao
    abstract fun outboxDao(): OutboxDao
    abstract fun agentDao(): AgentDao
    abstract fun approvalDao(): ApprovalDao

    companion object {
        @Volatile private var instance: AgentControlDatabase? = null

        fun get(context: Context): AgentControlDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                AgentControlDatabase::class.java,
                "agent-control.db"
            ).addMigrations(MIGRATION_1_2).build().also { instance = it }
        }

        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("UPDATE tasks SET status = 'READY' WHERE status = 'BACKLOG'")
                db.execSQL(
                    """CREATE TABLE IF NOT EXISTS approvals (
                        id TEXT NOT NULL PRIMARY KEY,
                        taskId TEXT NOT NULL,
                        question TEXT NOT NULL,
                        risk TEXT NOT NULL,
                        status TEXT NOT NULL,
                        createdAt TEXT NOT NULL,
                        decidedAt TEXT
                    )""".trimIndent()
                )
            }
        }
    }
}
