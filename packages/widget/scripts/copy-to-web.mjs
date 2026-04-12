import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(__dirname, "..");
const repoRoot = resolve(__dirname, "../..", "..");
const dist = resolve(pkgRoot, "dist/widget.js");
const destDir = resolve(repoRoot, "apps/web/public");
const dest = resolve(destDir, "widget.js");

await mkdir(destDir, { recursive: true });
await copyFile(dist, dest);
console.log("Copied widget.js to apps/web/public/widget.js");
