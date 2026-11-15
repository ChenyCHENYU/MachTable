/** seatbelt 中启动浏览器会触发 macOS 系统拒绝；必须在启动前中止。 */
export default function checkBrowserEnvironment(): void {
  if (process.platform === "darwin" && process.env.CODEX_SANDBOX === "seatbelt") {
    throw new Error(
      "macOS Codex seatbelt cannot launch a test browser. Run this exact Playwright command through exec_command with sandbox_permissions=require_escalated; do not remove CODEX_SANDBOX or use --no-sandbox."
    );
  }
}
