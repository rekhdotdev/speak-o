import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();
const lock = JSON.parse(
  await readFile(path.join(repositoryRoot, "package-lock.json"), "utf8"),
);

const packages = await Promise.all(
  Object.entries(lock.packages)
    .filter(
      ([packagePath, metadata]) =>
        packagePath.startsWith("node_modules/") && metadata.dev !== true,
    )
    .map(async ([packagePath, metadata]) => {
      const packageJson = JSON.parse(
        await readFile(
          path.join(repositoryRoot, packagePath, "package.json"),
          "utf8",
        ),
      );
      const repository =
        typeof packageJson.repository === "string"
          ? packageJson.repository
          : packageJson.repository?.url;
      return {
        name: packageJson.name ?? packagePath.replace("node_modules/", ""),
        version: metadata.version,
        license: packageJson.license ?? "See package license",
        source: packageJson.homepage ?? repository ?? "See package metadata",
      };
    }),
);

packages.sort((left, right) => left.name.localeCompare(right.name));
const notice = `# Third-party notices

Generated from the production dependency graph in \`package-lock.json\`. Build and test tooling is not shipped as executable extension code and is excluded from this runtime list.

${packages
  .map(
    (entry) =>
      `- **${entry.name}@${entry.version}** — ${entry.license} — ${entry.source}`,
  )
  .join("\n")}

Each dependency remains subject to its own license. Complete license texts are available in the locked npm packages and their linked source repositories. Speak-O itself is licensed under Apache-2.0.
`;

await writeFile(
  path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"),
  notice,
  "utf8",
);

const publicLegal = path.join(repositoryRoot, "public", "legal");
await mkdir(publicLegal, { recursive: true });
await Promise.all([
  writeFile(path.join(publicLegal, "THIRD_PARTY_NOTICES.txt"), notice, "utf8"),
  ...[
    ["LICENSE", "LICENSE.txt"],
    ["NOTICE", "NOTICE.txt"],
  ].map(async ([source, target]) =>
    writeFile(
      path.join(publicLegal, target),
      await readFile(path.join(repositoryRoot, source), "utf8"),
      "utf8",
    ),
  ),
]);
