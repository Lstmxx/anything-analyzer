import { app, BrowserWindow } from "electron";
import { getDatabase, closeDatabase } from "./db/database";
import { runMigrations } from "./db/migrations";
import {
  SessionsRepo,
  RequestsRepo,
  JsHooksRepo,
  StorageSnapshotsRepo,
  AnalysisReportsRepo,
} from "./db/repositories";
import { CaptureEngine } from "./capture/capture-engine";
import { SessionManager } from "./session/session-manager";
import { AiAnalyzer } from "./ai/ai-analyzer";
import { WindowManager } from "./window";
import { registerIpcHandlers } from "./ipc";
import { Updater } from "./updater";
import { MCPClientManager } from "./mcp/mcp-manager";

const windowManager = new WindowManager();
const mcpManager = new MCPClientManager();

app.whenReady().then(() => {
  // Initialize database
  const db = getDatabase();
  runMigrations(db);

  // Initialize repositories
  const sessionsRepo = new SessionsRepo(db);
  const requestsRepo = new RequestsRepo(db);
  const jsHooksRepo = new JsHooksRepo(db);
  const storageSnapshotsRepo = new StorageSnapshotsRepo(db);
  const reportsRepo = new AnalysisReportsRepo(db);

  // Initialize capture engine
  const captureEngine = new CaptureEngine(
    requestsRepo,
    jsHooksRepo,
    storageSnapshotsRepo,
  );

  // Initialize session manager
  const sessionManager = new SessionManager(sessionsRepo, captureEngine);

  // Recover from potential crash
  sessionManager.recoverFromCrash();

  // Initialize AI analyzer
  const aiAnalyzer = new AiAnalyzer(
    sessionsRepo,
    requestsRepo,
    jsHooksRepo,
    storageSnapshotsRepo,
    reportsRepo,
  );

  // Create main window
  windowManager.createMainWindow();

  // Initialize tab manager with first tab
  windowManager.initTabs();

  // Initialize auto-updater
  const updater = new Updater();
  const mainWin = windowManager.getMainWindow();
  if (mainWin) updater.setMainWindow(mainWin);

  // Inject MCP client manager into AI analyzer
  aiAnalyzer.setMCPManager(mcpManager);

  // Register IPC handlers
  registerIpcHandlers({
    sessionManager,
    aiAnalyzer,
    windowManager,
    updater,
    mcpManager,
    requestsRepo,
    jsHooksRepo,
    storageSnapshotsRepo,
    reportsRepo,
  });

  // Check for updates on startup (non-blocking, delayed 3s)
  setTimeout(() => updater.checkForUpdates(), 3000);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      windowManager.createMainWindow();
      windowManager.initTabs();
      const win = windowManager.getMainWindow();
      if (win) updater.setMainWindow(win);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  mcpManager.disconnectAll().catch(() => {});
  closeDatabase();
});
