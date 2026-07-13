package com.michaelovsky.agentcontrol.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.michaelovsky.agentcontrol.bridge.LauncherBridge
import com.michaelovsky.agentcontrol.data.TaskRepository
import com.michaelovsky.agentcontrol.domain.ExecutorKind
import com.michaelovsky.agentcontrol.sync.ConfigStore
import com.michaelovsky.agentcontrol.sync.SyncWorker
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay

private enum class Screen { COMMAND, BOARD, AGENTS, SETTINGS, NEW_MISSION, DETAIL }
internal const val FOREGROUND_REFRESH_MILLIS = 3_000L

@Composable
fun AgentControlApp(repository: TaskRepository, configStore: ConfigStore, bridge: LauncherBridge) {
    val tasks by repository.observeTasks().collectAsStateWithLifecycle(emptyList())
    val agents by repository.observeAgents().collectAsStateWithLifecycle(emptyList())
    val approvals by repository.observeApprovals().collectAsStateWithLifecycle(emptyList())
    val pendingSync by repository.observePendingSyncCount().collectAsStateWithLifecycle(0)
    val syncStatus by configStore.observeSyncStatus().collectAsStateWithLifecycle(configStore.syncStatus)
    val context = LocalContext.current
    val networkAvailable = rememberNetworkAvailable(context)
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var screen by remember { mutableStateOf(Screen.COMMAND) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    val selected = tasks.firstOrNull { it.id == selectedId }

    LaunchedEffect(lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) {
                if (configStore.isConfigured) SyncWorker.enqueueNow(context)
                delay(FOREGROUND_REFRESH_MILLIS)
            }
        }
    }

    val primaryScreen = screen in setOf(Screen.COMMAND, Screen.BOARD, Screen.AGENTS, Screen.SETTINGS)
    Scaffold(
        bottomBar = {
            if (primaryScreen) NavigationBar {
                listOf(
                    Triple(Screen.COMMAND, "Command", Icons.Outlined.Dashboard),
                    Triple(Screen.BOARD, "Board", Icons.Outlined.ViewKanban),
                    Triple(Screen.AGENTS, "Agents", Icons.Outlined.Dns),
                    Triple(Screen.SETTINGS, "Settings", Icons.Outlined.Settings)
                ).forEach { (target, label, icon) ->
                    NavigationBarItem(
                        selected = screen == target,
                        onClick = { screen = target },
                        icon = { Icon(icon, contentDescription = label) },
                        label = { Text(label) }
                    )
                }
            }
        },
        floatingActionButton = {
            if (screen == Screen.COMMAND || screen == Screen.BOARD) {
                FloatingActionButton(onClick = { screen = Screen.NEW_MISSION }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Add task")
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (screen) {
                Screen.COMMAND -> CommandScreen(
                    tasks, agents, approvals, pendingSync, configStore.isConfigured,
                    if (networkAvailable) syncStatus else "offline",
                    onRefresh = { SyncWorker.enqueueNow(context) },
                    onTask = { selectedId = it; screen = Screen.DETAIL },
                    onDecision = repository::decideApproval
                )
                Screen.BOARD -> BoardScreen(tasks) { selectedId = it; screen = Screen.DETAIL }
                Screen.AGENTS -> AgentsScreen(agents, tasks)
                Screen.SETTINGS -> SettingsScreen(configStore) { SyncWorker.enqueueNow(context) }
                Screen.NEW_MISSION -> NewMissionScreen(
                    onBack = { screen = Screen.COMMAND },
                    onCreate = { title, description, priority, executor ->
                        repository.createTask(title, description, priority, executor)
                        screen = Screen.COMMAND
                    }
                )
                Screen.DETAIL -> selected?.let { task ->
                    val events by repository.observeTaskEvents(task.id).collectAsStateWithLifecycle(emptyList())
                    MissionDetailScreen(
                        task = task,
                        events = events,
                        agent = agents.firstOrNull { it.id == task.assignedAgentId },
                        approvals = approvals.filter { it.taskId == task.id },
                        bridge = bridge,
                        onBack = { screen = Screen.COMMAND },
                        onDispatch = { repository.dispatch(task.id, it) },
                        onCancel = { repository.cancel(task.id) },
                        onDecision = repository::decideApproval
                    )
                } ?: LaunchedEffect(Unit) { screen = Screen.COMMAND }
            }
        }
    }
}

@Composable
private fun rememberNetworkAvailable(context: Context): Boolean {
    val manager = remember(context) { context.getSystemService(ConnectivityManager::class.java) }
    fun connected(): Boolean = manager.getNetworkCapabilities(manager.activeNetwork)
        ?.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) == true
    var available by remember { mutableStateOf(connected()) }
    DisposableEffect(manager) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) { available = connected() }
            override fun onLost(network: Network) { available = connected() }
            override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                available = connected()
            }
        }
        manager.registerDefaultNetworkCallback(callback)
        onDispose { manager.unregisterNetworkCallback(callback) }
    }
    return available
}
