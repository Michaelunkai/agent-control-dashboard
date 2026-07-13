package com.michaelovsky.agentcontrol.sync

import android.content.Context
import androidx.work.WorkerParameters
import java.lang.reflect.Modifier
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncWorkerConstructorTest {
    @Test
    fun exposesTheConstructorRequiredByWorkManager() {
        val constructor = SyncWorker::class.java.getDeclaredConstructor(
            Context::class.java,
            WorkerParameters::class.java
        )

        assertTrue(Modifier.isPublic(constructor.modifiers))
    }
}
