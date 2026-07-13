package com.michaelovsky.agentcontrol.sync

import android.app.Application
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class SyncPayloadMapperTest {
    @Test
    fun olderPayloadWithoutActivityFieldsRemainsValid() {
        val payload = """{"cursor":2,"tasks":[{"id":"t1","title":"Old task","description":"old server","status":"READY","priority":3,"version":1,"createdAt":"2026-07-12T00:00:00Z","updatedAt":"2026-07-12T00:00:00Z"}]}"""
        val result = SyncPayloadMapper.parse(payload)
        assertEquals(2, result.cursor)
        assertNull(result.tasks.single().progressPercent)
        assertNull(result.tasks.single().currentStep)
        assertEquals(emptyList<Any>(), result.events)
    }

    @Test
    fun activityFieldsAndEventsAreMapped() {
        val payload = """{"cursor":8,"tasks":[{"id":"t1","title":"Build release","description":"verify","status":"IN_PROGRESS","priority":5,"version":4,"createdAt":"2026-07-12T00:00:00Z","updatedAt":"2026-07-12T01:00:00Z","progressPercent":40,"currentStep":"Running tests","startedAt":"2026-07-12T00:10:00Z"}],"events":[{"id":"e1","taskId":"t1","type":"progress","sequence":8,"occurredAt":"2026-07-12T01:00:00Z","idempotencyKey":"progress-8","payload":{"currentStep":"Running tests","progressPercent":40}}]}"""
        val result = SyncPayloadMapper.parse(payload)
        assertEquals(40, result.tasks.single().progressPercent)
        assertEquals("Running tests", result.tasks.single().currentStep)
        assertEquals("progress", result.events.single().type)
        assertEquals(40, result.events.single().progressPercent)
    }

    @Test
    fun statusAndEvidenceEventsHaveReadableMessages() {
        val payload = """{"cursor":9,"tasks":[],"events":[{"id":"e1","taskId":"t1","type":"status_changed","sequence":8,"occurredAt":"2026-07-12T01:00:00Z","idempotencyKey":"status-8","payload":{"from":"QUEUED","to":"IN_PROGRESS","reason":"claimed:desktop"}},{"id":"e2","taskId":"t1","type":"evidence_added","sequence":9,"occurredAt":"2026-07-12T01:01:00Z","idempotencyKey":"evidence-9","payload":{"kind":"test","summary":"Release tests passed"}}]}"""
        val events = SyncPayloadMapper.parse(payload).events
        assertEquals("In progress - claimed by desktop", events.first().message)
        assertEquals("Release tests passed", events.last().message)
    }
}
