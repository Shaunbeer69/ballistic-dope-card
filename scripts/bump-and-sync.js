const fs = require("fs");
const path = require("path");

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const versionTsPath = path.join(root, "src", "app", "environments", "version.ts");

function bumpVersion(v) {
  const parts = String(v || "0.0.0").split(".");
  let major = parseInt(parts[0] || "0", 10);
  let minor = parseInt(parts[1] || "0", 10);
  let patch = parseInt(parts[2] || "0", 10);

  patch++;

  // rollover AFTER 100
  if (patch > 100) {
    patch = 0;
    minor++;
  }

  if (minor >= 100) {
    minor = 0;
    major++;
  }

  return `${major}.${minor}.${patch}`;
}

// 1) bump package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const oldV = pkg.version || "0.0.0";
const newV = bumpVersion(oldV);

pkg.version = newV;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`✅ package.json: ${oldV} -> ${newV}`);

// 2) write version.ts (UI version)
const versionTs = `// AUTO-GENERATED. DO NOT EDIT.
export const APP_VERSION = "${newV}";
`;

fs.mkdirSync(path.dirname(versionTsPath), { recursive: true });
fs.writeFileSync(versionTsPath, versionTs, "utf8");
console.log(`✅ wrote ${path.relative(root, versionTsPath)} = ${newV}`);
