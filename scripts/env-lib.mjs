import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadEnvFile(filePath, { override = false } = {}) {
  const resolved = path.resolve(root, filePath);
  if (!fs.existsSync(resolved)) return;
  for (const line of fs.readFileSync(resolved, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (override || process.env[key] === undefined) process.env[key] = value;
  }
}
