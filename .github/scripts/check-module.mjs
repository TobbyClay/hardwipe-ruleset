// Checks that need no Foundry: run from the repository root with `node .github/scripts/check-module.mjs`.
// - module.json parses, and every file it lists exists.
// - Every language file it lists parses, and no key is also the start of another key: Foundry nests dotted keys, so
//   "A.B" next to "A.B.c" makes it drop the whole file and every string shows as its key.
// - Every module path written in the scripts (modules/hardwipe-ruleset/... or modules/${MODULE_ID}/...) exists.
// File names are compared exactly, case included: Foundry servers on Linux are case-sensitive even when the
// computer the module was written on is not.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const problems = [];

/** Whether a repository-relative path exists, with every segment spelt exactly as on disk. */
function existsExact(relative) {
  let dir = root;
  for (const segment of relative.split("/").filter(Boolean)) {
    let names;
    try { names = readdirSync(dir); } catch { return false; }
    if (!names.includes(segment)) return false;
    dir = join(dir, segment);
  }
  return true;
}

function readJSON(relative) {
  try { return JSON.parse(readFileSync(join(root, relative), "utf8")); }
  catch (error) { problems.push(`${relative}: ${error.message}`); return null; }
}

/** Every .js file under a directory, as repository-relative paths. */
function scriptsUnder(relative) {
  const out = [];
  for (const name of readdirSync(join(root, relative))) {
    const path = `${relative}/${name}`;
    if (statSync(join(root, path)).isDirectory()) out.push(...scriptsUnder(path));
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

const manifest = readJSON("module.json");
if (manifest) {
  const listed = [
    ...(manifest.esmodules ?? []), ...(manifest.scripts ?? []), ...(manifest.styles ?? []),
    ...(manifest.languages ?? []).map(language => language.path)
  ];
  for (const path of listed) if (!existsExact(path)) problems.push(`module.json lists ${path}, which does not exist`);

  for (const { path } of manifest.languages ?? []) {
    const strings = existsExact(path) ? readJSON(path) : null;
    if (!strings) continue;
    const keys = Object.keys(strings);
    const all = new Set(keys);
    for (const key of keys) {
      const nested = [...all].find(other => other.startsWith(`${key}.`));
      if (nested) problems.push(`${path}: "${key}" is a string and also the start of "${nested}"`);
    }
  }

  const id = manifest.id;
  const reference = new RegExp(`modules/(?:${id}|\\$\\{MODULE_ID\\})/([A-Za-z0-9_./-]+)`, "g");
  for (const file of [...scriptsUnder("scripts"), ...(manifest.scripts ?? [])]) {
    const source = readFileSync(join(root, file), "utf8");
    for (const [, path] of source.matchAll(reference)) {
      if (!existsExact(path)) problems.push(`${file} refers to modules/${id}/${path}, which does not exist`);
    }
  }
}

if (problems.length) {
  for (const problem of problems) console.error(`✖ ${problem}`);
  process.exit(1);
}
console.log("✔ module.json, language files and module paths check out");
