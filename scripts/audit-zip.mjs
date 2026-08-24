import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

const outputDirectory = path.resolve(".output");
const requestedArtifact = process.argv[2];
const artifact = requestedArtifact
  ? path.resolve(requestedArtifact)
  : path.join(
      outputDirectory,
      (await readdir(outputDirectory)).find((name) =>
        /^speak-o-0\.1\.0-chrome\.zip$/.test(name),
      ) ?? "",
    );
if (!artifact.endsWith(".zip"))
  throw new Error("Store ZIP artifact was not found.");

const archive = unzipSync(new Uint8Array(await readFile(artifact)));
const names = Object.keys(archive).sort();
const text = (name) => strFromU8(archive[name]);
const manifest = JSON.parse(text("manifest.json"));

const expectedPermissions = [
  "activeTab",
  "contextMenus",
  "offscreen",
  "scripting",
  "storage",
  "tts",
];
const expectedOrigins = [
  "https://api.elevenlabs.io/*",
  "https://api.us.elevenlabs.io/*",
  "https://api.eu.residency.elevenlabs.io/*",
  "https://api.in.residency.elevenlabs.io/*",
  "https://api.sg.residency.elevenlabs.io/*",
];
const equalSet = (actual, expected) =>
  JSON.stringify([...(actual ?? [])].sort()) ===
  JSON.stringify([...expected].sort());

if (
  manifest.manifest_version !== 3 ||
  manifest.minimum_chrome_version !== "124"
) {
  throw new Error("Manifest platform contract changed.");
}
if (!equalSet(manifest.permissions, expectedPermissions)) {
  throw new Error(`Unexpected required permissions: ${manifest.permissions}`);
}
if (!equalSet(manifest.optional_host_permissions, expectedOrigins)) {
  throw new Error("Unexpected optional provider origins.");
}
if (manifest.host_permissions || manifest.content_scripts) {
  throw new Error(
    "Store build must not contain persistent hosts or content scripts.",
  );
}
if (manifest.incognito !== "not_allowed") {
  throw new Error("Incognito must remain unavailable in 0.1.0.");
}
if (
  manifest.content_security_policy?.extension_pages !==
  "script-src 'self'; object-src 'self'"
) {
  throw new Error("Extension CSP permits an unexpected code source.");
}

for (const required of [
  "legal/LICENSE.txt",
  "legal/NOTICE.txt",
  "legal/PRIVACY.txt",
  "legal/THIRD_PARTY_NOTICES.txt",
  "icon/16.png",
  "icon/32.png",
  "icon/48.png",
  "icon/128.png",
]) {
  if (!names.includes(required))
    throw new Error(`Release file is missing: ${required}`);
}

const forbiddenPath =
  /(^|\/)(node_modules|tests?|fixtures?|scripts?|\.git|\.github)(\/|$)|\.(map|ts|tsx|env|log)$/i;
const forbiddenName = /(original.*x|x.*capture|credential|secret|api[-_]?key)/i;
for (const name of names) {
  if (forbiddenPath.test(name) || forbiddenName.test(name)) {
    throw new Error(`Development or sensitive file in Store ZIP: ${name}`);
  }
}

const executableText = names
  .filter((name) => /\.(?:js|html)$/i.test(name))
  .map((name) => `${name}\n${text(name)}`)
  .join("\n");
const allText = names
  .filter((name) => /\.(?:js|html|json|css|txt)$/i.test(name))
  .map((name) => text(name))
  .join("\n");

for (const pattern of [
  /<script[^>]+src=["']https?:/i,
  /importScripts\s*\(\s*["']https?:/i,
  /import\s*\(\s*["']https?:/i,
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
]) {
  if (pattern.test(executableText))
    throw new Error(`Remote or dynamic code pattern: ${pattern}`);
}
for (const pattern of [
  /sk_[A-Za-z0-9_-]{20,}/,
  /xi-api-key["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}/i,
  /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/,
]) {
  if (pattern.test(allText))
    throw new Error(`Credential material pattern: ${pattern}`);
}

console.log(
  `Audited ${path.basename(artifact)}: ${names.length} files, permissions and code sources accepted.`,
);
