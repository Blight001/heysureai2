package ai.heysure.agent.executor

import ai.heysure.agent.accessibility.GestureAccessibilityService
import ai.heysure.agent.capture.ScreenCaptureManager
import android.accessibilityservice.AccessibilityService
import android.graphics.Path
import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android endpoint's tool surface: tap / swipe / back-home-recents /
 * screenshot / record / type. Mirrors the desktop catalog's role — it both
 * advertises self-described schemas to the server and executes dispatched tasks.
 *
 * `screen.capture` returns a `dataUrl`, which the server's screenshot pipeline
 * auto-persists and forwards to the user (see device_dispatch `_SCREENSHOT_TOOLS`).
 */
class ToolCatalog(private val capture: ScreenCaptureManager) {

    private val tools: Map<String, Tool> = buildList {
        add(tapTool())
        add(longPressTool())
        add(swipeTool())
        add(globalActionTool("touch.back", "返回上一页（系统返回键）", AccessibilityService.GLOBAL_ACTION_BACK))
        add(globalActionTool("touch.home", "回到桌面（系统 Home 键）", AccessibilityService.GLOBAL_ACTION_HOME))
        add(globalActionTool("touch.recents", "打开最近任务", AccessibilityService.GLOBAL_ACTION_RECENTS))
        add(typeTool())
        add(screenshotTool())
        add(recordTool())
    }.associateBy { it.name }

    fun names(): List<String> = tools.keys.sorted()

    fun get(name: String): Tool? = tools[name]

    /** `toolDefs` payload for device:register, in the shape the server stores
     *  verbatim ({ name, description, input_schema, destructive }). */
    fun toolDefs(): JSONArray {
        val arr = JSONArray()
        for (name in names()) {
            val t = tools.getValue(name)
            arr.put(
                JSONObject()
                    .put("name", t.name)
                    .put("description", t.description)
                    .put("input_schema", t.inputSchema)
                    .put("destructive", t.destructive),
            )
        }
        return arr
    }

    private fun gesture() = GestureAccessibilityService.require()

    private fun tapTool() = object : Tool {
        override val name = "touch.tap"
        override val description = "在屏幕坐标 (x, y) 处单击（像素坐标，原点在左上角）。"
        override val inputSchema = objectSchema(
            JSONObject().put("x", intProp("横坐标，像素")).put("y", intProp("纵坐标，像素")),
            required = listOf("x", "y"),
        )
        override suspend fun run(args: JSONObject): JSONObject {
            val x = args.getInt("x").toFloat()
            val y = args.getInt("y").toFloat()
            val path = Path().apply { moveTo(x, y) }
            val ok = gesture().dispatch(path, 0, 60)
            return JSONObject().put("ok", ok).put("x", x).put("y", y)
        }
    }

    private fun longPressTool() = object : Tool {
        override val name = "touch.long_press"
        override val description = "在 (x, y) 处长按指定毫秒数。"
        override val inputSchema = objectSchema(
            JSONObject()
                .put("x", intProp("横坐标，像素"))
                .put("y", intProp("纵坐标，像素"))
                .put("duration_ms", intProp("长按时长，毫秒，默认 600")),
            required = listOf("x", "y"),
        )
        override suspend fun run(args: JSONObject): JSONObject {
            val x = args.getInt("x").toFloat()
            val y = args.getInt("y").toFloat()
            val dur = args.optLong("duration_ms", 600)
            val path = Path().apply { moveTo(x, y) }
            val ok = gesture().dispatch(path, 0, dur)
            return JSONObject().put("ok", ok)
        }
    }

    private fun swipeTool() = object : Tool {
        override val name = "touch.swipe"
        override val description = "从 (x1, y1) 滑动到 (x2, y2)，可指定时长（毫秒）。用于滑动列表、翻页、拖拽。"
        override val inputSchema = objectSchema(
            JSONObject()
                .put("x1", intProp("起点横坐标"))
                .put("y1", intProp("起点纵坐标"))
                .put("x2", intProp("终点横坐标"))
                .put("y2", intProp("终点纵坐标"))
                .put("duration_ms", intProp("滑动时长，毫秒，默认 300")),
            required = listOf("x1", "y1", "x2", "y2"),
        )
        override suspend fun run(args: JSONObject): JSONObject {
            val path = Path().apply {
                moveTo(args.getInt("x1").toFloat(), args.getInt("y1").toFloat())
                lineTo(args.getInt("x2").toFloat(), args.getInt("y2").toFloat())
            }
            val ok = gesture().dispatch(path, 0, args.optLong("duration_ms", 300))
            return JSONObject().put("ok", ok)
        }
    }

    private fun globalActionTool(toolName: String, desc: String, action: Int) = object : Tool {
        override val name = toolName
        override val description = desc
        override val inputSchema = objectSchema(JSONObject())
        override suspend fun run(args: JSONObject): JSONObject {
            val ok = gesture().performGlobalAction(action)
            return JSONObject().put("ok", ok)
        }
    }

    private fun typeTool() = object : Tool {
        override val name = "input.text"
        override val description = "向当前获得焦点的输入框写入文本（需先点击聚焦输入框）。"
        override val inputSchema = objectSchema(
            JSONObject().put("text", stringProp("要输入的文本")),
            required = listOf("text"),
        )
        override suspend fun run(args: JSONObject): JSONObject {
            val ok = gesture().typeIntoFocused(args.getString("text"))
            return JSONObject().put("ok", ok)
        }
    }

    private fun screenshotTool() = object : Tool {
        override val name = "screen.capture"
        override val description = "对当前手机屏幕截图，返回 PNG 图片。"
        override val inputSchema = objectSchema(JSONObject())
        override suspend fun run(args: JSONObject): JSONObject {
            val dataUrl = capture.captureDataUrl()
            // send_to_user lets the connector forward the screenshot to the chat.
            return JSONObject().put("dataUrl", dataUrl).put("send_to_user", true)
        }
    }

    private fun recordTool() = object : Tool {
        override val name = "screen.record"
        override val description = "录制屏幕一段时间，生成 mp4 视频文件并返回本机路径。"
        override val destructive = false
        override val inputSchema = objectSchema(
            JSONObject()
                .put("duration_ms", intProp("录制时长，毫秒，默认 5000，最长 120000"))
                .put("with_audio", JSONObject().put("type", "boolean").put("description", "是否录制麦克风音频")),
        )
        override suspend fun run(args: JSONObject): JSONObject {
            val file = capture.recordToFile(
                durationMs = args.optLong("duration_ms", 5_000),
                withAudio = args.optBoolean("with_audio", false),
            )
            return JSONObject()
                .put("path", file.absolutePath)
                .put("size_bytes", file.length())
        }
    }
}
