import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
if (!existsSync("dist/server/wrangler.json"))
  throw new Error(
    "Execute npm run build antes de aplicar as migrações locais.",
  );
const args = [
  "--import",
  "./scripts/sites-env.mjs",
  "./node_modules/wrangler/bin/wrangler.js",
  "d1",
  "migrations",
  "apply",
  "DB",
  "--local",
  "--config",
  "dist/server/wrangler.json",
  "--persist-to",
  ".wrangler/state",
];
const result = spawnSync(process.execPath, args, {
  stdio: ["pipe", "inherit", "inherit"],
  input: "y\n",
  env: { ...process.env, CI: "true" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
