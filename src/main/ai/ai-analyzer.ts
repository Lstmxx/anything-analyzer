import { v4 as uuidv4 } from "uuid";
import type { AnalysisReport, LLMProviderConfig, PromptTemplate } from "@shared/types";
import type {
  SessionsRepo,
  RequestsRepo,
  JsHooksRepo,
  StorageSnapshotsRepo,
  AnalysisReportsRepo,
} from "../db/repositories";
import { DataAssembler } from "./data-assembler";
import { PromptBuilder } from "./prompt-builder";
import { LLMRouter } from "./llm-router";
import type { MCPClientManager } from "../mcp/mcp-manager";

/**
 * AiAnalyzer — Orchestrates data assembly, prompt building, LLM calling,
 * and report generation.
 */
export class AiAnalyzer {
  private mcpManager: MCPClientManager | null = null;

  constructor(
    private sessionsRepo: SessionsRepo,
    private requestsRepo: RequestsRepo,
    private jsHooksRepo: JsHooksRepo,
    private storageSnapshotsRepo: StorageSnapshotsRepo,
    private reportsRepo: AnalysisReportsRepo,
  ) {}

  /**
   * 注入 MCP 客户端管理器（可选）
   */
  setMCPManager(manager: MCPClientManager): void {
    this.mcpManager = manager;
  }

  async analyze(
    sessionId: string,
    config: LLMProviderConfig,
    onProgress?: (chunk: string) => void,
    purpose?: string,
    template?: PromptTemplate,
  ): Promise<AnalysisReport> {
    // Get session info
    const session = this.sessionsRepo.findById(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    // Extract platform name from target URL
    let platformName = "unknown";
    try {
      platformName = new URL(session.target_url).hostname;
    } catch {
      /* ignore */
    }

    // Assemble data
    const assembler = new DataAssembler(
      this.requestsRepo,
      this.jsHooksRepo,
      this.storageSnapshotsRepo,
    );
    const data = assembler.assemble(sessionId);

    if (data.requests.length === 0) {
      throw new Error("No captured requests to analyze");
    }

    // Build prompt
    const promptBuilder = new PromptBuilder();
    const { system, user } = promptBuilder.build(data, platformName, purpose, template);

    // Call LLM with retry
    const router = new LLMRouter(config);
    let content = "";
    let promptTokens = 0;
    let completionTokens = 0;

    // 检查是否有 MCP 工具可用
    const mcpTools = this.mcpManager?.hasConnections()
      ? this.mcpManager.listAllTools()
      : [];

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
          { role: "system", content: system },
          { role: "user", content: user },
        ];

        let result;
        if (mcpTools.length > 0 && this.mcpManager) {
          const mgr = this.mcpManager;
          result = await router.completeWithTools(
            messages,
            mcpTools,
            (name, args) => mgr.callTool(name, args),
            onProgress,
          );
        } else {
          result = await router.complete(messages, onProgress);
        }

        content = result.content;
        promptTokens = result.promptTokens;
        completionTokens = result.completionTokens;
        break;
      } catch (err) {
        if (attempt === 1)
          throw new Error(
            `AI analysis failed after retry: ${(err as Error).message}`,
          );
      }
    }

    // Save report
    const report: AnalysisReport = {
      id: uuidv4(),
      session_id: sessionId,
      created_at: Date.now(),
      llm_provider: config.name,
      llm_model: config.model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      report_content: content,
    };

    this.reportsRepo.insert(report);

    return report;
  }

  async chat(
    sessionId: string,
    config: LLMProviderConfig,
    history: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    userMessage: string,
    onProgress?: (chunk: string) => void,
  ): Promise<string> {
    // Build messages array: existing history + new user message
    const messages = [
      ...history,
      { role: 'user' as const, content: userMessage },
    ]

    const router = new LLMRouter(config)
    const result = await router.complete(messages, onProgress)
    return result.content
  }
}
