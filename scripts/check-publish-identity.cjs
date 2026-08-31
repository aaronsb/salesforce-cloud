#!/usr/bin/env node
// Asserts the release identity is coherent before anything publishes: the tag,
// package.json, server.json, and both manifests must name ONE version, and
// server.json must point at the npm package this repo actually publishes.
//
// version-sync.cjs writes only version fields, so a renamed npm package with a
// stale server.json identifier passes every version check and publishes a
// registry entry naming the wrong tarball. This script is the one place the
// whole invariant lives; both release workflows and the Makefile fallback
// call it, so a future change to the tag scheme has one file to edit.
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');

const tag = process.argv[2];
if (!tag || !/^v\d/.test(tag)) {
  console.error(`usage: check-publish-identity.cjs vX.Y.Z (got ${tag || 'nothing'})`);
  process.exit(1);
}
const version = tag.slice(1);

const pkg = require(path.join(root, 'package.json'));
const server = require(path.join(root, 'server.json'));
const manifest = require(path.join(root, 'manifest.json'));
const mcpbManifest = require(path.join(root, 'mcpb', 'manifest.json'));

const failures = [];
const expect = (what, actual) => {
  if (actual !== version) failures.push(`${what} is ${actual}, tag says ${version}`);
};
expect('package.json version', pkg.version);
expect('server.json version', server.version);
expect('server.json packages[0].version', server.packages[0].version);
expect('manifest.json version', manifest.version);
expect('mcpb/manifest.json version', mcpbManifest.version);
if (server.packages[0].identifier !== pkg.name) {
  failures.push(
    `server.json packages[0].identifier is ${server.packages[0].identifier}, package.json name is ${pkg.name}`
  );
}
// The MCP Registry rejects descriptions over 100 characters with a 422 — after
// npm has already published, leaving the channels half-released (v0.8.1).
const descLen = [...(server.description || '')].length;
if (descLen > 100) {
  failures.push(`server.json description is ${descLen} characters; the MCP Registry caps it at 100`);
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FATAL: ${f}`);
  console.error("Run 'make version-sync' and commit the result.");
  process.exit(1);
}
console.log(`${pkg.name}@${version}: tag, package.json, server.json, and manifests agree`);
