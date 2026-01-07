const fs = require("fs");
const path = require("path");

const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const version = pkg.version || "0.0.0";

const outPath = path.join(__dirname, "..", "src", "app", "environments", "version.ts");
const contents = `// AUTO-GENERATED. Do not edit manually.
export const APP_VERSION = '${version}';
`;

fs.writeFileSync(outPath, contents, "utf8");
console.log("✔ Version written:", version);
