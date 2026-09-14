const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.startsWith("pnpm/")) {
  console.error(
    "MachTable workspace packages must be published with pnpm so workspace dependencies are resolved in the registry artifact."
  );
  process.exitCode = 1;
}
