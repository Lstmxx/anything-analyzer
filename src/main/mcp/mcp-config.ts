import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { MCPServerConfig } from "@shared/types";

function getConfigPath(): string {
  return join(app.getPath("userData"), "mcp-servers.json");
}

/**
 * 将缺少 transport 字段的旧配置迁移为 stdio 类型
 */
function migrateConfig(raw: Record<string, unknown>): MCPServerConfig {
  if (!raw.transport) {
    return {
      id: raw.id as string,
      name: raw.name as string,
      enabled: raw.enabled as boolean,
      transport: "stdio",
      command: (raw.command as string) || "",
      args: (raw.args as string[]) || [],
      env: (raw.env as Record<string, string>) || {},
    };
  }
  return raw as unknown as MCPServerConfig;
}

/**
 * Load MCP server configs from disk. Returns empty array if file does not exist.
 */
export function loadMCPServers(): MCPServerConfig[] {
  const path = getConfigPath();
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>[];
    return parsed.map(migrateConfig);
  } catch {
    return [];
  }
}

function persist(servers: MCPServerConfig[]): void {
  writeFileSync(getConfigPath(), JSON.stringify(servers, null, 2), "utf-8");
}

/**
 * Save (create or update) a server config.
 */
export function saveMCPServer(server: MCPServerConfig): void {
  const servers = loadMCPServers();
  const idx = servers.findIndex((s) => s.id === server.id);
  if (idx >= 0) {
    servers[idx] = server;
  } else {
    servers.push(server);
  }
  persist(servers);
}

/**
 * Delete a server config by ID.
 */
export function deleteMCPServer(id: string): void {
  const servers = loadMCPServers();
  persist(servers.filter((s) => s.id !== id));
}
