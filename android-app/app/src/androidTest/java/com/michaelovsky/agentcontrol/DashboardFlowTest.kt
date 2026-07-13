package com.michaelovsky.agentcontrol

import android.view.inputmethod.InputMethodManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
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
        compose.onNodeWithContentDescription("Add task").performClick()
        compose.onNodeWithText("What should an agent do?").performTextInput(title)
        compose.onNodeWithText("Create and queue").performClick()
        compose.activityRule.scenario.recreate()
        compose.waitUntil(5_000) { compose.onAllNodesWithText(title).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText(title).performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Waiting for an available executor").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Stop and cancel").performScrollTo().assertIsDisplayed()
        compose.onNodeWithContentDescription("Back").performClick()
        compose.onNodeWithText("Search tasks").performTextInput("not present")
        compose.onNodeWithText("No matching tasks").assertIsDisplayed()
    }

    @Test
    fun newMissionShowsGeneratedTitleAndExplicitSchedulingControls() {
        compose.onNodeWithContentDescription("Add task").performClick()
        compose.onNodeWithText("What should an agent do?").performTextInput("Please verify Android release signing")
        compose.onNodeWithText("Verify Android release signing").assertIsDisplayed()
        compose.onNodeWithText("Mission title").assertIsDisplayed()
        compose.activityRule.scenario.onActivity { activity ->
            activity.getSystemService(InputMethodManager::class.java)
                .hideSoftInputFromWindow(activity.currentFocus?.windowToken, 0)
        }
        compose.waitForIdle()
        compose.onNodeWithText("Normal").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Codex Remote + Desktop").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Create and queue").assertIsDisplayed()
    }
}
