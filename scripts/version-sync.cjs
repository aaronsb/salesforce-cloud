#!/usr/bin/env node
const fs = require("fs");
const v = require("../package.json").version;

for (const f of ["server.json", "manifest.json", "mcpb/manifest.json"]) {
  const j = JSON.parse(fs.readFileSync(f, "utf8"));
  j.version = v;
  if (j.packages) for (const p of Object.values(j.packages)) p.version = v;
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + "\n");
  console.log("  " + f + " → " + v);
}

// src/version.ts is compiled into the server — the mcpb bundle strips
// package.json, so the version can't be read at runtime and must be baked in.
const versionTs = "src/version.ts";
const src = fs.readFileSync(versionTs, "utf8");
const updated = src.replace(
  /^export const VERSION = '.*';$/m,
  `export const VERSION = '${v}';`
);
if (updated === src && !src.includes(`export const VERSION = '${v}';`)) {
  console.error(`  ${versionTs} → FAILED: could not find the VERSION export to rewrite`);
  process.exit(1);
}
fs.writeFileSync(versionTs, updated);
console.log("  " + versionTs + " → " + v);
