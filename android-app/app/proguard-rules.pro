-keep class com.michaelovsky.agentcontrol.data.AgentControlDatabase_Impl { *; }

# WorkManager creates workers through this exact Java constructor in release
# builds. Keep the signature available after R8 shrinking.
-keepclassmembers class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# Compose 1.6 and Lifecycle 2.8 expose lifecycle owners from different
# composition-local packages. Prevent R8 class merging from collapsing the
# owner providers into a local that is not installed by ComponentActivity.
-keep class androidx.lifecycle.compose.LocalLifecycleOwnerKt { *; }
-keep class androidx.lifecycle.compose.LocalLifecycleOwnerKt$* { *; }
-keep class androidx.compose.ui.platform.AndroidCompositionLocals_androidKt { *; }
-keep class androidx.compose.ui.platform.AndroidCompositionLocals_androidKt$* { *; }
