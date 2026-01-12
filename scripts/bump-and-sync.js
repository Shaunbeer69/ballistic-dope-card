const fs = require("fs");
const path = require("path");

const root = process.cwd();
const pkgPath = path.join(root, "package.json");
const versionTsPath = path.join(root, "src", "app", "environments", "version.ts");
const gradlePath = path.join(root, "android", "app", "build.gradle"); // default Capacitor path

function bumpPatch(v) {
  const parts = String(v || "0.0.0").split(".");
  const a = parseInt(parts[0] || "0", 10);
  const b = parseInt(parts[1] || "0", 10);
  const c = parseInt(parts[2] || "0", 10) + 1;
  return `${a}.${b}.${c}`;
}

// 1) bump package.json
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const oldV = pkg.version || "0.0.0";
const newV = bumpPatch(oldV);
pkg.version = newV;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
console.log(`✅ package.json: ${oldV} -> ${newV}`);

// 2) write version.ts used by your UI
const versionTs = `// AUTO-GENERATED. DO NOT EDIT.\nexport const APP_VERSION = "${newV}";\n`;
fs.mkdirSync(path.dirname(versionTsPath), { recursive: true });
fs.writeFileSync(versionTsPath, versionTs, "utf8");
console.log(`✅ wrote ${path.relative(root, versionTsPath)} = ${newV}`);

// 3) update Android build.gradle (versionName + versionCode)
if (fs.existsSync(gradlePath)) {
  const [A, B, C] = newV.split(".").map(n => parseInt(n, 10) || 0);
  const versionCode = (A * 10000) + (B * 100) + C;

  let g = fs.readFileSync(gradlePath, "utf8");

  if (!/versionName\s+"[^"]*"/.test(g)) console.log("⚠️ versionName not found in build.gradle");
  if (!/versionCode\s+\d+/.test(g)) console.log("⚠️ versionCode not found in build.gradle");

  g = g.replace(/versionName\s+"[^"]*"/, `versionName "${newV}"`);
  g = g.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);

  fs.writeFileSync(gradlePath, g, "utf8");
  console.log(`✅ Android build.gradle: versionName=${newV}, versionCode=${versionCode}`);
} else {
  console.log("⚠️ android/app/build.gradle not found - skipped Android version update");
}
