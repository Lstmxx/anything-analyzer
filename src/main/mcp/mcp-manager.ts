import { Client } from "@modelcontextprotocol/sdk/client";
// Must use explicit .js extension for CJS require resolution in Electron main process
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig } from "@shared/types";

/**
 * MCP 工具描述，包含来源信息
 */
export interface MCPToolInfo {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

interface ConnectedServer {
  config: MCPServerConfig;
  client: Client;
  transport: Transport;
  tools: MCPToolInfo[];
}

/**
 * 管理 MCP 服务器连接，提供统一的工具列表和调用接口。
 */
export class MCPClientManager {
  private servers = new Map<string, ConnectedServer>();

  /**
   * 连接单个 MCP 服务器
   */
  async connect(config: MCPServerConfig): Promise<void> {
    if (this.servers.has(config.id)) {
      await this.disconnect(config.id);
    }

    let transport: Transport;

    if (config.transport === "streamableHttp") {
      const url = new URL(config.url);
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: config.headers && Object.keys(config.headers).length > 0
          ? { headers: config.headers }
          : undefined,
      });
    } else {
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env } as Record<string, string>,
      });
    }

    const client = new Client(
      { name: "anything-analyzer", version: "1.0.0" },
    );

    await client.connect(transport);

    // 获取工具列表
    const { tools } = await client.listTools();
    const toolInfos: MCPToolInfo[] = tools.map((t) => ({
      serverName: config.name,
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.inputSchema as Record<string, unknown>,
    }));

    this.servers.set(config.id, { config, client, transport, tools: toolInfos });
    console.log(`[MCP] Connected to ${config.name}, tools: ${toolInfos.map((t) => t.name).join(", ")}`);
  }

  /**
   * 断开单个服务器连接
   */
  async disconnect(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    try {
      await server.client.close();
    } catch {
      // ignore close errors
    }
    this.servers.delete(id);
  }

  /**
   * 断开所有连接
   */
  async disconnectAll(): Promise<void> {
    const ids = [...this.servers.keys()];
    await Promise.allSettled(ids.map((id) => this.disconnect(id)));
  }

  /**
   * 连接所有启用的服务器
   */
  async connectAll(configs: MCPServerConfig[]): Promise<void> {
    const enabled = configs.filter((c) => c.enabled);
    await Promise.allSettled(
      enabled.map((c) => this.connect(c).catch((err) => {
        console.error(`[MCP] Failed to connect ${c.name}:`, err);
      })),
    );
  }

  /**
   * 列出所有已连接服务器的工具
   */
  listAllTools(): MCPToolInfo[] {
    const all: MCPToolInfo[] = [];
    for (const server of this.servers.values()) {
      all.push(...server.tools);
    }
    return all;
  }

  /**
   * 调用工具（路由到正确的 MCP 客户端）
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    for (const server of this.servers.values()) {
      const tool = server.tools.find((t) => t.name === toolName);
      if (tool) {
        const result = await server.client.callTool({ name: toolName, arguments: args });
        // 将结果内容拼接为文本
        if (result.isError) {
          const errorText = Array.isArray(result.content)
            ? result.content.map((c: { type: string; text?: string }) => c.type === "text" ? c.text ?? "" : "").join("\n")
            : String(result.content);
          throw new Error(`Tool ${toolName} error: ${errorText}`);
        }
        const textParts: string[] = [];
        if (Array.isArray(result.content)) {
          for (const item of result.content as Array<{ type: string; text?: string }>) {
            if (item.type === "text" && item.text) {
              textParts.push(item.text);
            }
          }
        }
        return textParts.join("\n") || JSON.stringify(result.content);
      }
    }
    throw new Error(`Tool not found: ${toolName}`);
  }

  /**
   * 是否有已连接的服务器
   */
  hasConnections(): boolean {
    return this.servers.size > 0;
  }
}
