#!/usr/bin/env node
/**
 * Does the Android build link Google Mobile Services?
 *
 * Huawei devices sold since 2019 ship without GMS, so the AppGallery build must
 * link none of it (see docs/HUAWEI.md). Three things looked like they enforced
 * that and none of them did:
 *
 *   - app.config.ts leaves the `expo-notifications` config *plugin* out of the
 *     huawei channel. A config plugin only edits the native project; the native
 *     module is linked because the package is installed, so leaving the plugin
 *     out changes nothing about what Gradle pulls in.
 *   - `npm run prebuild:huawei` and `build:huawei` never ran `strip:gms`, the
 *     one step that does remove it.
 *   - CI bundles the huawei channel with `expo export` under a comment about
 *     Play Services. That produces a JavaScript bundle and never reaches
 *     Gradle, so it cannot see a native dependency either way.
 *
 * Measured at the time of writing: of 21 packages in the mobile app's
 * dependency closure that ship Android code, exactly one declares GMS —
 * expo-notifications, `com.google.firebase:firebase-messaging:24.0.1`.
 *
 * Two modes:
 *
 *   check-gms.mjs           Allowed-set mode. Passes while the only GMS-bearing
 *                           packages are the ones named below, which is the
 *                           state of the Play build. For CI: a newly added
 *                           dependency that drags in Maps, FCM or Play location
 *                           fails the day it lands, rather than at AppGallery
 *                           review.
 *   check-gms.mjs --none     Nothing GMS-bearing may be linked at all. This is
 *                           the Huawei build's precondition.
 *
 * Both read what would actually be linked: the Expo autolinking resolution plus
 * every package in the app's dependency closure that ships an `android/`
 * directory, which is what catches React Native community modules too — they
 * link through a different mechanism and Expo's resolver does not list them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MOBILE = join(REPO, 'apps', 'mobile');
const MODULES = join(REPO, 'node_modules');

/**
 * Packages allowed to carry GMS, with what they carry it for. These ship in the
 * Play Store build and must be out of the Huawei one.
 */
const ALLOWED = new Map([['expo-notifications', 'Firebase Cloud Messaging, for Expo push']]);

const GMS = /(com\.google\.android\.gms|com\.google\.firebase|play-services|google-services)/i;

function packageDeps(packageJsonPath) {
  try {
    return Object.keys(JSON.parse(readFileSync(packageJsonPath, 'utf8')).dependencies ?? {});
  } catch {
    return [];
  }
}

/** Every package the mobile app can reach through its dependencies. */
function dependencyClosure() {
  const seen = new Set();
  const queue = packageDeps(join(MOBILE, 'package.json'));
  while (queue.length > 0) {
    const name = queue.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    queue.push(...packageDeps(join(MODULES, name, 'package.json')));
  }
  return seen;
}

/** What Expo would autolink for Android, which may include hoisted packages. */
function autolinkedPackages() {
  try {
    const out = execFileSync(
      'npx',
      ['--no-install', 'expo-modules-autolinking', 'resolve', '-p', 'android', '--json'],
      { cwd: MOBILE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return JSON.parse(out).modules.map((m) => m.packageName);
  } catch {
    // Not fatal: the closure below is the broader of the two sources. Say so
    // rather than passing quietly on half a check.
    console.warn(
      'check-gms: could not run expo-modules-autolinking; checking the dependency closure only',
    );
    return [];
  }
}

function gradleFiles(dir, found = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'build' || entry.name === '.gradle') continue;
      gradleFiles(path, found);
    } else if (entry.name.endsWith('.gradle') || entry.name.endsWith('.gradle.kts')) {
      found.push(path);
    }
  }
  return found;
}

/** Where a package declares GMS, if it does. */
function gmsReferences(packageName) {
  const androidDir = join(MODULES, packageName, 'android');
  if (!existsSync(androidDir) || !statSync(androidDir).isDirectory()) return [];
  const hits = [];
  for (const file of gradleFiles(androidDir)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const text = line.trim();
      if (!text || text.startsWith('//') || text.startsWith('*')) return;
      if (GMS.test(text)) {
        hits.push(`${relative(MODULES, file)}:${i + 1}: ${text}`);
      }
    });
  }
  return hits;
}

const requireNone = process.argv.includes('--none');
const candidates = new Set([...dependencyClosure(), ...autolinkedPackages()]);
const withGms = new Map();
for (const name of [...candidates].sort()) {
  const hits = gmsReferences(name);
  if (hits.length > 0) withGms.set(name, hits);
}

const scanned = `${candidates.size} packages in the mobile dependency closure`;

if (requireNone) {
  if (withGms.size === 0) {
    console.log(`check-gms: nothing links Google Mobile Services (${scanned}).`);
    process.exit(0);
  }
  console.error('\ncheck-gms: this build would link Google Mobile Services.\n');
  for (const [name, hits] of withGms) {
    console.error(`  ${name}`);
    for (const hit of hits) console.error(`      ${hit}`);
  }
  console.error(
    '\nHuawei devices have no GMS, so the AppGallery build must link none of it.\n' +
      'Remove the dependency first:\n\n' +
      '    npm run strip:gms\n\n' +
      'Reinstall it when you go back to the Play build. Leaving a config plugin\n' +
      'out of the channel is not enough — the module is linked because the\n' +
      'package is installed. See docs/HUAWEI.md.\n',
  );
  process.exit(1);
}

const unexpected = [...withGms.keys()].filter((name) => !ALLOWED.has(name));
if (unexpected.length === 0) {
  const listed = [...withGms.keys()].map((n) => `${n} (${ALLOWED.get(n)})`);
  console.log(
    `check-gms: ${scanned} scanned; GMS only where expected` +
      (listed.length > 0 ? `: ${listed.join(', ')}.` : '.'),
  );
  process.exit(0);
}

console.error('\ncheck-gms: a new dependency brought in Google Mobile Services.\n');
for (const name of unexpected) {
  console.error(`  ${name}`);
  for (const hit of withGms.get(name)) console.error(`      ${hit}`);
}
console.error(
  '\nThis breaks the Huawei build, which must link no GMS (docs/HUAWEI.md).\n' +
    'Either drop the dependency, or — if the Play build genuinely needs it and\n' +
    'the Huawei build can do without — add it to ALLOWED in this script and to\n' +
    "the strip:gms script, so the AppGallery build removes it too.\n",
);
process.exit(1);
