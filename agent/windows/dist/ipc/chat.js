"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerChatIpc = registerChatIpc;
const electron_1 = require("electron");
const store_1 = require("../store");
const chat_session_1 = require("../services/chat-session");
function registerChatIpc() {
    electron_1.ipcMain.handle('chat:history', async () => (0, chat_session_1.getChatHistory)(store_1.store.store));
    electron_1.ipcMain.handle('chat:send', async (_event, content) => (0, chat_session_1.sendChatMessage)(store_1.store.store, String(content || '')));
}
