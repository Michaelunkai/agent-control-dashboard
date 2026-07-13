package com.michaelovsky.agentcontrol.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.Shapes
import androidx.compose.runtime.Composable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle

private val colors = lightColorScheme(
    primary = Color(0xFF0B6B50),
    onPrimary = Color.White,
    secondary = Color(0xFF3D5A80),
    secondaryContainer = Color(0xFFDCE6F2),
    onSecondaryContainer = Color(0xFF23354D),
    tertiary = Color(0xFFA14D2A),
    tertiaryContainer = Color(0xFFF3DED4),
    background = Color(0xFFF6F7F9),
    surface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFFE8EBEF),
    error = Color(0xFFB42318)
)

private val darkColors = darkColorScheme(
    primary = Color(0xFF63D5AE),
    secondary = Color(0xFFAFC7E8),
    tertiary = Color(0xFFFFB596),
    background = Color(0xFF111416),
    surface = Color(0xFF191C1E),
    surfaceVariant = Color(0xFF303437),
    error = Color(0xFFFFB4AB)
)

private val shapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp)
)

private val typography = Typography(
    headlineMedium = TextStyle(fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = 0.sp),
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, letterSpacing = 0.sp),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = 0.sp),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 23.sp, letterSpacing = 0.sp),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 21.sp, letterSpacing = 0.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 19.sp, letterSpacing = 0.sp),
    labelLarge = TextStyle(fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.sp),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 18.sp, letterSpacing = 0.sp),
    labelSmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp, letterSpacing = 0.sp)
)

@Composable
fun AgentControlTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) darkColors else colors,
        shapes = shapes,
        typography = typography,
        content = content
    )
}
