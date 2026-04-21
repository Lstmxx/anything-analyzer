import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("macOS 发布工作流", () => {
  it("应该在同一个 macOS 构建中产出 x64 和 arm64 更新元数据", () => {
    const workflow = readWorkspaceFile(".github/workflows/build.yml");

    expect(workflow).toContain("platform: mac");
    expect(workflow).toContain("npx electron-builder --mac --x64 --arm64 --publish never");
    expect(workflow).toContain("grep -q 'arm64\\.zip' dist/latest-mac.yml");
    expect(workflow).toContain("grep -q 'x64\\.zip' dist/latest-mac.yml");
  });

  it("应该强制校验 macOS 代码签名 secrets", () => {
    const workflow = readWorkspaceFile(".github/workflows/build.yml");

    expect(workflow).toContain("${{ secrets.CSC_LINK }}");
    expect(workflow).toContain("${{ secrets.CSC_KEY_PASSWORD }}");
    expect(workflow).toContain("${{ secrets.APPLE_ID }}");
    expect(workflow).toContain("${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}");
    expect(workflow).toContain("${{ secrets.APPLE_TEAM_ID }}");
    expect(workflow).toContain("codesign --verify --deep --strict --verbose=2");
  });

  it("应该为 macOS 构建启用 hardened runtime 和 entitlements", () => {
    const builderConfig = readWorkspaceFile("electron-builder.yml");

    expect(builderConfig).toContain("hardenedRuntime: true");
    expect(builderConfig).toContain("gatekeeperAssess: false");
    expect(builderConfig).toContain("type: distribution");
    expect(builderConfig).toContain("entitlements: resources/entitlements.mac.plist");
    expect(builderConfig).toContain("entitlementsInherit: resources/entitlements.mac.plist");
  });

  it("应该提供 Electron 所需的 macOS entitlements", () => {
    const entitlements = readWorkspaceFile("resources/entitlements.mac.plist");

    expect(entitlements).toContain("com.apple.security.cs.allow-jit");
    expect(entitlements).toContain("com.apple.security.cs.allow-unsigned-executable-memory");
    expect(entitlements).toContain("com.apple.security.cs.disable-library-validation");
  });
});