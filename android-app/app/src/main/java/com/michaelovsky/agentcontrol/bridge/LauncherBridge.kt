package com.michaelovsky.agentcontrol.bridge

import android.content.Context
import android.content.Intent
import android.net.Uri

data class BridgeResult(val accepted: Boolean, val message: String)

class LauncherBridge(private val context: Context) {
    fun openCodexRemote(): BridgeResult {
        val remoteIntent = Intent(Intent.ACTION_VIEW, Uri.parse(CODEX_REMOTE_URI)).apply {
            setPackage(CHATGPT_PACKAGE)
        }
        val intent = if (remoteIntent.resolveActivity(context.packageManager) != null) {
            remoteIntent
        } else {
            context.packageManager.getLaunchIntentForPackage(CHATGPT_PACKAGE)
                ?: return BridgeResult(false, "Install or update the ChatGPT app to use Codex Remote")
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        return runCatching {
            context.startActivity(intent)
            BridgeResult(true, "Opening Codex Remote. The pinned session appears when Windows claims it.")
        }.getOrElse { BridgeResult(false, "Unable to open Codex Remote") }
    }

    companion object {
        const val CHATGPT_PACKAGE = "com.openai.chatgpt"
        const val CODEX_REMOTE_URI = "com.openai.chat://codex/open"
    }
}
