import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { app } from "electron";
import type { PromptTemplate } from "@shared/types";

// Default system prompt shared by all built-in templates
const DEFAULT_SYSTEM_PROMPT = `你是一位网站协议分析专家。你的任务是分析用户在网站上的操作过程中产生的HTTP请求、JS调用和存储变化，识别其业务场景，并生成结构化的协议分析报告。Be precise and technical. Output in Chinese (Simplified).`;

/**
 * Built-in template definitions — used as defaults and for reset.
 */
function getDefaultTemplates(): PromptTemplate[] {
  return [
    {
      id: "auto",
      name: "自动识别",
      description: "默认 — AI 自动检测场景并生成通用分析",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      requirements: `1. 场景识别：判断用户执行了什么操作（注册、登录、AI对话、支付等）
2. 交互流程概述：按时间顺序描述完整交互链路
3. API端点清单：列出所有关键API，标注方法、路径、用途
4. 鉴权机制分析：认证方式、凭据获取流程、凭据传递方式
5. 流式通信分析（如检测到SSE/WebSocket）：协议类型、端点、请求/响应格式
6. 存储使用分析：Cookie/localStorage/sessionStorage 的关键变化
7. 关键依赖关系：请求之间的依赖和时序关系
8. 复现建议：用代码伪逻辑描述如何复现整个流程`,
      isBuiltin: true,
      isModified: false,
    },
    {
      id: "reverse-api",
      name: "逆向 API 协议",
      description: "聚焦 API 端点、请求/响应模式、鉴权流程、数据模型、复现代码",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      requirements: `1. 完整 API 端点清单：列出所有 API 的方法、路径、请求参数、响应 JSON 结构
2. 鉴权流程：Token/Cookie 获取、刷新、传递机制的完整链路
3. 请求依赖链：哪些请求的响应是后续请求的必要输入
4. 数据模型推断：从 API 响应结构推断后端数据模型
5. 复现代码：用 Python requests 库写出可直接运行的完整 API 调用流程`,
      isBuiltin: true,
      isModified: false,
    },
    {
      id: "security-audit",
      name: "安全审计",
      description: "聚焦认证安全、敏感数据暴露、CSRF/XSS 风险、权限控制",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      requirements: `1. 认证安全：分析认证方式的安全性，是否存在弱口令、明文传输、Token 泄露风险
2. 敏感数据暴露：检查响应中是否包含不必要的敏感信息（密码、密钥、PII）
3. CSRF/XSS 风险：分析请求是否缺少 CSRF Token，响应头是否缺少安全头（CSP, X-Frame-Options 等）
4. 权限控制：分析是否存在越权访问的可能（水平/垂直越权）
5. 安全建议：针对发现的问题给出具体修复建议`,
      isBuiltin: true,
      isModified: false,
    },
    {
      id: "performance",
      name: "性能分析",
      description: "聚焦请求时序、冗余请求、资源加载、缓存策略",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      requirements: `1. 请求时序分析：分析请求的串行/并行关系，识别阻塞链路
2. 冗余请求：识别重复或不必要的请求
3. 资源优化：分析资源加载顺序，识别可优化的静态资源
4. 缓存策略：分析 Cache-Control、ETag 等缓存头的使用情况
5. 性能建议：给出具体的性能优化建议和预期收益`,
      isBuiltin: true,
      isModified: false,
    },
    {
      id: "crypto-reverse",
      name: "JS加密逆向",
      description: "聚焦JS加密算法识别、加密流程还原、密钥分析、Python复现代码",
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      requirements: `1. 加密算法识别：识别所有使用的加密/签名/哈希算法（AES、RSA、SHA、HMAC、SM2/3/4 等），标注具体库和方法名
2. 加密流程还原：完整描述每个请求参数的加密 pipeline（明文 → 各步骤 → 密文），画出数据流转图
3. 密钥管理分析：密钥来源（硬编码/动态/协商）、密钥格式（Hex/Base64/PEM）、密钥长度
4. 签名/校验机制：请求签名的生成算法、参与签名的参数排序规则、时间戳/nonce 机制
5. 复现代码：用 Python 写出完整的加密/签名/请求复现代码，确保可直接运行，包含所有必要的密钥和参数`,
      isBuiltin: true,
      isModified: false,
    },
  ];
}

function getTemplatesPath(): string {
  return join(app.getPath("userData"), "prompt-templates.json");
}

/**
 * Load templates from disk. Initializes with defaults if file does not exist.
 */
export function loadTemplates(): PromptTemplate[] {
  const path = getTemplatesPath();
  if (!existsSync(path)) {
    const defaults = getDefaultTemplates();
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf-8");
    return defaults;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PromptTemplate[];
  } catch {
    const defaults = getDefaultTemplates();
    writeFileSync(path, JSON.stringify(defaults, null, 2), "utf-8");
    return defaults;
  }
}

function persistTemplates(templates: PromptTemplate[]): void {
  writeFileSync(getTemplatesPath(), JSON.stringify(templates, null, 2), "utf-8");
}

/**
 * Save (create or update) a template.
 */
export function saveTemplate(template: PromptTemplate): void {
  const templates = loadTemplates();
  const idx = templates.findIndex((t) => t.id === template.id);
  if (idx >= 0) {
    // Update existing — mark builtin as modified
    if (templates[idx].isBuiltin) {
      template.isBuiltin = true;
      template.isModified = true;
    }
    templates[idx] = template;
  } else {
    // New custom template
    template.isBuiltin = false;
    template.isModified = false;
    templates.push(template);
  }
  persistTemplates(templates);
}

/**
 * Delete a custom template. Builtin templates cannot be deleted.
 */
export function deleteTemplate(id: string): void {
  const templates = loadTemplates();
  const target = templates.find((t) => t.id === id);
  if (target?.isBuiltin) {
    throw new Error("Cannot delete builtin template");
  }
  persistTemplates(templates.filter((t) => t.id !== id));
}

/**
 * Reset a builtin template to its default values.
 */
export function resetTemplate(id: string): void {
  const templates = loadTemplates();
  const defaults = getDefaultTemplates();
  const defaultTemplate = defaults.find((t) => t.id === id);
  if (!defaultTemplate) {
    throw new Error(`No builtin default for template: ${id}`);
  }
  const idx = templates.findIndex((t) => t.id === id);
  if (idx >= 0) {
    templates[idx] = { ...defaultTemplate };
  } else {
    templates.push({ ...defaultTemplate });
  }
  persistTemplates(templates);
}

/**
 * Find a template by ID. Returns undefined if not found.
 */
export function findTemplate(id: string): PromptTemplate | undefined {
  return loadTemplates().find((t) => t.id === id);
}
