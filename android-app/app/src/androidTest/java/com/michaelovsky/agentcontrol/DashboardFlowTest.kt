package com.michaelovsky.agentcontrol

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import org.junit.Rule
import org.junit.Test

class DashboardFlowTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    @Test
    fun createsAndOpensAnOfflineTask() {
        val title = "Verify offline Android dashboard ${System.currentTimeMillis()}"
        compose.onNodeWithText("Agent Control").assertIsDisplayed()
        compose.onNodeWithText("Offline mode - configure synchronization in Settings").assertIsDisplayed()
        compose.onNodeWithContentDescription("Add task").performClick()
        compose.onNodeWithText("What should an agent do?").performTextInput(title)
        compose.onNodeWithText("Create and queue").performClick()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(title).assertIsDisplayed().performClick()
        compose.onNodeWithText("Start on this phone").assertIsDisplayed()
        compose.onNodeWithText("Queue for Windows Codex").assertIsDisplayed()
        compose.onNodeWithText("Close").performClick()
        compose.onNodeWithText("Search tasks").performTextInput("not present")
        compose.onNodeWithText("No matching tasks").assertIsDisplayed()
    }
}
