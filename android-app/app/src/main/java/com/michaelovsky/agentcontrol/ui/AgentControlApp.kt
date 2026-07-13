package com.michaelovsky.agentcontrol.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.ViewKanban
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.michaelovsky.agentcontrol.data.TaskEntity
import com.michaelovsky.agentcontrol.data.AgentEntity
import com.michaelovsky.agentcontrol.data.ApprovalEntity
import com.michaelovsky.agentcontrol.data.TaskRepository
import com.michaelovsky.agentcontrol.domain.ExecutorKind
import com.michaelovsky.agentcontrol.bridge.LauncherBridge
import com.michaelovsky.agentcontrol.domain.TaskStatus
import com.michaelovsky.agentcontrol.sync.ConfigStore
import com.michaelovsky.agentcontrol.sync.SyncWorker
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.launch

private enum class Screen { COMMAND, BOARD, AGENTS, SETTINGS }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgentControlApp(repository: TaskRepository, configStore: ConfigStore, bridge: LauncherBridge) {
    val tasks by repository.observeTasks().collectAsStateWithLifecycle(initialValue = emptyList())
    val agents by repository.observeAgents().collectAsStateWithLifecycle(initialValue = emptyList())
    val approvals by repository.observeApprovals().collectAsStateWithLifecycle(initialValue = emptyList())
    val pendingSync by repository.observePendingSyncCount().collectAsStateWithLifecycle(initialValue = 0)
    val syncStatus by configStore.observeSyncStatus().collectAsStateWithLifecycle(initialValue = configStore.syncStatus)
    val context = LocalContext.current
    var screen by remember { mutableStateOf(Screen.COMMAND) }
    var adding by remember { mutableStateOf(false) }
    var selected by remember { mutableStateOf<TaskEntity?>(null) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                val items = listOf(
                    Triple(Screen.COMMAND, "Command", Icons.Outlined.Dashboard),
                    Triple(Screen.BOARD, "Board", Icons.Outlined.ViewKanban),
                    Triple(Screen.AGENTS, "Agents", Icons.Outlined.Dns),
                    Triple(Screen.SETTINGS, "Settings", Icons.Outlined.Settings)
                )
                items.forEach { (target, label, icon) ->
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
                FloatingActionButton(onClick = { adding = true }) {
                    Icon(Icons.Outlined.Add, contentDescription = "Add task")
                }
            }
        }
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when (screen) {
                Screen.COMMAND -> CommandCenter(
                    tasks = tasks,
                    approvals = approvals,
                    pendingSync = pendingSync,
                    configured = configStore.isConfigured,
                    syncStatus = syncStatus,
                    onTask = { selected = it },
                    onDecision = { id, decision -> repository.decideApproval(id, decision) },
                    onRefresh = { SyncWorker.enqueueNow(context) }
                )
                Screen.BOARD -> Board(tasks) { selected = it }
                Screen.AGENTS -> AgentsScreen(agents)
                Screen.SETTINGS -> SettingsScreen(configStore)
            }
            if (adding) AddTaskSheet(onDismiss = { adding = false }, onCreate = { description, priority ->
                repository.createTask(description, priority)
                adding = false
            })
            selected?.let { task ->
                TaskDetail(
                    task = task,
                    bridge = bridge,
                    onDismiss = { selected = null },
                    onDispatch = { executor ->
                        repository.dispatch(task.id, executor)
                        selected = null
                    },
                    onCancel = {
                        repository.cancel(task.id)
                        selected = null
                    }
                )
            }
        }
    }
}

@Composable
private fun SettingsScreen(configStore: ConfigStore) {
    var apiUrl by remember { mutableStateOf(configStore.apiUrl) }
    var token by remember { mutableStateOf(configStore.ownerToken) }
    var saved by remember { mutableStateOf(configStore.isConfigured) }
    val context = LocalContext.current
    Column(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(
            if (saved) "Control plane configured" else "Offline mode is active until a control plane is configured",
            color = if (saved) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.tertiary
        )
        TextField(
            value = apiUrl,
            onValueChange = { apiUrl = it; saved = false },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("HTTPS control-plane URL") },
            singleLine = true
        )
        TextField(
            value = token,
            onValueChange = { token = it; saved = false },
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Owner token") },
            visualTransformation = PasswordVisualTransformation(),
            singleLine = true
        )
        Button(
            enabled = apiUrl.startsWith("https://") && token.isNotBlank(),
            onClick = {
                configStore.apiUrl = apiUrl
                configStore.ownerToken = token
                saved = true
                SyncWorker.enqueueNow(context)
            }
        ) { Text("Save and synchronize") }
        Text(
            "Credentials are encrypted by Android Keystore. The app synchronizes over cellular or Wi-Fi and keeps local tasks available without either.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun CommandCenter(
    tasks: List<TaskEntity>,
    approvals: List<ApprovalEntity>,
    pendingSync: Int,
    configured: Boolean,
    syncStatus: String,
    onTask: (TaskEntity) -> Unit,
    onDecision: suspend (String, String) -> Unit,
    onRefresh: () -> Unit
) {
    var query by remember { mutableStateOf("") }
    var filter by remember { mutableStateOf("All") }
    val active = tasks.count { it.status == TaskStatus.IN_PROGRESS || it.status == TaskStatus.DISPATCHING }
    val waiting = tasks.count { it.status.name.startsWith("WAITING") || it.status == TaskStatus.BLOCKED }
    val visibleTasks = tasks.filter { task ->
        val matchesQuery = query.isBlank() ||
            task.title.contains(query, ignoreCase = true) ||
            task.description.contains(query, ignoreCase = true)
        val matchesFilter = when (filter) {
            "Active" -> task.status == TaskStatus.IN_PROGRESS || task.status == TaskStatus.DISPATCHING
            "Waiting" -> task.status.name.startsWith("WAITING") || task.status == TaskStatus.BLOCKED
            "Done" -> task.status == TaskStatus.DONE
            else -> true
        }
        matchesQuery && matchesFilter
    }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Agent Control", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                Text(
                    when {
                        !configured -> "Offline mode - configure synchronization in Settings"
                        pendingSync > 0 -> "$pendingSync change${if (pendingSync == 1) "" else "s"} waiting to sync"
                        syncStatus == "success" -> "Everything synchronized"
                        syncStatus == "syncing" -> "Synchronizing..."
                        syncStatus == "error" -> "Synchronization needs attention"
                        else -> "Synchronization pending"
                    },
                    color = if (configured && pendingSync == 0 && syncStatus == "success") {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.tertiary
                    }
                )
            }
            IconButton(onClick = onRefresh, enabled = configured) {
                Icon(Icons.Outlined.Refresh, contentDescription = "Synchronize now")
            }
        }
        Spacer(Modifier.height(18.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Metric("In work", active, Modifier.weight(1f))
            Metric("Waiting", waiting, Modifier.weight(1f))
            Metric("Total", tasks.size, Modifier.weight(1f))
        }
        Spacer(Modifier.height(20.dp))
        if (approvals.isNotEmpty()) {
            Text("Approvals", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            approvals.take(3).forEach { approval ->
                Card(Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(approval.question, fontWeight = FontWeight.SemiBold)
                        Text(approval.risk, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { scope.launch { onDecision(approval.id, "rejected") } }) {
                                Text("Reject")
                            }
                            Button(onClick = { scope.launch { onDecision(approval.id, "approved") } }) {
                                Text("Approve")
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(18.dp))
        }
        Text("Priority queue", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth(),
            leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
            placeholder = { Text("Search tasks") },
            singleLine = true
        )
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            listOf("All", "Active", "Waiting", "Done").forEach { option ->
                FilterChip(
                    selected = filter == option,
                    onClick = { filter = option },
                    label = { Text(option) }
                )
            }
        }
        if (tasks.isEmpty()) EmptyState("No tasks yet", "Create a task now. It remains available even when the phone is offline.")
        else if (visibleTasks.isEmpty()) EmptyState("No matching tasks", "Change the search or status filter.")
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(visibleTasks.take(50), key = { it.id }) { TaskRow(it, onTask) }
        }
    }
}

@Composable
private fun Metric(label: String, value: Int, modifier: Modifier) {
    Card(modifier) {
        Column(Modifier.padding(14.dp)) {
            Text(value.toString(), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
private fun Board(tasks: List<TaskEntity>, onTask: (TaskEntity) -> Unit) {
    val groups = listOf(
        "Ready" to tasks.filter { it.status == TaskStatus.READY || it.status == TaskStatus.QUEUED },
        "In work" to tasks.filter { it.status == TaskStatus.IN_PROGRESS || it.status == TaskStatus.DISPATCHING },
        "Waiting" to tasks.filter { it.status.name.startsWith("WAITING") || it.status == TaskStatus.BLOCKED },
        "Review" to tasks.filter { it.status == TaskStatus.VERIFYING || it.status == TaskStatus.REVIEW },
        "Done" to tasks.filter { it.status == TaskStatus.DONE }
    )
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item { Text("Task board", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        groups.forEach { (name, items) ->
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.weight(1f))
                    Badge { Text(items.size.toString()) }
                }
            }
            items(items, key = { it.id }) { TaskRow(it, onTask) }
        }
    }
}

@Composable
private fun TaskRow(task: TaskEntity, onClick: (TaskEntity) -> Unit) {
    Card(Modifier.fillMaxWidth().clickable { onClick(task) }) {
        Column(Modifier.padding(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(task.title, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                Text("P${task.priority}", style = MaterialTheme.typography.labelMedium)
            }
            Spacer(Modifier.height(5.dp))
            Text(task.status.name.replace('_', ' '), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary)
            Text(task.description, maxLines = 2, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                when (task.syncState) {
                    "synced" -> "Synchronized"
                    "conflict" -> "Server changed this task; review required"
                    else -> "Saved offline; synchronization pending"
                },
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}

@Composable
private fun AgentsScreen(agents: List<AgentEntity>) {
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 18.dp, vertical = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        item { Text("Agents", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        if (agents.isEmpty()) {
            item { EmptyState("No agents connected", "Registered executors appear after their first heartbeat.") }
        } else {
            items(agents, key = { it.id }) { agent ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(14.dp)) {
                        Row {
                            Text(agent.name, Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
                            Text(agent.availability.replace('_', ' '))
                        }
                        Text("${agent.kind} · ${agent.capabilities}", style = MaterialTheme.typography.bodySmall)
                        agent.currentTaskId?.let { Text("Working on $it", style = MaterialTheme.typography.labelSmall) }
                    }
                }
            }
        }
    }
}

@Composable
private fun TaskDetail(
    task: TaskEntity,
    bridge: LauncherBridge,
    onDismiss: () -> Unit,
    onDispatch: suspend (ExecutorKind) -> Unit,
    onCancel: suspend () -> Unit
) {
    val scope = rememberCoroutineScope()
    var bridgeMessage by remember { mutableStateOf<String?>(null) }
    Card(Modifier.fillMaxSize().padding(12.dp)) {
        Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Task", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("Close") }
            }
            Text(task.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(task.description)
            Text("${task.status.name.replace('_', ' ')} · Priority ${task.priority} · v${task.version}")
            bridgeMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            Button(
                enabled = task.status != TaskStatus.DONE && task.status != TaskStatus.CANCELLED,
                onClick = {
                    bridge.continueTask(task.id, task.description) {
                        bridgeMessage = if (it.accepted) "Started on this Android device" else it.message
                    }
                }
            ) { Text("Start on this phone") }
            Button(onClick = { scope.launch { onDispatch(ExecutorKind.WINDOWS) } }) {
                Text("Queue for Windows Codex")
            }
            Button(onClick = { scope.launch { onDispatch(ExecutorKind.CLOUD) } }) {
                Text("Queue for cloud agent")
            }
            TextButton(
                enabled = task.status != TaskStatus.DONE && task.status != TaskStatus.CANCELLED,
                onClick = {
                    bridge.stop { bridgeMessage = it.message }
                    scope.launch { onCancel() }
                }
            ) { Text("Stop and cancel") }
        }
    }
}

@Composable
private fun AddTaskSheet(
    onDismiss: () -> Unit,
    onCreate: suspend (String, Int) -> Unit
) {
    var description by remember { mutableStateOf("") }
    var priority by remember { mutableIntStateOf(3) }
    val scope = rememberCoroutineScope()
    Card(Modifier.fillMaxWidth().padding(12.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("New task", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TextField(
                value = description,
                onValueChange = { description = it },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("What should an agent do?") },
                minLines = 3
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Priority $priority")
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { priority = (priority - 1).coerceAtLeast(1) }) { Text("-") }
                TextButton(onClick = { priority = (priority + 1).coerceAtMost(5) }) { Text("+") }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TextButton(onClick = onDismiss) { Text("Cancel") }
                Button(
                    enabled = description.trim().length >= 3,
                    onClick = { scope.launch { onCreate(description.trim(), priority) } }
                ) { Text("Create and queue") }
            }
        }
    }
}

@Composable
private fun EmptyState(title: String, message: String) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Spacer(Modifier.height(6.dp))
        Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
