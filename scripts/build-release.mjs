// Build the GitHub Release assets into dist/ without publishing.
//
//   node scripts/build-release.mjs
//
// Assets intentionally carry no version in their names: latest/download/X is
// only a redirect to download/<latest-tag>/X, so the same file serves both
// "get latest" and "pin a version" — the install scripts never have to
// discover a version number first.
//
// The tarball is the tested npm pack output (test/pack.test.mjs pins which
// files must ship), renamed to a stable name. checksums.txt uses the
// coreutils `sha256sum` format both install scripts parse.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL("../", import.meta.url)));
const dist = path.join(root, "dist");
const asset = "scenemint-canvas.tar.gz";

const run = (file, args) =>
  execFileSync(file, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

// npm pack validates the same file contract test/pack.test.mjs enforces and
// gives the archive its `package/` root. --ignore-scripts: packing must never
// execute package lifecycle code.
const out = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", dist]);
const packed = JSON.parse(out);
const tgz = packed[0].filename;
if (!tgz.endsWith(".tgz")) throw new Error(`unexpected npm pack output: ${tgz}`);
await fs.rename(path.join(dist, tgz), path.join(dist, asset));

const bytes = await fs.readFile(path.join(dist, asset));
const sum = createHash("sha256").update(bytes).digest("hex");
// Two spaces, then the bare name: coreutils format, parseable by awk in
// install.sh and by the ps1 splitter.
await fs.writeFile(path.join(dist, "checksums.txt"), `${sum}  ${asset}\n`);

console.log(`✅ ${asset} (${(bytes.length / 1024).toFixed(1)} KiB)`);
console.log(`✅ checksums.txt`);
console.log("检查资产名不含版本号，且归档内带 skills/scenemint-canvas/SKILL.md：");
console.log("  tar -tzf dist/" + asset + " | grep SKILL.md");
