import type { CapturedRequest, JsHookRecord, CryptoScriptSnippet } from '@shared/types'
import type { RequestsRepo, JsHooksRepo } from '../db/repositories'

const CONTEXT_LINES = 30

const TIER1_PATTERNS = [
  'crypto.subtle', 'CryptoJS', 'JSEncrypt', 'forge.cipher', 'forge.pki',
  'forge.md', 'forge.hmac', 'new RSAKey', 'CryptoKey', 'sm2.doEncrypt',
  'sm3(', 'sm4.encrypt',
]

const TIER2_PATTERNS = [
  'encrypt(', 'decrypt(', '.sign(', '.verify(', '.digest(', 'hmac',
  'AES', 'RSA', 'DES', 'SHA256', 'SHA1', 'SHA512', 'MD5', 'PBKDF2',
  'createCipher', 'createDecipher', 'createHash', 'createHmac',
  'publicKey', 'privateKey', 'secretKey',
]

const TIER3_PATTERNS = [
  'btoa(', 'atob(', 'Base64', '.charCodeAt', 'fromCharCode',
  'TextEncoder', 'encodeURIComponent',
]

const DEFAULT_BUDGET_CHARS = 20000

/**
 * CryptoScriptExtractor — Scans stored JS response bodies for crypto-related code
 * and extracts relevant snippets with surrounding context.
 */
export class CryptoScriptExtractor {
  constructor(
    private requestsRepo: RequestsRepo,
    private jsHooksRepo: JsHooksRepo,
  ) {}

  extract(sessionId: string, budgetChars: number = DEFAULT_BUDGET_CHARS): CryptoScriptSnippet[] {
    const allRequests = this.requestsRepo.findBySession(sessionId)
    const jsRequests = allRequests.filter(r => this.isJsRequest(r))

    if (jsRequests.length === 0) return []

    // Get hook call stacks for correlation
    const hooks = this.jsHooksRepo.findBySession(sessionId)
    const cryptoHooks = hooks.filter(h => h.hook_type === 'crypto' || h.hook_type === 'crypto_lib')
    const hookScriptUrls = this.extractScriptUrlsFromHooks(cryptoHooks)

    // Scan each JS file for crypto patterns
    const allSnippets: (CryptoScriptSnippet & { hookCorrelation: number })[] = []

    for (const req of jsRequests) {
      if (!req.response_body) continue
      const lines = req.response_body.split('\n')
      const matches = this.findPatternMatches(lines)

      if (matches.length === 0) continue

      // Merge overlapping ranges
      const merged = this.mergeRanges(matches, lines.length)

      // Calculate hook correlation score
      const scriptUrl = req.url
      const hookCorrelation = hookScriptUrls.filter(u => scriptUrl.includes(u)).length

      for (const range of merged) {
        const content = lines.slice(range.start, range.end + 1).join('\n')
        allSnippets.push({
          scriptUrl,
          lineRange: [range.start + 1, range.end + 1], // 1-based
          content,
          matchedPatterns: range.patterns,
          tier: range.bestTier,
          hookCorrelation,
        })
      }
    }

    // Sort: tier ASC, hookCorrelation DESC, then by content length ASC
    allSnippets.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.hookCorrelation !== b.hookCorrelation) return b.hookCorrelation - a.hookCorrelation
      return a.content.length - b.content.length
    })

    // Fill budget
    const result: CryptoScriptSnippet[] = []
    let usedChars = 0

    for (const snippet of allSnippets) {
      if (usedChars + snippet.content.length > budgetChars) {
        // Try to fit a truncated version if at least 500 chars remain in budget
        const remaining = budgetChars - usedChars
        if (remaining >= 500) {
          result.push({
            scriptUrl: snippet.scriptUrl,
            lineRange: snippet.lineRange,
            content: snippet.content.substring(0, remaining) + '\n[TRUNCATED]',
            matchedPatterns: snippet.matchedPatterns,
            tier: snippet.tier,
          })
          usedChars = budgetChars
        }
        break
      }
      result.push({
        scriptUrl: snippet.scriptUrl,
        lineRange: snippet.lineRange,
        content: snippet.content,
        matchedPatterns: snippet.matchedPatterns,
        tier: snippet.tier,
      })
      usedChars += snippet.content.length
    }

    return result
  }

  private isJsRequest(r: CapturedRequest): boolean {
    if (r.method !== 'GET') return false
    if (!r.response_body) return false
    return /\.js(\?|$)/i.test(r.url) || (r.content_type?.includes('javascript') ?? false)
  }

  private findPatternMatches(lines: string[]): { line: number; tier: 1 | 2 | 3; pattern: string }[] {
    const matches: { line: number; tier: 1 | 2 | 3; pattern: string }[] = []

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      for (const p of TIER1_PATTERNS) {
        if (l.includes(p)) {
          matches.push({ line: i, tier: 1, pattern: p })
          break // one match per line per tier is enough
        }
      }
      for (const p of TIER2_PATTERNS) {
        if (l.includes(p)) {
          matches.push({ line: i, tier: 2, pattern: p })
          break
        }
      }
      for (const p of TIER3_PATTERNS) {
        if (l.includes(p)) {
          matches.push({ line: i, tier: 3, pattern: p })
          break
        }
      }
    }

    return matches
  }

  private mergeRanges(
    matches: { line: number; tier: 1 | 2 | 3; pattern: string }[],
    totalLines: number,
  ): { start: number; end: number; patterns: string[]; bestTier: 1 | 2 | 3 }[] {
    if (matches.length === 0) return []

    // Expand each match to a range with context
    const ranges = matches.map(m => ({
      start: Math.max(0, m.line - CONTEXT_LINES),
      end: Math.min(totalLines - 1, m.line + CONTEXT_LINES),
      patterns: [m.pattern],
      bestTier: m.tier,
    }))

    // Sort by start position
    ranges.sort((a, b) => a.start - b.start)

    // Merge overlapping
    const merged: typeof ranges = [ranges[0]]
    for (let i = 1; i < ranges.length; i++) {
      const prev = merged[merged.length - 1]
      const curr = ranges[i]
      if (curr.start <= prev.end + 1) {
        // Overlapping, merge
        prev.end = Math.max(prev.end, curr.end)
        prev.patterns = [...new Set([...prev.patterns, ...curr.patterns])]
        prev.bestTier = Math.min(prev.bestTier, curr.bestTier) as 1 | 2 | 3
      } else {
        merged.push(curr)
      }
    }

    return merged
  }

  private extractScriptUrlsFromHooks(hooks: JsHookRecord[]): string[] {
    const urls: string[] = []
    for (const hook of hooks) {
      if (!hook.call_stack) continue
      // Parse stack frames like "at funcName (https://example.com/js/api.js:142:15)"
      const urlMatches = hook.call_stack.match(/https?:\/\/[^\s:)]+\.js/g)
      if (urlMatches) {
        for (const url of urlMatches) {
          // Extract just the path portion for matching
          try {
            const pathname = new URL(url).pathname
            if (!urls.includes(pathname)) urls.push(pathname)
          } catch {
            if (!urls.includes(url)) urls.push(url)
          }
        }
      }
    }
    return urls
  }
}
