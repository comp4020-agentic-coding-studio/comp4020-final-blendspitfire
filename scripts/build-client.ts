#!/usr/bin/env node
import { build } from "esbuild";

await build({
  entryPoints: { bundle: "client/main.ts", gallery: "client/gallery.ts" },
  bundle: true,
  outdir: "public",
  format: "esm",
  target: "es2022",
  sourcemap: true,
  logLevel: "info",
});
