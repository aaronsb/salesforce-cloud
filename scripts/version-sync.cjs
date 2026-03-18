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
