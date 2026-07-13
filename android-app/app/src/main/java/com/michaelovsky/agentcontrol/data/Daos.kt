package com.michaelovsky.agentcontrol.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface TaskDao {
    @Query("SELECT * FROM tasks ORDER BY CASE status WHEN 'IN_PROGRESS' THEN 0 WHEN 'WAITING_APPROVAL' THEN 1 WHEN 'READY' THEN 2 ELSE 3 END, priority DESC, updatedAt DESC")
    fun observeAll(): Flow<List<TaskEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(task: TaskEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(tasks: List<TaskEntity>)

    @Query("SELECT * FROM tasks WHERE id = :id")
    suspend fun get(id: String): TaskEntity?

    @Query("UPDATE tasks SET syncState = 'synced' WHERE id = :id")
    suspend fun markSynced(id: String)

    @Query("UPDATE tasks SET syncState = 'conflict' WHERE id = :id")
    suspend fun markConflict(id: String)
}

@Dao
interface OutboxDao {
    @Query("SELECT COUNT(*) FROM outbox")
    fun observePendingCount(): Flow<Int>

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(item: OutboxEntity)

    @Query("SELECT * FROM outbox ORDER BY createdAt LIMIT :limit")
    suspend fun pending(limit: Int): List<OutboxEntity>

    @Query("DELETE FROM outbox WHERE id = :id")
    suspend fun remove(id: String)

    @Query("UPDATE outbox SET attempts = attempts + 1, lastError = :error WHERE id = :id")
    suspend fun recordFailure(id: String, error: String)
}

@Dao
interface AgentDao {
    @Query("SELECT * FROM agents ORDER BY availability DESC, name")
    fun observeAll(): Flow<List<AgentEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(agents: List<AgentEntity>)
}

@Dao
interface ApprovalDao {
    @Query("SELECT * FROM approvals WHERE status = 'pending' ORDER BY createdAt")
    fun observePending(): Flow<List<ApprovalEntity>>

    @Query("SELECT * FROM approvals WHERE id = :id")
    suspend fun get(id: String): ApprovalEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(approval: ApprovalEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(approvals: List<ApprovalEntity>)
}
