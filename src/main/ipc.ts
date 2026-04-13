import { ipcMain, dialog, app } from "electron";
import type { LLMProviderConfig, MCPServerConfig, PromptTemplate } from "@shared/types";
import type { SessionManager } from "./session/session-manager";
import type { AiAnalyzer } from "./ai/ai-analyzer";
import type { WindowManager } from "./window";
import type { Updater } from "./updater";
import type { MCPClientManager } from "./mcp/mcp-manager";
import {
  loadTemplates,
  saveTemplate,
  deleteTemplate,
  resetTemplate,
  findTemplate,
} from "./prompt-templates";
import {
  loadMCPServers,
  saveMCPServer,
  deleteMCPServer,
} from "./mcp/mcp-config";
import type {
  RequestsRepo,
  JsHooksRepo,
  StorageSnapshotsRepo,
  AnalysisReportsRepo,
} from "./db/repositories";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Register all IPC handlers for communication between renderer and main process.
 */
export function registerIpcHandlers(deps: {
  sessionManager: SessionManager;
  aiAnalyzer: AiAnalyzer;
  windowManager: WindowManager;
  updater: Updater;
  mcpManager: MCPClientManager;
  requestsRepo: RequestsRepo;
  jsHooksRepo: JsHooksRepo;
  storageSnapshotsRepo: StorageSnapshotsRepo;
  reportsRepo: AnalysisReportsRepo;
}): void {
  const {
    sessionManager,
    aiAnalyzer,
    windowManager,
    updater,
    mcpManager,
    requestsRepo,
    jsHooksRepo,
    storageSnapshotsRepo,
    reportsRepo,
  } = deps;

  // ---- Session Management ----

  ipcMain.handle(
    "session:create",
    async (_event, name: string, targetUrl: string) => {
      return sessionManager.createSession(name, targetUrl);
    },
  );

  ipcMain.handle("session:list", async () => {
    return sessionManager.listSessions();
  });

  ipcMain.handle("session:start", async (_event, sessionId: string) => {
    const tabManager = windowManager.getTabManager();
    const mainWin = windowManager.getMainWindow();
    if (!tabManager || !mainWin) throw new Error("Browser not ready");
    await sessionManager.startCapture(
      sessionId,
      tabManager,
      mainWin.webContents,
    );
  });

  ipcMain.handle("session:pause", async (_event, sessionId: string) => {
    await sessionManager.pauseCapture(sessionId);
  });

  ipcMain.handle("session:stop", async (_event, sessionId: string) => {
    await sessionManager.stopCapture(sessionId);
  });

  ipcMain.handle("session:delete", async (_event, sessionId: string) => {
    await sessionManager.deleteSession(sessionId);
  });

  // ---- Browser Control ----

  ipcMain.handle("browser:navigate", async (_event, url: string) => {
    await windowManager.navigateTo(url);
  });

  ipcMain.handle("browser:back", async () => {
    windowManager.goBack();
  });

  ipcMain.handle("browser:forward", async () => {
    windowManager.goForward();
  });

  ipcMain.handle("browser:reload", async () => {
    windowManager.reload();
  });

  ipcMain.handle("browser:setRatio", async (_event, ratio: number) => {
    windowManager.setBrowserRatio(ratio);
  });

  // Renderer reports exact browser placeholder bounds (fire-and-forget)
  ipcMain.on("browser:syncBounds", (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    windowManager.syncBrowserBounds(bounds);
  });

  ipcMain.handle("browser:setVisible", async (_event, visible: boolean) => {
    windowManager.setTargetViewVisible(visible);
  });

  // ---- Tab Management ----

  ipcMain.handle("tabs:create", async (_event, url?: string) => {
    const tabManager = windowManager.getTabManager();
    if (!tabManager) throw new Error("Tab manager not ready");
    const tab = tabManager.createTab(url);
    return { id: tab.id, url: tab.url, title: tab.title, isActive: true };
  });

  ipcMain.handle("tabs:close", async (_event, tabId: string) => {
    const tabManager = windowManager.getTabManager();
    if (!tabManager) throw new Error("Tab manager not ready");
    tabManager.closeTab(tabId);
  });

  ipcMain.handle("tabs:activate", async (_event, tabId: string) => {
    const tabManager = windowManager.getTabManager();
    if (!tabManager) throw new Error("Tab manager not ready");
    tabManager.activateTab(tabId);
  });

  ipcMain.handle("tabs:list", async () => {
    const tabManager = windowManager.getTabManager();
    if (!tabManager) return [];
    const activeTab = tabManager.getActiveTab();
    return tabManager.getAllTabs().map((t) => ({
      id: t.id,
      url: t.url,
      title: t.title,
      isActive: t.id === activeTab?.id,
    }));
  });

  // Forward TabManager events to the renderer
  const tabManager = windowManager.getTabManager();
  const mainWin = windowManager.getMainWindow();
  if (tabManager && mainWin) {
    tabManager.on(
      "tab-created",
      (tabInfo: { id: string; url: string; title: string }) => {
        mainWin.webContents.send("tabs:created", {
          id: tabInfo.id,
          url: tabInfo.url,
          title: tabInfo.title,
          isActive: true,
        });
      },
    );
    tabManager.on("tab-closed", (data: { tabId: string }) => {
      mainWin.webContents.send("tabs:closed", data);
    });
    tabManager.on(
      "tab-activated",
      (data: { tabId: string; url: string; title: string }) => {
        mainWin.webContents.send("tabs:activated", data);
      },
    );
    tabManager.on(
      "tab-updated",
      (data: { tabId: string; url?: string; title?: string }) => {
        mainWin.webContents.send("tabs:updated", data);
      },
    );
  }

  // ---- Data Queries ----

  ipcMain.handle("data:requests", async (_event, sessionId: string) => {
    return requestsRepo.findBySession(sessionId);
  });

  ipcMain.handle("data:hooks", async (_event, sessionId: string) => {
    return jsHooksRepo.findBySession(sessionId);
  });

  ipcMain.handle("data:storage", async (_event, sessionId: string) => {
    return storageSnapshotsRepo.findBySession(sessionId);
  });

  ipcMain.handle("data:reports", async (_event, sessionId: string) => {
    return reportsRepo.findBySession(sessionId);
  });

  // ---- AI Analysis ----

  ipcMain.handle("ai:analyze", async (_event, sessionId: string, purpose?: string) => {
    const config = loadLLMConfig();
    if (!config) throw new Error("LLM provider not configured");

    const win = windowManager.getMainWindow();
    const onProgress = win
      ? (chunk: string) => {
          win.webContents.send("ai:progress", chunk);
        }
      : undefined;

    // 连接所有启用的 MCP 服务器
    const mcpServers = loadMCPServers();
    if (mcpServers.some((s) => s.enabled)) {
      await mcpManager.connectAll(mcpServers);
    }

    // Resolve template: if purpose matches a template ID, load it
    const template = purpose ? findTemplate(purpose) : findTemplate("auto");
    return aiAnalyzer.analyze(sessionId, config, onProgress, purpose, template ?? undefined);
  });

  ipcMain.handle(
    "ai:chat",
    async (
      _event,
      sessionId: string,
      history: Array<{ role: string; content: string }>,
      userMessage: string,
    ) => {
      const config = loadLLMConfig();
      if (!config) throw new Error("LLM provider not configured");

      const win = windowManager.getMainWindow();
      const onProgress = win
        ? (chunk: string) => {
            win.webContents.send("ai:progress", chunk);
          }
        : undefined;

      return aiAnalyzer.chat(sessionId, config, history, userMessage, onProgress);
    },
  );

  // ---- Settings ----

  ipcMain.handle("settings:getLLM", async () => {
    return loadLLMConfig();
  });

  ipcMain.handle(
    "settings:saveLLM",
    async (_event, config: LLMProviderConfig) => {
      saveLLMConfig(config);
    },
  );

  // ---- File Export ----

  ipcMain.handle(
    "dialog:exportFile",
    async (_event, defaultName: string, content: string) => {
      const win = windowManager.getMainWindow();
      if (!win) return false;
      const { canceled, filePath } = await dialog.showSaveDialog(win, {
        defaultPath: defaultName,
        filters: [
          { name: "Markdown", extensions: ["md"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      if (canceled || !filePath) return false;
      writeFileSync(filePath, content, "utf-8");
      return true;
    },
  );

  // ---- Auto Update ----

  ipcMain.handle("app:version", () => {
    return app.getVersion();
  });

  ipcMain.handle("update:check", async () => {
    updater.checkForUpdates();
  });

  ipcMain.on("update:install", () => {
    updater.quitAndInstall();
  });

  // ---- Prompt Templates ----

  ipcMain.handle("templates:list", async () => {
    return loadTemplates();
  });

  ipcMain.handle("templates:save", async (_event, template: PromptTemplate) => {
    saveTemplate(template);
  });

  ipcMain.handle("templates:delete", async (_event, id: string) => {
    deleteTemplate(id);
  });

  ipcMain.handle("templates:reset", async (_event, id: string) => {
    resetTemplate(id);
  });

  // ---- MCP Servers ----

  ipcMain.handle("mcp:list", async () => {
    return loadMCPServers();
  });

  ipcMain.handle("mcp:save", async (_event, server: MCPServerConfig) => {
    saveMCPServer(server);
  });

  ipcMain.handle("mcp:delete", async (_event, id: string) => {
    deleteMCPServer(id);
    // 同时断开该服务器连接
    await mcpManager.disconnect(id);
  });
}

// ---- Config persistence helpers ----

function getConfigPath(): string {
  return join(app.getPath("userData"), "llm-config.json");
}

function loadLLMConfig(): LLMProviderConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as LLMProviderConfig;
  } catch {
    return null;
  }
}

function saveLLMConfig(config: LLMProviderConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), "utf-8");
}
