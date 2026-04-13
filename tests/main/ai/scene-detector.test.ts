import { describe, it, expect } from 'vitest'
import { SceneDetector } from '../../../src/main/ai/scene-detector'
import type { FilteredRequest } from '../../../src/shared/types'

function makeRequest(overrides: Partial<FilteredRequest> = {}): FilteredRequest {
  return {
    seq: 1,
    method: 'GET',
    url: 'https://example.com/api/data',
    headers: {},
    body: null,
    status: 200,
    responseHeaders: null,
    responseBody: null,
    hooks: [],
    ...overrides,
  }
}

describe('SceneDetector', () => {
  const detector = new SceneDetector()

  // 辅助函数：创建 FilteredRequest
  function createRequest(seq: number, method: string, url: string, body?: string, responseBody?: string, headers?: Record<string, string>, responseHeaders?: Record<string, string>): FilteredRequest {
    return {
      seq,
      method,
      url,
      headers: headers || {},
      body: body || null,
      status: 200,
      responseHeaders: responseHeaders || {},
      responseBody: responseBody || null,
      hooks: []
    }
  }

  it('应检测 AI Chat 场景 - SSE 响应', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.openai.com/v1/chat/completions', '{"messages":[]}', 'data: {"delta":{"content":"hello"}}', {}, { 'content-type': 'text/event-stream' })
    ]

    const hints = detector.detect(requests)
    const aiChatHint = hints.find(h => h.scene === 'ai-chat' && h.confidence === 'high')
    expect(aiChatHint).toBeDefined()
    expect(aiChatHint?.evidence).toContain('SSE')
  })

  it('应检测 AI Chat 场景 - API 路径特征', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.openai.com/v1/chat/completions', '{"messages":[]}', '{"choices":[]}')
    ]

    const hints = detector.detect(requests)
    const aiChatHint = hints.find(h => h.scene === 'ai-chat' && h.confidence === 'high' && h.evidence.includes('API'))
    expect(aiChatHint).toBeDefined()
  })

  it('应检测 AI Chat 场景 - 请求体特征（中等置信度）', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.example.com/chat', '{"messages":[{"role":"user","content":"hello"}],"model":"gpt-4","temperature":0.7}', '{"response":"..."}')
    ]

    const hints = detector.detect(requests)
    const aiChatHint = hints.find(h => h.scene === 'ai-chat' && h.confidence === 'medium')
    expect(aiChatHint).toBeDefined()
    expect(aiChatHint?.evidence).toContain('AI 典型字段')
  })

  it('应检测 OAuth 场景', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'GET', 'https://auth.example.com/oauth/authorize?redirect_uri=http://localhost:3000', '', '')
    ]

    const hints = detector.detect(requests)
    const oauthHint = hints.find(h => h.scene === 'auth-oauth')
    expect(oauthHint).toBeDefined()
    expect(oauthHint?.confidence).toBe('high')
  })

  it('应检测 Token 鉴权场景 - 响应中的 access_token', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.example.com/login', '{"username":"user"}', '{"access_token":"abc123","token_type":"Bearer"}')
    ]

    const hints = detector.detect(requests)
    const tokenHint = hints.find(h => h.scene === 'auth-token')
    expect(tokenHint).toBeDefined()
    expect(tokenHint?.confidence).toBe('high')
  })

  it('应检测 Token 鉴权场景 - Authorization Bearer Header', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'GET', 'https://api.example.com/user', '', '', { 'Authorization': 'Bearer eyJhbGc...' }, {})
    ]

    const hints = detector.detect(requests)
    const tokenHint = hints.find(h => h.scene === 'auth-token')
    expect(tokenHint).toBeDefined()
  })

  it('应检测注册场景', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.example.com/register', '{"email":"user@example.com","password":"123456"}', '{"user_id":"123"}')
    ]

    const hints = detector.detect(requests)
    const regHint = hints.find(h => h.scene === 'registration')
    expect(regHint).toBeDefined()
    expect(regHint?.confidence).toBe('high')
  })

  it('应检测登录场景', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.example.com/login', '{"username":"user","password":"123456"}', '{"token":"abc123"}')
    ]

    const hints = detector.detect(requests)
    const loginHint = hints.find(h => h.scene === 'login')
    expect(loginHint).toBeDefined()
    expect(loginHint?.confidence).toBe('high')
  })

  it('应检测 WebSocket 场景', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'GET', 'ws://api.example.com/socket', '', '', { 'Upgrade': 'websocket', 'Connection': 'Upgrade' }, {})
    ]

    const hints = detector.detect(requests)
    const wsHint = hints.find(h => h.scene === 'websocket')
    expect(wsHint).toBeDefined()
    expect(wsHint?.confidence).toBe('high')
  })

  it('应检测 SSE 流场景', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'GET', 'https://api.example.com/stream', '', 'data: {"event":"message"}', {}, { 'content-type': 'text/event-stream' })
    ]

    const hints = detector.detect(requests)
    const sseHint = hints.find(h => h.scene === 'sse-stream')
    expect(sseHint).toBeDefined()
    expect(sseHint?.confidence).toBe('high')
  })

  it('应检测通用 JSON API 场景（低置信度）', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'GET', 'https://api.example.com/data', '', '{"id":1,"name":"test"}', {}, { 'content-type': 'application/json' })
    ]

    const hints = detector.detect(requests)
    const apiHint = hints.find(h => h.scene === 'api-general')
    expect(apiHint).toBeDefined()
    expect(apiHint?.confidence).toBe('low')
  })

  it('应处理空请求列表', () => {
    const requests: FilteredRequest[] = []
    const hints = detector.detect(requests)
    expect(hints).toEqual([])
  })

  it('应支持多个场景同时检测', () => {
    const requests: FilteredRequest[] = [
      createRequest(1, 'POST', 'https://api.example.com/login', '{"username":"user","password":"123"}', '{"access_token":"abc123"}', {}, {}),
      createRequest(2, 'POST', 'https://api.example.com/v1/chat/completions', '{"messages":[{"role":"user","content":"hello"}]}', 'data: {"choices":[]}', { 'Authorization': 'Bearer abc123' }, { 'content-type': 'text/event-stream' })
    ]

    const hints = detector.detect(requests)
    expect(hints.some(h => h.scene === 'login')).toBe(true)
    expect(hints.some(h => h.scene === 'ai-chat')).toBe(true)
    expect(hints.some(h => h.scene === 'auth-token')).toBe(true)
  })

  it('should detect crypto-encryption scene from crypto hooks', () => {
    const req = makeRequest({
      hooks: [{
        id: 1, session_id: 's1', timestamp: Date.now(),
        hook_type: 'crypto', function_name: 'crypto.subtle.encrypt',
        arguments: '[]', result: null, call_stack: null, related_request_id: null,
      }],
    })
    const hints = detector.detect([req])
    expect(hints.some(h => h.scene === 'crypto-encryption')).toBe(true)
  })

  it('should detect crypto-encryption scene from crypto_lib hooks', () => {
    const req = makeRequest({
      hooks: [{
        id: 1, session_id: 's1', timestamp: Date.now(),
        hook_type: 'crypto_lib', function_name: 'CryptoJS.AES.encrypt',
        arguments: '[]', result: null, call_stack: null, related_request_id: null,
      }],
    })
    const hints = detector.detect([req])
    expect(hints.some(h => h.scene === 'crypto-encryption' && h.confidence === 'high')).toBe(true)
  })

  it('should detect crypto-encryption from signature headers', () => {
    const req = makeRequest({
      headers: { 'x-signature': 'abc123', 'content-type': 'application/json' },
    })
    const hints = detector.detect([req])
    expect(hints.some(h => h.scene === 'crypto-encryption' && h.confidence === 'medium')).toBe(true)
  })

  it('should not detect crypto-encryption without crypto indicators', () => {
    const req = makeRequest()
    const hints = detector.detect([req])
    expect(hints.some(h => h.scene === 'crypto-encryption')).toBe(false)
  })
})
