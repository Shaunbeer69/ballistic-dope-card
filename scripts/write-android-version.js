const fs = require('fs');
const path = require('path');

const pkg = require(path.join(process.cwd(), 'package.json'));
const versionName = pkg.version;

// simple versionCode: yyyymmddHH (good enough for internal builds)
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const versionCode =
  Number(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}`);

const gradlePath = path.join(process.cwd(), 'android', 'app', 'build.gradle');

let gradle = fs.readFileSync(gradlePath, 'utf8');

gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`);

if (gradle.match(/versionCode\s+\d+/)) {
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
} else {
  throw new Error('Could not find versionCode in android/app/build.gradle');
}

fs.writeFileSync(gradlePath, gradle, 'utf8');

console.log(`Android versionName=${versionName} versionCode=${versionCode}`);
