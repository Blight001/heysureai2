"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeTask = executeTask;
exports.getAvailableTools = getAvailableTools;
const filesystem_1 = require("./tools/filesystem");
const shell_1 = require("./tools/shell");
const git_1 = require("./tools/git");
const keyboard_1 = require("./tools/keyboard");
const mouse_1 = require("./tools/mouse");
const screen_1 = require("./tools/screen");
const clipboard_1 = require("./tools/clipboard");
const window_1 = require("./tools/window");
const process_1 = require("./tools/process");
const platform_1 = require("./platform");
// Infer tool from instruction text (Chinese + English keywords)
function inferTool(instruction) {
    const t = instruction.toLowerCase();
    if (/截图|screenshot|screen capture|屏幕/.test(t))
        return 'screen.capture';
    if (/键盘|输入文字|type text|keyboard/.test(t))
        return 'keyboard.type';
    if (/点击|click|鼠标/.test(t))
        return 'mouse.click';
    if (/窗口列表|list window/.test(t))
        return 'window.list';
    if (/进程|process/.test(t))
        return 'process.list';
    if (/剪贴板|clipboard/.test(t))
        return 'clipboard.get';
    if (/git diff|改动|变更/.test(t))
        return 'git.diff';
    if (/运行|执行|run|命令|command/.test(t))
        return 'shell.run';
    if (/列出|ls|list|文件列表/.test(t))
        return 'fs.list';
    if (/读取|read|查看/.test(t))
        return 'fs.read';
    if (/写入|创建文件|write|create file/.test(t))
        return 'fs.write';
    return 'shell.run';
}
async function executeTask(workspaceRoot, task) {
    const tool = task.tool || inferTool(task.instruction || '');
    const args = task.args || {};
    // Build instruction into args for tools that use it
    if (!task.tool && task.instruction) {
        args.instruction = task.instruction;
        if (!args.command && tool === 'shell.run')
            args.command = task.instruction;
    }
    try {
        let result;
        switch (tool) {
            // Filesystem
            case 'fs.list':
                result = (0, filesystem_1.listFiles)(workspaceRoot, args);
                break;
            case 'fs.read':
                result = (0, filesystem_1.readFile)(workspaceRoot, args);
                break;
            case 'fs.write':
                result = (0, filesystem_1.writeFile)(workspaceRoot, args);
                break;
            // Shell & git
            case 'shell.run':
                result = await (0, shell_1.runCommand)(workspaceRoot, args);
                break;
            case 'git.diff':
                result = await (0, git_1.gitDiff)(workspaceRoot, args);
                break;
            // Keyboard (Windows-only)
            case 'keyboard.type':
                result = await (0, keyboard_1.keyboardType)(args);
                break;
            case 'keyboard.press':
                result = await (0, keyboard_1.keyboardPress)(args);
                break;
            // Mouse (Windows-only)
            case 'mouse.move':
                result = await (0, mouse_1.mouseMove)(args);
                break;
            case 'mouse.click':
                result = await (0, mouse_1.mouseClick)(args);
                break;
            case 'mouse.double_click':
                result = await (0, mouse_1.mouseDoubleClick)(args);
                break;
            case 'mouse.right_click':
                result = await (0, mouse_1.mouseRightClick)(args);
                break;
            case 'mouse.scroll':
                result = await (0, mouse_1.mouseScroll)(args);
                break;
            case 'mouse.drag':
                result = await (0, mouse_1.mouseDrag)(args);
                break;
            // Screen (Windows-only)
            case 'screen.capture':
                result = await (0, screen_1.screenCapture)(args);
                break;
            case 'screen.capture_region':
                result = await (0, screen_1.screenCaptureRegion)(args);
                break;
            case 'screen.info':
                result = await (0, screen_1.screenInfo)(args);
                break;
            // Clipboard (Windows-only)
            case 'clipboard.get':
                result = (0, clipboard_1.clipboardGet)(args);
                break;
            case 'clipboard.set':
                result = (0, clipboard_1.clipboardSet)(args);
                break;
            // Window management (Windows-only)
            case 'window.list':
                result = await (0, window_1.windowList)(workspaceRoot, args);
                break;
            case 'window.focus':
                result = await (0, window_1.windowFocus)(workspaceRoot, args);
                break;
            case 'window.close':
                result = await (0, window_1.windowClose)(workspaceRoot, args);
                break;
            // Process management (Windows-only)
            case 'process.list':
                result = await (0, process_1.processList)(workspaceRoot, args);
                break;
            case 'process.kill':
                result = await (0, process_1.processKill)(workspaceRoot, args);
                break;
            default:
                throw new Error(`Unknown tool: ${tool}. Use one of: ${getAvailableTools().join(', ')}`);
        }
        return { success: true, tool, result, summary: `${tool} completed successfully` };
    }
    catch (err) {
        return { success: false, tool, result: null, summary: err.message || String(err) };
    }
}
function getAvailableTools() {
    if (platform_1.IS_WINDOWS) {
        return [
            'fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff',
            'keyboard.type', 'keyboard.press',
            'mouse.move', 'mouse.click', 'mouse.double_click', 'mouse.right_click', 'mouse.scroll', 'mouse.drag',
            'screen.capture', 'screen.capture_region', 'screen.info',
            'clipboard.get', 'clipboard.set',
            'window.list', 'window.focus', 'window.close',
            'process.list', 'process.kill',
        ];
    }
    return ['fs.list', 'fs.read', 'fs.write', 'shell.run', 'git.diff'];
}
