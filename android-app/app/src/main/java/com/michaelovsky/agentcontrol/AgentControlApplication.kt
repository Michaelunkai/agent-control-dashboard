package com.michaelovsky.agentcontrol

import android.app.Application
import com.michaelovsky.agentcontrol.sync.SyncWorker

class AgentControlApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        SyncWorker.schedule(this)
    }
}
