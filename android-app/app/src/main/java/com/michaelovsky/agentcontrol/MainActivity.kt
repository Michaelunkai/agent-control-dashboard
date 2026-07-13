package com.michaelovsky.agentcontrol

import android.os.Bundle
import androidx.lifecycle.lifecycleScope
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.michaelovsky.agentcontrol.data.AgentControlDatabase
import com.michaelovsky.agentcontrol.data.TaskRepository
import com.michaelovsky.agentcontrol.ui.AgentControlApp
import com.michaelovsky.agentcontrol.ui.AgentControlTheme
import com.michaelovsky.agentcontrol.sync.ConfigStore
import com.michaelovsky.agentcontrol.sync.SyncWorker
import com.michaelovsky.agentcontrol.bridge.LauncherBridge
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private lateinit var configStore: ConfigStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repository = TaskRepository(AgentControlDatabase.get(this)) { SyncWorker.enqueueNow(this) }
        configStore = ConfigStore(this)
        setContent {
            AgentControlTheme {
                AgentControlApp(repository, configStore, LauncherBridge(this))
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (configStore.isConfigured) {
            lifecycleScope.launch { SyncWorker.enqueueNow(this@MainActivity) }
        }
    }
}
