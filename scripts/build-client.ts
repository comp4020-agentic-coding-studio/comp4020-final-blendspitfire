#!/usr/bin/env node
import { build } from "esbuild";

await build({
  entryPoints: ["client/main.ts"],
  bundle: true,
  outfile: "public/bundle.js",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});
