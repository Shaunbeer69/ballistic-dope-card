const fs = require("fs");
const path = require("path");

const pkgPath = path.join(process.cwd(), "package.json");

const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

function bumpVersion(v) {
  const parts = String(v || "0.0.0").split(".");
  let major = parseInt(parts[0] || "0", 10);
  let minor = parseInt(parts[1] || "0", 10);
  let patch = parseInt(parts[2] || "0", 10);

  // increment patch
  patch++;

  // rollover patch → minor
  if (patch >= 100) {
    patch = 0;
    minor++;
  }

  // rollover minor → major
  if (minor >= 100) {
    minor = 0;
    major++;
  }

  return `${major}.${minor}.${patch}`;
}

pkg.version = bumpVersion(pkg.version);

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");

console.log("✅ package.json version bumped to:", pkg.version);
