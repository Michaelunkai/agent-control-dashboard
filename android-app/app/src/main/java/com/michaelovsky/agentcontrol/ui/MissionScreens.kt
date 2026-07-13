package com.michaelovsky.agentcontrol.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.michaelovsky.agentcontrol.bridge.LauncherBridge
import com.michaelovsky.agentcontrol.data.*
import com.michaelovsky.agentcontrol.domain.*
import com.michaelovsky.agentcontrol.sync.ConfigStore
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.launch

private val activeStatuses = setOf(TaskStatus.DISPATCHING, TaskStatus.IN_PROGRESS, TaskStatus.VERIFYING)
private val historyStatuses = setOf(TaskStatus.DONE, TaskStatus.CANCELLED)

@Composable
fun CommandScreen(
    tasks: List<TaskEntity>, agents: List<AgentEntity>, approvals: List<ApprovalEntity>,
    pendingSync: Int, configured: Boolean, syncStatus: String,
    onRefresh: () -> Unit, onTask: (String) -> Unit,
    onDecision: suspend (String, String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    val matching = tasks.filter { query.isBlank() || it.title.contains(query, true) || it.description.contains(query, true) }
    val attention = matching.filter(UiPolicy::needsAttention)
    val working = matching.filter { it.status in activeStatuses && it !in attention }
    val upcoming = matching.filter { it.status in setOf(TaskStatus.READY, TaskStatus.QUEUED, TaskStatus.INBOX) && it !in attention }
    val history = matching.filter { it.status in historyStatuses }.sortedByDescending { it.updatedAt }.take(5)
    val agentNames = agents.associate { it.id to it.name }
    val scope = rememberCoroutineScope()
    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        contentPadding = PaddingValues(top = 12.dp, bottom = 96.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Agent Control", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                    Text(syncLabel(configured, pendingSync, syncStatus), style = MaterialTheme.typography.labelMedium,
                        color = statusColor(if (configured && pendingSync == 0 && syncStatus == "success") "healthy" else "waiting"))
                }
                IconButton(onClick = onRefresh, enabled = configured, modifier = Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) {
                    Icon(Icons.Outlined.Refresh, "Synchronize now")
                }
            }
        }
        item {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(1.dp)) {
                SummaryCell("Working", working.size, "healthy", Modifier.weight(1f))
                SummaryCell("Waiting", tasks.count { it.status.name.startsWith("WAITING") }, "waiting", Modifier.weight(1f))
                SummaryCell("Attention", attention.size + approvals.size, "error", Modifier.weight(1f))
            }
        }
        item {
            OutlinedTextField(
                query, { query = it }, Modifier.fillMaxWidth(), singleLine = true,
                leadingIcon = { Icon(Icons.Outlined.Search, null) }, placeholder = { Text("Search tasks") }
            )
        }
        if (working.isNotEmpty()) {
            item { SectionTitle("Now working", working.size) }
            items(working, key = { it.id }) { MissionRow(it, agentNames[it.assignedAgentId], onTask) }
        }
        if (approvals.isNotEmpty() || attention.isNotEmpty()) {
            item { SectionTitle("Needs attention", attention.size + approvals.size) }
            items(approvals, key = { it.id }) { approval ->
                Surface(shape = RoundedCornerShape(6.dp), color = MaterialTheme.colorScheme.errorContainer) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Approval required", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
                        Text(approval.question, fontWeight = FontWeight.SemiBold)
                        Text(approval.risk, style = MaterialTheme.typography.bodySmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = { scope.launch { onDecision(approval.id, "rejected") } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Reject") }
                            Button(onClick = { scope.launch { onDecision(approval.id, "approved") } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Approve") }
                        }
                    }
                }
            }
            items(attention, key = { it.id }) { MissionRow(it, agentNames[it.assignedAgentId], onTask) }
        }
        if (upcoming.isNotEmpty()) {
            item { SectionTitle("Up next", upcoming.size) }
            items(upcoming, key = { it.id }) { MissionRow(it, agentNames[it.assignedAgentId], onTask) }
        }
        if (history.isNotEmpty()) {
            item { SectionTitle("Recent completions", history.size) }
            items(history, key = { it.id }) { MissionRow(it, agentNames[it.assignedAgentId], onTask) }
        }
        if (tasks.isEmpty()) item { EmptyState("No missions yet", "Create a mission now. It remains available offline.") }
        else if (matching.isEmpty()) item { EmptyState("No matching tasks", "Change the search text.") }
    }
}

@Composable
fun BoardScreen(tasks: List<TaskEntity>, onTask: (String) -> Unit) {
    var lane by remember { mutableStateOf("Working") }
    var query by remember { mutableStateOf("") }
    var newestFirst by remember { mutableStateOf(true) }
    val lanes = linkedMapOf(
        "Working" to tasks.filter { it.status in activeStatuses },
        "Attention" to tasks.filter(UiPolicy::needsAttention),
        "Queued" to tasks.filter { it.status in setOf(TaskStatus.INBOX, TaskStatus.READY, TaskStatus.QUEUED) },
        "Waiting" to tasks.filter { it.status.name.startsWith("WAITING") },
        "History" to tasks.filter { it.status in historyStatuses }
    )
    val visible = lanes.getValue(lane).filter { query.isBlank() || it.title.contains(query, true) }
        .let { if (newestFirst) it.sortedByDescending(TaskEntity::updatedAt) else it.sortedBy(TaskEntity::updatedAt) }
    Column(Modifier.fillMaxSize().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Text("Board", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            lanes.forEach { (name, values) ->
                FilterChip(selected = lane == name, onClick = { lane = name }, label = { Text("$name ${values.size}") }, modifier = Modifier.heightIn(min = 48.dp))
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(query, { query = it }, Modifier.weight(1f), singleLine = true, placeholder = { Text("Search lane") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
            TextButton(onClick = { newestFirst = !newestFirst }, modifier = Modifier.heightIn(min = 48.dp)) { Text(if (newestFirst) "Newest" else "Oldest") }
        }
        Spacer(Modifier.height(10.dp))
        if (visible.isEmpty()) EmptyState("No $lane missions", "Select another lane or create a mission.")
        else LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 96.dp)) {
            items(visible, key = { it.id }) { MissionRow(it, null, onTask) }
        }
    }
}

@Composable
fun AgentsScreen(agents: List<AgentEntity>, tasks: List<TaskEntity>) {
    val taskTitles = tasks.associate { it.id to it.title }
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 16.dp), contentPadding = PaddingValues(top = 12.dp, bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item { Text("Agents", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold) }
        if (agents.isEmpty()) item { EmptyState("No agents connected", "Executors appear after their first heartbeat.") }
        items(agents, key = { it.id }) { agent ->
            val fresh = UiPolicy.isAgentFresh(agent.lastHeartbeatAt)
            Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(6.dp), tonalElevation = 1.dp) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(agent.name, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                        Text(if (fresh) "Live" else "Stale", color = statusColor(if (fresh) "healthy" else "waiting"), style = MaterialTheme.typography.labelMedium)
                    }
                    Text(agent.kind.replace('_', ' '), style = MaterialTheme.typography.bodySmall)
                    Text(taskTitles[agent.currentTaskId] ?: "Idle", style = MaterialTheme.typography.bodyMedium)
                    Text("Heartbeat ${relativeAge(agent.lastHeartbeatAt)} · ${agent.capabilities}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
fun NewMissionScreen(onBack: () -> Unit, onCreate: suspend (String, String, Int, ExecutorKind) -> Unit) {
    var description by remember { mutableStateOf("") }
    var title by remember { mutableStateOf("") }
    var titlePinned by remember { mutableStateOf(false) }
    var priority by remember { mutableIntStateOf(3) }
    var executor by remember { mutableStateOf(ExecutorKind.WINDOWS) }
    val scope = rememberCoroutineScope()
    Scaffold(
        topBar = { ScreenTopBar("New mission", onBack) },
        bottomBar = {
            Surface(shadowElevation = 6.dp) {
                Button(
                    onClick = { scope.launch { onCreate(title, description.trim(), priority, executor) } },
                    enabled = description.trim().length >= 3,
                    modifier = Modifier.fillMaxWidth().navigationBarsPadding().imePadding().padding(12.dp).heightIn(min = 52.dp)
                ) { Text("Create and queue") }
            }
        }
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).imePadding().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedTextField(
                value = description,
                onValueChange = {
                    description = it
                    if (!titlePinned) title = TaskPolicy.createTitle(it)
                },
                modifier = Modifier.fillMaxWidth(),
                label = { Text("What should an agent do?") }, minLines = 5
            )
            OutlinedTextField(
                value = title,
                onValueChange = { title = it; titlePinned = true },
                modifier = Modifier.fillMaxWidth(), label = { Text("Mission title") },
                supportingText = { Text(if (titlePinned) "Custom title" else "Generated from request") }
            )
            Selector("Priority", listOf(1 to "Low", 3 to "Normal", 5 to "High"), priority) { priority = it }
            Selector("Open in", listOf(ExecutorKind.WINDOWS to "Codex Remote + Desktop"), executor) { executor = it }
            Spacer(Modifier.height(72.dp))
        }
    }
}

@Composable
private fun <T> Selector(label: String, options: List<Pair<T, String>>, selected: T, onSelect: (T) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEach { (value, text) -> FilterChip(selected == value, { onSelect(value) }, { Text(text) }, modifier = Modifier.heightIn(min = 48.dp)) }
        }
    }
}

@Composable
fun MissionDetailScreen(
    task: TaskEntity, events: List<TaskEventEntity>, agent: AgentEntity?, approvals: List<ApprovalEntity>,
    bridge: LauncherBridge, onBack: () -> Unit, onDispatch: suspend (ExecutorKind) -> Unit,
    onCancel: suspend () -> Unit, onDecision: suspend (String, String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var message by remember { mutableStateOf<String?>(null) }
    Scaffold(topBar = { ScreenTopBar("Mission detail", onBack) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(16.dp, 8.dp, 16.dp, 32.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            item {
                Text(task.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                Text(statusLabel(task.status), color = statusColor(statusTone(task)), style = MaterialTheme.typography.labelLarge)
            }
            item { Text(task.description, style = MaterialTheme.typography.bodyLarge) }
            task.currentStep?.let { step -> item { DetailBlock("Current activity", step) } }
            item { ProgressBlock(task) }
            item {
                DetailBlock("Assignment", agent?.name ?: if (task.assignedAgentId == null) "Unassigned" else "Assigned agent unavailable")
                DetailBlock("Priority", priorityLabel(task.priority))
                DetailBlock("Synchronization", syncStateLabel(task.syncState))
                DetailBlock("Created", task.createdAt)
                task.startedAt?.let { DetailBlock("Started", it) }
                task.completedAt?.let { DetailBlock("Completed", it) }
            }
            message?.let { item { Text(it, color = MaterialTheme.colorScheme.primary) } }
            if (approvals.isNotEmpty()) item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    approvals.forEach { approval ->
                        Text(approval.question, fontWeight = FontWeight.SemiBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton({ scope.launch { onDecision(approval.id, "rejected") } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Reject") }
                            Button({ scope.launch { onDecision(approval.id, "approved") } }, modifier = Modifier.heightIn(min = 48.dp)) { Text("Approve") }
                        }
                    }
                }
            }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (UiPolicy.canDispatch(task)) {
                        Button(onClick = {
                            scope.launch {
                                onDispatch(ExecutorKind.WINDOWS)
                                message = bridge.openCodexRemote().message
                            }
                        }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Start in Android Remote") }
                        OutlinedButton(onClick = { scope.launch { onDispatch(ExecutorKind.WINDOWS); message = "Queued for a new pinned Codex Desktop session" } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (task.status == TaskStatus.FAILED) "Retry in Codex Desktop" else "Start in Codex Desktop") }
                        TextButton(onClick = { scope.launch { onCancel() } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Stop and cancel") }
                    } else if (task.status !in historyStatuses) {
                        Text(
                            if (task.status == TaskStatus.QUEUED) "Waiting for an available executor" else "Mission is already running",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)
                        )
                        TextButton(onClick = { scope.launch { onCancel() } }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Stop and cancel") }
                    }
                }
            }
            item { SectionTitle("Activity", events.size) }
            if (events.isEmpty()) item { Text("No activity recorded yet", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            items(events, key = { it.id }) { event ->
                Row(Modifier.fillMaxWidth()) {
                    Box(Modifier.padding(top = 6.dp).size(8.dp).background(statusColor(if (event.type == "failed") "error" else "healthy"), RoundedCornerShape(4.dp)))
                    Column(Modifier.padding(start = 12.dp)) {
                        Text(event.message, style = MaterialTheme.typography.bodyMedium)
                        Text("${event.type.replace('_', ' ')} · ${event.createdAt}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(configStore: ConfigStore, onSaved: () -> Unit) {
    var apiUrl by remember { mutableStateOf(configStore.apiUrl) }
    var token by remember { mutableStateOf(configStore.ownerToken) }
    var saved by remember { mutableStateOf(configStore.isConfigured) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).imePadding(), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
        Text(if (saved) "Control plane connected" else "Offline mode is active", color = statusColor(if (saved) "healthy" else "waiting"))
        HorizontalDivider()
        Text("Connection", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        OutlinedTextField(apiUrl, { apiUrl = it; saved = false }, Modifier.fillMaxWidth(), label = { Text("HTTPS control-plane URL") }, singleLine = true)
        OutlinedTextField(token, { token = it; saved = false }, Modifier.fillMaxWidth(), label = { Text("Owner token") }, visualTransformation = PasswordVisualTransformation(), singleLine = true)
        Button(
            enabled = apiUrl.startsWith("https://") && token.isNotBlank(),
            onClick = { configStore.apiUrl = apiUrl.trimEnd('/'); configStore.ownerToken = token; saved = true; onSaved() },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
        ) { Text("Save and synchronize") }
        HorizontalDivider()
        DetailBlock("Local data", "Missions and queued changes remain available offline.")
        DetailBlock("Refresh", "Live views refresh while this app is visible. Background synchronization continues on the system schedule.")
        DetailBlock("Security", "Credentials are encrypted with Android Keystore.")
    }
}

@Composable
private fun MissionRow(task: TaskEntity, agentName: String?, onTask: (String) -> Unit) {
    val tone = statusTone(task)
    Surface(Modifier.fillMaxWidth().clickable { onTask(task.id) }, shape = RoundedCornerShape(6.dp), tonalElevation = 1.dp) {
        Row {
            Box(Modifier.width(4.dp).fillMaxHeight().defaultMinSize(minHeight = 96.dp).background(statusColor(tone)))
            Column(Modifier.weight(1f).padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(task.title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text(priorityLabel(task.priority), style = MaterialTheme.typography.labelSmall)
                }
                Text(task.currentStep ?: statusLabel(task.status), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                ProgressBlock(task)
                Text(listOfNotNull(agentName, relativeAge(task.updatedAt), syncStateLabel(task.syncState)).joinToString(" · "), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun ProgressBlock(task: TaskEntity) {
    when (val progress = UiPolicy.progress(task)) {
        ProgressPresentation.Hidden -> Unit
        ProgressPresentation.Indeterminate -> Column {
            LinearProgressIndicator(Modifier.fillMaxWidth())
            Text("Active - progress not reported", style = MaterialTheme.typography.labelSmall)
        }
        is ProgressPresentation.Determinate -> Column {
            LinearProgressIndicator({ progress.percent / 100f }, Modifier.fillMaxWidth())
            Text("${progress.percent}% complete", style = MaterialTheme.typography.labelSmall)
        }
    }
}

@Composable private fun SummaryCell(label: String, count: Int, tone: String, modifier: Modifier) {
    Column(modifier.background(MaterialTheme.colorScheme.surfaceVariant).padding(10.dp)) {
        Text(count.toString(), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, color = statusColor(tone))
        Text(label, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable private fun SectionTitle(title: String, count: Int) { Row(verticalAlignment = Alignment.CenterVertically) { Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text(count.toString(), style = MaterialTheme.typography.labelMedium) } }
@Composable private fun DetailBlock(label: String, value: String) { Column(Modifier.padding(vertical = 4.dp)) { Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant); Text(value, style = MaterialTheme.typography.bodyMedium) } }
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ScreenTopBar(title: String, onBack: () -> Unit) { TopAppBar(title = { Text(title) }, navigationIcon = { IconButton(onBack, Modifier.sizeIn(minWidth = 48.dp, minHeight = 48.dp)) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back") } }) }
@Composable private fun EmptyState(title: String, message: String) { Column(Modifier.fillMaxWidth().padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold); Spacer(Modifier.height(6.dp)); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant) } }

internal fun syncLabel(configured: Boolean, pending: Int, status: String) = when { !configured -> "Offline mode - configure synchronization in Settings"; status == "offline" -> "Saved offline - reconnect to synchronize"; pending > 0 -> "$pending change${if (pending == 1) "" else "s"} waiting to sync"; status == "success" -> "Everything synchronized"; status == "syncing" -> "Synchronizing"; status == "error" -> "Synchronization needs attention"; else -> "Synchronization pending" }
private fun syncStateLabel(value: String) = when (value) { "synced" -> "Synchronized"; "conflict" -> "Conflict needs review"; else -> "Saved offline · sync pending" }
private fun statusLabel(status: TaskStatus) = status.name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }
private fun priorityLabel(priority: Int) = when (priority) { 1, 2 -> "Low"; 4, 5 -> "High"; else -> "Normal" }
private fun statusTone(task: TaskEntity) = when { UiPolicy.needsAttention(task) -> "error"; task.status in activeStatuses -> "healthy"; task.status == TaskStatus.DONE -> "done"; task.status.name.startsWith("WAITING") -> "waiting"; else -> "queued" }
@Composable private fun statusColor(tone: String): Color = when (tone) { "healthy" -> MaterialTheme.colorScheme.primary; "queued" -> MaterialTheme.colorScheme.secondary; "waiting" -> MaterialTheme.colorScheme.tertiary; "error" -> MaterialTheme.colorScheme.error; "done" -> Color(0xFF2E7D32); else -> MaterialTheme.colorScheme.onSurfaceVariant }
private fun relativeAge(value: String): String = runCatching { val seconds = Duration.between(Instant.parse(value), Instant.now()).seconds.coerceAtLeast(0); when { seconds < 60 -> "now"; seconds < 3600 -> "${seconds / 60}m ago"; seconds < 86400 -> "${seconds / 3600}h ago"; else -> "${seconds / 86400}d ago" } }.getOrDefault(value)
