package com.michaelovsky.agentcontrol.bridge

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter

data class BridgeResult(val accepted: Boolean, val message: String)

class LauncherBridge(private val context: Context) {
    fun continueTask(taskId: String, request: String, callback: (BridgeResult) -> Unit) {
        send("continue", taskId, request, callback)
    }

    fun stop(callback: (BridgeResult) -> Unit) {
        send("stop", "", "", callback)
    }

    private fun send(
        operation: String,
        taskId: String,
        request: String,
        callback: (BridgeResult) -> Unit
    ) {
        val intent = Intent(ACTION_TASK)
            .setPackage(LAUNCHER_PACKAGE)
            .putExtra("operation", operation)
            .putExtra("taskId", taskId)
            .putExtra("request", request)
        context.sendOrderedBroadcast(
            intent,
            BRIDGE_PERMISSION,
            object : BroadcastReceiver() {
                override fun onReceive(receiverContext: Context?, receiverIntent: Intent?) {
                    callback(BridgeResult(resultCode == Activity.RESULT_OK, resultData.orEmpty()))
                }
            },
            null,
            Activity.RESULT_CANCELED,
            "bridge_unavailable",
            null
        )
    }

    companion object {
        const val LAUNCHER_PACKAGE = "com.michaelovsky.codexapplauncher"
        const val ACTION_TASK = "$LAUNCHER_PACKAGE.DASHBOARD_TASK"
        const val BRIDGE_PERMISSION = "$LAUNCHER_PACKAGE.permission.DASHBOARD_BRIDGE"
    }
}
