const fs = require("fs");
const path = require("path");

const pkgPath = path.join(process.cwd(), "package.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

function bumpPatch(v) {
  const parts = String(v || "0.0.0").split(".");
  const a = parseInt(parts[0] || "0", 10);
  const b = parseInt(parts[1] || "0", 10);
  const c = parseInt(parts[2] || "0", 10) + 1;
  return `${a}.${b}.${c}`;
}

pkg.version = bumpPatch(pkg.version);

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log("✅ package.json version bumped to:", pkg.version);
