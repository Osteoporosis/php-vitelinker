#!/usr/bin/env node

import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
} from "node:path";
import { globSync, hasMagic } from "glob";
import { build } from "vite";
import type { InlineConfig } from "vite";

interface ManifestChunk {
  src?: string;
  file: string;
  css?: string[];
  assets?: string[];
  isEntry?: boolean;
  name?: string;
  isDynamicEntry?: boolean;
  imports?: string[]; // manifest keys
  dynamicImports?: string[];
}

interface CliOptions {
  entries: string[];
  outDirPath: string;
  prefix?: string;
  root?: string;
  configFile?: string;
}

interface EntryConfigDiscovery {
  entryFileAbs: string;
  configFileAbs?: string;
  searchedFromAbs: string;
  searchedUntilAbs: string | "(explicit --config)";
  note: string;
}

interface RootAndConfigResolution {
  rootAbs: string;
  configFile: string | false;
  discoveries: EntryConfigDiscovery[];
}

const SUPPORTED_ENTRY_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const VITE_CONFIG_BASENAMES = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
] as const;

const ANSI_BRIGHT_BLUE = "\x1b[94m";
const ANSI_RESET = "\x1b[0m";

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function warn(message: string): void {
  console.warn(message);
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function isExistingFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

function isExistingDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

function normalizePrefix(prefix: string): string {
  const value = prefix.trim();

  if (value === "") {
    return "";
  }

  if (value === ".") {
    return "./";
  }

  return value.endsWith("/") ? value : `${value}/`;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&#39;");
}

function sanitizeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function orderedUnique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    out.push(value);
  }

  return out;
}

function isCssFile(file: string): boolean {
  return /\.css(?:$|[?#])/i.test(file);
}

function isSupportedScriptEntry(file: string): boolean {
  return SUPPORTED_ENTRY_EXTENSIONS.has(extname(file).toLowerCase());
}

function joinPrefixAndFile(prefix: string, file: string): string {
  const cleanFile = file.replace(/^\/+/, "");
  return `${prefix}${cleanFile}`;
}

function parseCommandLineArgs(): CliOptions {
  const command = new Command();

  command
    .name("php-vitelinker")
    .description(
      "Runs a Vite build and generates includable PHP files based on the manifest."
    )
    .argument(
      "<entry...>",
      "Entry point files or glob patterns (.ts, .tsx, .js, .jsx, .mts, .cts, .mjs, .cjs)"
    )
    .requiredOption(
      "--outDir <path>",
      "Where built assets and generated packed__*.php files are written."
    )
    .option(
      "--prefix <path>",
      "Base URL prefix for generated tags. Usually optional. Examples: './', '/scripts/', 'https://sub.example.com/scripts/'"
    )
    .option(
      "--root <path>",
      "Vite project root. If provided, vite.config.* is searched only in this directory."
    )
    .option(
      "--config <path>",
      "Explicit Vite config file path. Overrides automatic config discovery."
    )
    .showHelpAfterError()
    .parse(process.argv);

  const options = command.opts<{
    outDir: string;
    prefix?: string;
    root?: string;
    config?: string;
  }>();

  const entries = command.args as string[];

  if (entries.length === 0) {
    fail("At least one entry point or glob pattern must be provided.");
  }

  return {
    entries,
    outDirPath: options.outDir,
    prefix: options.prefix,
    root: options.root,
    configFile: options.config,
  };
}

function expandEntries(rawEntries: readonly string[], baseAbs: string): string[] {
  const matches = new Set<string>();

  for (const rawEntry of rawEntries) {
    if (isAbsolute(rawEntry)) {
      if (hasMagic(rawEntry)) {
        for (const file of globSync(rawEntry, { nodir: true, absolute: true })) {
          matches.add(resolve(file));
        }
        continue;
      }

      if (isExistingFile(rawEntry)) {
        matches.add(resolve(rawEntry));
      }

      continue;
    }

    if (!hasMagic(rawEntry)) {
      const directFile = resolve(baseAbs, rawEntry);
      if (isExistingFile(directFile)) {
        matches.add(directFile);
        continue;
      }
    }

    for (const file of globSync(rawEntry, {
      cwd: baseAbs,
      nodir: true,
      absolute: true,
    })) {
      matches.add(resolve(file));
    }
  }

  return Array.from(matches).sort((a, b) => a.localeCompare(b));
}

function assertSupportedEntries(entryFiles: readonly string[]): void {
  const unsupported = entryFiles.filter((file) => !isSupportedScriptEntry(file));

  if (unsupported.length === 0) {
    return;
  }

  fail(
    [
      "This tool intentionally supports JS/TS script entries only.",
      "CSS entry files are out of scope by design.",
      "Unsupported entries:",
      ...unsupported.map((file) => `  - ${file}`),
    ].join("\n")
  );
}

function resolveManifestPath(outDirAbs: string): string {
  const candidates = [
    resolve(outDirAbs, ".vite/manifest.json"),
    resolve(outDirAbs, "manifest.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  fail(
    `Could not find a Vite manifest in "${outDirAbs}". Looked for: ${candidates.join(", ")}`
  );
}

function safePhpFileName(entryKey: string, entry: ManifestChunk): string {
  const sourceLikeKey =
    entry.src && entry.src.trim().length > 0 ? entry.src : entryKey;
  const originalBaseName = basename(sourceLikeKey, extname(sourceLikeKey));

  return `packed__${sanitizeFilePart(originalBaseName)}.php`;
}

function collectStaticImportedChunks(
  manifest: Record<string, ManifestChunk>,
  entryKey: string
): Array<{ key: string; chunk: ManifestChunk }> {
  const visited = new Set<string>();
  const result: Array<{ key: string; chunk: ManifestChunk }> = [];

  function visit(key: string): void {
    if (visited.has(key)) {
      return;
    }
    visited.add(key);

    const chunk = manifest[key];
    if (!chunk) {
      warn(`Warning: manifest is missing key referenced by imports: "${key}"`);
      return;
    }

    for (const importedKey of chunk.imports ?? []) {
      visit(importedKey);
    }

    if (key !== entryKey) {
      result.push({ key, chunk });
    }
  }

  visit(entryKey);
  return result;
}

function buildTagsForEntry(params: {
  manifest: Record<string, ManifestChunk>;
  entryKey: string;
  entryChunk: ManifestChunk;
  importedChunks: Array<{ key: string; chunk: ManifestChunk }>;
  prefix: string;
}): string {
  const { entryKey, entryChunk, importedChunks, prefix } = params;

  if (isCssFile(entryChunk.file)) {
    fail(
      `CSS entry output is not supported by this tool. Offending manifest entry: "${entryKey}" -> "${entryChunk.file}"`
    );
  }

  const entryCss = entryChunk.css ?? [];
  const importedCss = importedChunks.flatMap(({ chunk }) => chunk.css ?? []);
  const cssFiles = orderedUnique([...entryCss, ...importedCss]);

  const modulePreloadFiles = orderedUnique(
    importedChunks
      .map(({ chunk }) => chunk.file)
      .filter((file) => !isCssFile(file))
  );

  const lines: string[] = [];

  for (const cssFile of cssFiles) {
    lines.push(
      `<link rel="stylesheet" href="${escapeHtmlAttr(
        joinPrefixAndFile(prefix, cssFile)
      )}" />`
    );
  }

  lines.push(
    `<script type="module" src="${escapeHtmlAttr(
      joinPrefixAndFile(prefix, entryChunk.file)
    )}"></script>`
  );

  for (const file of modulePreloadFiles) {
    lines.push(
      `<link rel="modulepreload" href="${escapeHtmlAttr(
        joinPrefixAndFile(prefix, file)
      )}" />`
    );
  }

  return `${lines.join("\n")}\n`;
}

function writePhpFiles(prefix: string, outDirAbs: string): void {
  const manifestPath = resolveManifestPath(outDirAbs);
  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf-8")
  ) as Record<string, ManifestChunk>;

  const entries = Object.entries(manifest).filter(
    ([, chunk]) => chunk.isEntry === true
  );

  if (entries.length === 0) {
    warn(
      `No manifest entries with "isEntry: true" were found in "${manifestPath}". Nothing to generate.`
    );
    return;
  }

  const seenNames = new Set<string>();

  for (const [entryKey, entryChunk] of entries) {
    const phpFileName = safePhpFileName(entryKey, entryChunk);

    if (seenNames.has(phpFileName)) {
      warn(
        `Duplicate PHP filename detected ("${phpFileName}"). The last generated file will overwrite the earlier one.`
      );
    }

    seenNames.add(phpFileName);

    const importedChunks = collectStaticImportedChunks(manifest, entryKey);
    const content = buildTagsForEntry({
      manifest,
      entryKey,
      entryChunk,
      importedChunks,
      prefix,
    });

    const phpFilePath = resolve(outDirAbs, phpFileName);
    writeFileSync(phpFilePath, content, "utf-8");

    console.log(
      `Build for "${entryKey}" completed. Include (or require) "${resolve(
        outDirAbs
      )}/${ANSI_BRIGHT_BLUE}${phpFileName}${ANSI_RESET}".`
    );
  }
}

function isPathInsideOrSame(pathAbs: string, baseAbs: string): boolean {
  const rel = relative(resolve(baseAbs), resolve(pathAbs));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function findViteConfigInDir(dirAbs: string): string | undefined {
  for (const baseName of VITE_CONFIG_BASENAMES) {
    const candidate = resolve(dirAbs, baseName);
    if (isExistingFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function findViteConfigUpwardToCwd(
  startDirAbs: string,
  cwdAbs: string
): string | undefined {
  let currentDirAbs = resolve(startDirAbs);
  const stopDirAbs = resolve(cwdAbs);

  if (!isPathInsideOrSame(currentDirAbs, stopDirAbs)) {
    return undefined;
  }

  for (; ;) {
    const found = findViteConfigInDir(currentDirAbs);
    if (found) {
      return found;
    }

    if (currentDirAbs === stopDirAbs) {
      return undefined;
    }

    const parentDirAbs = dirname(currentDirAbs);
    if (parentDirAbs === currentDirAbs) {
      return undefined;
    }

    currentDirAbs = parentDirAbs;
  }
}

function resolveRootAndConfig(params: {
  cwd: string;
  entryFiles: readonly string[];
  userRoot?: string;
  userConfigFile?: string;
}): RootAndConfigResolution {
  const { cwd, entryFiles, userRoot, userConfigFile } = params;
  const cwdAbs = resolve(cwd);

  if (userConfigFile) {
    const configFileAbs = resolve(cwd, userConfigFile);

    if (!isExistingFile(configFileAbs)) {
      fail(`Explicit Vite config file not found: "${configFileAbs}"`);
    }

    const rootAbs = userRoot ? resolve(cwd, userRoot) : dirname(configFileAbs);

    if (userRoot && !isExistingDirectory(rootAbs)) {
      fail(`Explicit --root directory not found: "${rootAbs}"`);
    }

    const discoveries: EntryConfigDiscovery[] = entryFiles.map((entryFileAbs) => ({
      entryFileAbs,
      configFileAbs,
      searchedFromAbs: dirname(entryFileAbs),
      searchedUntilAbs: "(explicit --config)",
      note: "Resolved by explicit --config.",
    }));

    return {
      rootAbs,
      configFile: configFileAbs,
      discoveries,
    };
  }

  if (userRoot) {
    const rootAbs = resolve(cwd, userRoot);

    if (!isExistingDirectory(rootAbs)) {
      fail(`Explicit --root directory not found: "${rootAbs}"`);
    }

    const configFileAbs = findViteConfigInDir(rootAbs);
    const discoveries: EntryConfigDiscovery[] = entryFiles.map((entryFileAbs) => ({
      entryFileAbs,
      configFileAbs,
      searchedFromAbs: rootAbs,
      searchedUntilAbs: rootAbs,
      note: configFileAbs
        ? "Resolved from vite.config.* found directly in explicit --root."
        : "No vite.config.* found directly in explicit --root.",
    }));

    return {
      rootAbs,
      configFile: configFileAbs ?? false,
      discoveries,
    };
  }

  const discoveries: EntryConfigDiscovery[] = entryFiles.map((entryFileAbs) => {
    const entryDirAbs = dirname(entryFileAbs);
    const insideCwd = isPathInsideOrSame(entryDirAbs, cwdAbs);

    if (insideCwd) {
      const configFileAbs = findViteConfigUpwardToCwd(entryDirAbs, cwdAbs);

      return {
        entryFileAbs,
        configFileAbs,
        searchedFromAbs: entryDirAbs,
        searchedUntilAbs: cwdAbs,
        note: configFileAbs
          ? "Resolved by upward search from entry directory to process.cwd()."
          : "No vite.config.* found from entry directory up to process.cwd().",
      };
    }

    const configFileAbs = findViteConfigInDir(entryDirAbs);

    return {
      entryFileAbs,
      configFileAbs,
      searchedFromAbs: entryDirAbs,
      searchedUntilAbs: entryDirAbs,
      note: configFileAbs
        ? "Resolved from out-of-cwd entry directory only."
        : "No vite.config.* found in out-of-cwd entry directory.",
    };
  });

  const uniqueConfigFiles = orderedUnique(
    discoveries
      .flatMap((item) => (item.configFileAbs ? [item.configFileAbs] : []))
      .sort((a, b) => a.localeCompare(b))
  );

  if (uniqueConfigFiles.length > 1) {
    fail(
      [
        "Entries resolved to multiple different Vite config files.",
        "Pass --root or --config explicitly, or split the build.",
        "",
        ...discoveries.map((item) => {
          const found = item.configFileAbs ?? "(none)";
          return [
            `  - entry: ${item.entryFileAbs}`,
            `    search: ${item.searchedFromAbs} -> ${item.searchedUntilAbs}`,
            `    config: ${found}`,
            `    note: ${item.note}`,
          ].join("\n");
        }),
      ].join("\n")
    );
  }

  const configFile = uniqueConfigFiles[0] ?? false;
  const rootAbs = configFile ? dirname(configFile) : cwdAbs;

  return {
    rootAbs,
    configFile,
    discoveries,
  };
}

function printConfigResolutionReport(resolution: RootAndConfigResolution): void {
  console.log("Vite config resolution report:");

  for (const item of resolution.discoveries) {
    console.log(
      [
        `- entry: ${item.entryFileAbs}`,
        `  search: ${item.searchedFromAbs} -> ${item.searchedUntilAbs}`,
        `  config: ${item.configFileAbs ?? "(none)"}`,
        `  note: ${item.note}`,
      ].join("\n")
    );
  }

  console.log(`Resolved root: ${resolution.rootAbs}`);
  console.log(
    `Resolved configFile: ${resolution.configFile === false ? "false" : resolution.configFile}`
  );

  if (resolution.configFile !== false) {
    const unresolvedEntries = resolution.discoveries.filter(
      (item) => !item.configFileAbs
    );

    if (unresolvedEntries.length > 0) {
      console.log(
        "Entries without a discovered config will still be built using the resolved shared root/config context."
      );
    }
  }
}

async function buildViteAndGenerate(cli: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const entryExpansionBaseAbs = cli.root ? resolve(cwd, cli.root) : cwd;
  const entryFiles = expandEntries(cli.entries, entryExpansionBaseAbs);

  if (entryFiles.length === 0) {
    fail(
      `No files matched the provided entry patterns: ${cli.entries.join(", ")}`
    );
  }

  assertSupportedEntries(entryFiles);

  const resolution = resolveRootAndConfig({
    cwd,
    entryFiles,
    userRoot: cli.root,
    userConfigFile: cli.configFile,
  });

  const outDirAbs = resolve(cwd, cli.outDirPath);
  ensureDirectory(outDirAbs);

  const prefix = normalizePrefix(cli.prefix ?? "./");

  const inlineConfig: InlineConfig = {
    root: resolution.rootAbs,
    configFile: resolution.configFile,
    build: {
      outDir: outDirAbs,
      emptyOutDir: true,
      manifest: true,
      rollupOptions: {
        input: entryFiles,
      },
    },
  };

  printConfigResolutionReport(resolution);

  try {
    await build(inlineConfig);
  } catch (error) {
    if (error instanceof Error && error.stack) {
      fail(`Build failed:\n${error.stack}`);
    }
    fail(`Build failed: ${String(error)}`);
  }

  writePhpFiles(prefix, outDirAbs);
}

async function main(): Promise<void> {
  const cli = parseCommandLineArgs();
  await buildViteAndGenerate(cli);
}

void main();
