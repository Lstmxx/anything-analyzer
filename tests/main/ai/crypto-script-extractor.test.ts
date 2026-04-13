import { describe, it, expect } from "vitest";
import { CryptoScriptExtractor } from "../../../src/main/ai/crypto-script-extractor";

// ---- Helpers ----

function makeJsRequest(url: string, body: string): any {
  return {
    id: "req-" + url,
    session_id: "test-session",
    sequence: 1,
    timestamp: Date.now(),
    method: "GET",
    url,
    request_headers: "{}",
    request_body: null,
    status_code: 200,
    response_headers: '{"content-type":"application/javascript"}',
    response_body: body,
    content_type: "application/javascript",
    initiator: null,
    duration_ms: 100,
    is_streaming: false,
    is_websocket: false,
  };
}

function makeApiRequest(): any {
  return {
    id: "req-api",
    session_id: "test-session",
    sequence: 2,
    timestamp: Date.now(),
    method: "POST",
    url: "https://example.com/api/login",
    request_headers: "{}",
    request_body: '{"user":"test"}',
    status_code: 200,
    response_headers: '{"content-type":"application/json"}',
    response_body: '{"token":"abc"}',
    content_type: "application/json",
    initiator: null,
    duration_ms: 50,
    is_streaming: false,
    is_websocket: false,
  };
}

function makeMockRepos(
  requests: any[] = [],
  hooks: any[] = [],
) {
  const requestsRepo = { findBySession: (_id: string) => requests };
  const jsHooksRepo = { findBySession: (_id: string) => hooks };
  return { requestsRepo, jsHooksRepo };
}

/**
 * Build a JS source with filler lines, inserting a given code snippet at a
 * specific line index.
 */
function buildJsBody(
  totalLines: number,
  inserts: { line: number; code: string }[],
): string {
  const lines: string[] = [];
  for (let i = 0; i < totalLines; i++) {
    const insert = inserts.find((ins) => ins.line === i);
    lines.push(insert ? insert.code : `// filler line ${i}`);
  }
  return lines.join("\n");
}

// ---- Tests ----

describe("CryptoScriptExtractor", () => {
  const SESSION = "test-session";

  // 1. Returns empty array when no JS requests exist
  describe("no JS requests", () => {
    it("should return empty array when repo only has non-JS requests", () => {
      const { requestsRepo, jsHooksRepo } = makeMockRepos([makeApiRequest()]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);
      const result = extractor.extract(SESSION);
      expect(result).toEqual([]);
    });
  });

  // 2. Returns empty array when JS has no crypto patterns
  describe("JS with no crypto patterns", () => {
    it("should return empty array when JS body has no crypto-related code", () => {
      const js = makeJsRequest(
        "https://example.com/app.js",
        'console.log("hello")\nvar x = 1;\nfunction add(a, b) { return a + b; }',
      );
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);
      const result = extractor.extract(SESSION);
      expect(result).toEqual([]);
    });
  });

  // 3. Detects Tier 1 patterns (CryptoJS)
  describe("Tier 1 detection", () => {
    it("should detect CryptoJS.AES.encrypt as tier 1", () => {
      const body = buildJsBody(10, [
        { line: 5, code: 'var encrypted = CryptoJS.AES.encrypt(data, key);' },
      ]);
      const js = makeJsRequest("https://example.com/crypto.js", body);
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].tier).toBe(1);
      expect(result[0].matchedPatterns).toContain("CryptoJS");
      expect(result[0].content).toContain("CryptoJS.AES.encrypt");
      expect(result[0].scriptUrl).toBe("https://example.com/crypto.js");
    });
  });

  // 4. Detects Tier 2 patterns (generic encrypt)
  describe("Tier 2 detection", () => {
    it("should detect function encrypt() as tier 2", () => {
      const body = buildJsBody(10, [
        { line: 4, code: "function encrypt(data) { return data ^ 0xff; }" },
      ]);
      const js = makeJsRequest("https://example.com/util.js", body);
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].tier).toBe(2);
      expect(result[0].matchedPatterns).toContain("encrypt(");
      expect(result[0].content).toContain("function encrypt(data)");
    });
  });

  // 5. Detects Tier 3 patterns (btoa)
  describe("Tier 3 detection", () => {
    it("should detect btoa() as tier 3", () => {
      const body = buildJsBody(10, [
        { line: 3, code: "var encoded = btoa(JSON.stringify(data));" },
      ]);
      const js = makeJsRequest("https://example.com/helpers.js", body);
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].tier).toBe(3);
      expect(result[0].matchedPatterns).toContain("btoa(");
      expect(result[0].content).toContain("btoa(JSON.stringify(data))");
    });
  });

  // 6. Merges overlapping ranges
  describe("merging overlapping ranges", () => {
    it("should merge two crypto patterns within 10 lines into one snippet", () => {
      // CONTEXT_LINES = 30, so two patterns 10 lines apart will have heavily
      // overlapping context windows and should merge into a single snippet.
      const body = buildJsBody(200, [
        { line: 100, code: 'var a = CryptoJS.AES.encrypt(data, key);' },
        { line: 110, code: 'var b = CryptoJS.MD5(data);' },
      ]);
      const js = makeJsRequest("https://example.com/crypto-bundle.js", body);
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      // Both patterns should be merged into a single snippet
      expect(result).toHaveLength(1);
      expect(result[0].content).toContain("CryptoJS.AES.encrypt");
      expect(result[0].content).toContain("CryptoJS.MD5");
      expect(result[0].matchedPatterns).toContain("CryptoJS");
    });
  });

  // 7. Respects budget limit
  describe("budget limit", () => {
    it("should keep total output chars within the specified budget", () => {
      // Create a large JS file with many widely-spaced tier-1 patterns so they
      // do NOT merge, each producing a snippet of ~30+ lines.
      const inserts: { line: number; code: string }[] = [];
      for (let i = 0; i < 20; i++) {
        // Space patterns 200 lines apart so context windows (30 lines each side)
        // never overlap.
        inserts.push({
          line: i * 200,
          code: `var enc${i} = CryptoJS.AES.encrypt(payload${i}, key${i});`,
        });
      }
      const body = buildJsBody(4000, inserts);
      const js = makeJsRequest("https://example.com/big-crypto.js", body);
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const tinyBudget = 500;
      const result = extractor.extract(SESSION, tinyBudget);

      const totalChars = result.reduce((sum, s) => sum + s.content.length, 0);
      // The budget allows up to budgetChars plus the "[TRUNCATED]" suffix added
      // to the last snippet, so we give a small margin.
      expect(totalChars).toBeLessThanOrEqual(tinyBudget + 20);
    });
  });

  // 8. Prioritizes by tier
  describe("tier prioritization", () => {
    it("should return Tier 1 snippets before Tier 2 snippets", () => {
      // Place tier-2 pattern in one file, tier-1 in another.
      // They should be sorted tier 1 first regardless of insertion order.
      const js1 = makeJsRequest(
        "https://example.com/tier2.js",
        buildJsBody(10, [{ line: 5, code: "function encrypt(data) { return data; }" }]),
      );
      const js2 = makeJsRequest(
        "https://example.com/tier1.js",
        buildJsBody(10, [{ line: 5, code: "CryptoJS.AES.encrypt(data, key);" }]),
      );
      // Insert tier-2 first so natural order would be wrong
      const { requestsRepo, jsHooksRepo } = makeMockRepos([js1, js2]);
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0].tier).toBe(1);
      expect(result[1].tier).toBe(2);
    });
  });

  // 9. Hook call stack correlation
  describe("hook call stack correlation", () => {
    it("should prioritize scripts referenced in hook call stacks", () => {
      // Two JS files both with tier-1 patterns. One is referenced by a crypto
      // hook's call stack and should appear first even though both are tier 1.
      const jsCorrelated = makeJsRequest(
        "https://example.com/js/api.js",
        buildJsBody(10, [{ line: 5, code: "crypto.subtle.encrypt(algo, key, data);" }]),
      );
      const jsOther = makeJsRequest(
        "https://example.com/js/other.js",
        buildJsBody(10, [{ line: 5, code: "CryptoJS.AES.encrypt(data, key);" }]),
      );

      const hooks = [
        {
          id: 1,
          session_id: SESSION,
          timestamp: Date.now(),
          hook_type: "crypto" as const,
          function_name: "encrypt",
          arguments: "{}",
          result: null,
          call_stack:
            "at encrypt (https://example.com/js/api.js:142:15)\n" +
            "at processData (https://example.com/js/api.js:200:5)",
          related_request_id: null,
        },
      ];

      const { requestsRepo, jsHooksRepo } = makeMockRepos(
        [jsOther, jsCorrelated],
        hooks,
      );
      const extractor = new CryptoScriptExtractor(requestsRepo as any, jsHooksRepo as any);

      const result = extractor.extract(SESSION);

      expect(result.length).toBeGreaterThanOrEqual(2);
      // The correlated script should come first because hookCorrelation is higher
      expect(result[0].scriptUrl).toBe("https://example.com/js/api.js");
      expect(result[1].scriptUrl).toBe("https://example.com/js/other.js");
    });
  });
});
