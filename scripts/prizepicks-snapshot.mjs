#!/usr/bin/env node
/**
 * Pull live PrizePicks board and persist an append-only snapshot to S3 + local disk.
 *
 *   npm run prizepicks:snapshot
 *   npm run prizepicks:snapshot -- --local-only
 */
import path from "path";
import { loadEnvFile, root } from "./env-lib.mjs";

loadEnvFile(".env.local");
loadEnvFile("../Dropflow/.env.local", { override: false });
loadEnvFile("../Statics/.env.local", { override: false });

function hasFlag(argv, name) {
  return argv.includes(name);
}

async function main() {
  const argv = process.argv.slice(2);
  const localOnly = hasFlag(argv, "--local-only");

  const { fetchPrizePicksProjections, PrizePicksApiError } = await import(
    "../src/lib/prizepicks/index.ts"
  );
  const { persistPrizePicksBoardSnapshot } = await import(
    "../src/lib/quant-research/prizepicks-snapshot.ts"
  );
  const { config } = await import("../src/lib/config.ts");
  const { awsCredentialsConfigured } = await import("../src/lib/dropflow-env.ts");

  console.log("PrizePicks quant snapshot");
  console.log(`  bucket:   ${config.dropflow.bucket}`);
  console.log(`  awsCreds: ${awsCredentialsConfigured() ? "yes" : "no (SDK default chain)"}`);
  console.log(`  mode:     ${localOnly ? "local-only" : "s3 + local"}`);
  console.log("");

  const started = Date.now();
  try {
    const result = await fetchPrizePicksProjections({
      forceLive: true,
      disallowCacheFallback: true,
    });
    const persisted = await persistPrizePicksBoardSnapshot(result, {
      localOnly,
      rootDir: root,
    });
    const ms = Date.now() - started;
    const { snapshot, s3Key, localPath } = persisted;

    console.log(`OK  ${snapshot.projectionCount} props  ${snapshot.leagueCount} leagues  ${ms}ms`);
    console.log(`    observedAt  ${snapshot.observedAt}`);
    console.log(`    fetchedAt   ${snapshot.fetchedAt}`);
    if (s3Key) {
      console.log(`    s3         s3://${config.dropflow.bucket}/${s3Key}`);
      console.log(`    latest     s3://${config.dropflow.bucket}/quant/prizepicks/snapshots/latest.json`);
    } else {
      console.log("    s3         (skipped)");
    }
    if (localPath) {
      console.log(`    local      ${path.relative(root, localPath)}`);
    }
  } catch (err) {
    const ms = Date.now() - started;
    const message = err instanceof Error ? err.message : String(err);
    const status = err instanceof PrizePicksApiError ? err.statusCode : undefined;
    console.error(`FAIL after ${ms}ms${status ? `  HTTP ${status}` : ""}`);
    console.error(`  ${message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
