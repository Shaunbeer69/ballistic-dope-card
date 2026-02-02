const fs = require("fs");
const path = require("path");

function rmMatching(dir, prefix, suffix) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (f.startsWith(prefix) && f.endsWith(suffix)) {
      try { fs.unlinkSync(path.join(dir, f)); } catch {}
    }
  }
}

function copyOrFail(src, dst) {
  if (!fs.existsSync(src)) {
    console.error("❌ Build artifact not found:", src);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log("✅ Deliverable:", dst);
}

const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const v = String(pkg.version || "0.0.0").trim();

const mode = (process.argv[2] || "debug").toLowerCase();
const prefix = "GS_DopeCard-v";
const namePrefix = `${prefix}${v}-`;

if (mode === "debug") {
  const dir = path.join(root, "android", "app", "build", "outputs", "apk", "debug");
  const src = path.join(dir, "app-debug.apk");                 // keep this for Android Studio
  const dst = path.join(dir, `${namePrefix}debug.apk`);        // your deliverable

  rmMatching(dir, prefix, "-debug.apk");                       // remove older deliverables only
  copyOrFail(src, dst);
  process.exit(0);
}

if (mode === "release-aab") {
  const dir = path.join(root, "android", "app", "build", "outputs", "bundle", "release");
  const src = path.join(dir, "app-release.aab");
  const dst = path.join(dir, `${namePrefix}release.aab`);

  rmMatching(dir, prefix, "-release.aab");
  copyOrFail(src, dst);
  process.exit(0);
}

if (mode === "release-apk") {
  const dir = path.join(root, "android", "app", "build", "outputs", "apk", "release");
  const src = path.join(dir, "app-release.apk");
  const dst = path.join(dir, `${namePrefix}release.apk`);

  rmMatching(dir, prefix, "-release.apk");
  copyOrFail(src, dst);
  process.exit(0);
}

console.error("❌ Unknown mode. Use: debug | release-apk | release-aab");
process.exit(1);
