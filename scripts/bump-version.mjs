import fs from "fs";
import path from "path";

const versionFile = path.join("src", "app", "environments", "version.ts");
const gradleFile = path.join("android", "app", "build.gradle"); // (Capacitor default)

function bumpSemver(v) {
  const [a, b, c] = v.split(".").map(n => parseInt(n, 10) || 0);
  return `${a}.${b}.${c + 1}`;
}

// 1) Update Angular version.ts (for in-app display)
if (!fs.existsSync(versionFile)) {
  throw new Error(`Missing ${versionFile}. Create it with: export const APP_VERSION = "1.0.0";`);
}

let vt = fs.readFileSync(versionFile, "utf8");
const m = vt.match(/APP_VERSION\s*=\s*"([^"]+)"/);
if (!m) throw new Error(`Could not find APP_VERSION in ${versionFile}`);

const oldV = m[1];
const newV = bumpSemver(oldV);

vt = vt.replace(/APP_VERSION\s*=\s*"[^"]+"/, `APP_VERSION = "${newV}"`);
fs.writeFileSync(versionFile, vt, "utf8");
console.log(`✅ APP_VERSION: ${oldV} -> ${newV}`);

// 2) Update Android versionName + versionCode (so App Info updates)
if (fs.existsSync(gradleFile)) {
  let g = fs.readFileSync(gradleFile, "utf8");

  // versionCode must always increase. We'll derive it from semver.
  // A.B.C => A*10000 + B*100 + C
  const [A, B, C] = newV.split(".").map(n => parseInt(n, 10) || 0);
  const newCode = (A * 10000) + (B * 100) + C;

  g = g.replace(/versionName\s+"[^"]*"/, `versionName "${newV}"`);
  g = g.replace(/versionCode\s+\d+/, `versionCode ${newCode}`);

  fs.writeFileSync(gradleFile, g, "utf8");
  console.log(`✅ Android: versionName=${newV}, versionCode=${newCode}`);
} else {
  console.log(`⚠️ Skipped Android bump: ${gradleFile} not found`);
}
