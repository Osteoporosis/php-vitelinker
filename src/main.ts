#!/usr/bin/env node

import { Command } from "commander";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { glob } from "glob";
import { resolve } from "path";
import { build } from "vite";
import type { InlineConfig } from "vite";

interface Entry {
  file: string;
  name: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
  assets?: string[];
}

interface CliOptions {
  entries: string[];
  prefixPath: string;
  distPath: string;
  root?: string;
  configFile?: string;
}

/**
 * Ensure the prefix ends with a single '/' (except when empty).
 * Examples:
 *  - "/scripts"   -> "/scripts/"
 *  - "/scripts/"  -> "/scripts/"
 *  - "./"        -> "./"
 *  - ""          -> ""
 */
function normalizePrefix(prefix: string): string {
  if (!prefix) {
    return "";
  }
  if (!prefix.endsWith("/")) {
    return `${prefix}/`;
  }
  return prefix;
}

function ensureDirectory(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
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
      "Entry point files or glob patterns (.ts, .tsx, .js, .jsx)"
    )
    .option(
      "--prefix <path>",
      "Base URL for generated tags. Either a path-only prefix (e.g., `/scripts/`) or a full URL including a domain/subdomain (e.g., `https://sub.example.com/scripts/`)",
      "./"
    )
    .requiredOption("--dist <path>", "Output directory where PHP and other files are created.")
    .option(
      "--root <path>",
      "Vite project root. Defaults to the current working directory."
    )
    .option(
      "--config <path>",
      "Custom Vite config file path. Passed directly to Vite as the `configFile` option."
    )
    .showHelpAfterError()
    .parse(process.argv);

  const options = command.opts<{
    prefix: string;
    dist: string;
    root?: string;
    config?: string;
  }>();
  const rawEntries = command.args as string[];

  if (rawEntries.length === 0) {
    // Should not happen because of <entry...>, but keep a defensive check.
    console.error("At least one entry point or glob pattern must be provided.");
    process.exit(1);
  }

  const entries = rawEntries.flatMap((pattern) =>
    glob.sync(pattern, { nodir: true })
  );

  if (entries.length === 0) {
    console.error(
      `No files matched the provided entry patterns: ${rawEntries.join(", ")}`
    );
    process.exit(1);
  }

  return {
    entries,
    prefixPath: normalizePrefix(options.prefix ?? "./"),
    distPath: options.dist,
    root: options.root,
    configFile: options.config,
  };
}

function resolveManifestPath(distPath: string): string {
  const candidatePaths = [
    resolve(distPath, ".vite/manifest.json"),
    resolve(distPath, "manifest.json"),
  ];

  for (const candidate of candidatePaths) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  console.error(
    `Could not find a Vite manifest in "${distPath}". Looked for: ${candidatePaths.join(
      ", "
    )}`
  );
  process.exit(1);
}

function sanitizeFilePart(value: string): string {
  // Only keep characters that are usually safe in filenames.
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_");
}

function safePhpFileName(entry: Entry, srcKey: string): string {
  if (entry.name && entry.name.trim().length > 0) {
    return `packed__${sanitizeFilePart(entry.name)}.php`;
  }

  const base = srcKey
    .replace(/^[./\\]+/, "")
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/]+/g, "_");

  return `packed__${sanitizeFilePart(base)}.php`;
}

function writePhpFile(
  srcKey: string,
  entry: Entry,
  prefixPath: string,
  distPath: string
): void {
  const tags: string[] = [];

  tags.push(
    `<script type="module" src="${prefixPath}${entry.file}"></script>`
  );

  for (const imported of entry.imports ?? []) {
    tags.push(
      `<link rel="modulepreload" href="${prefixPath}${imported}" />`
    );
  }

  for (const cssFile of entry.css ?? []) {
    tags.push(`<link rel="stylesheet" href="${prefixPath}${cssFile}" />`);
  }

  const content = tags.join("\n");
  const phpFileName = safePhpFileName(entry, srcKey);
  const phpFilePath = resolve(distPath, phpFileName);

  writeFileSync(phpFilePath, content);

  console.log(
    `Build for "${srcKey}" completed. Include (or require) "${phpFilePath}".`
  );
}

function writePhpFiles(prefixPath: string, distPath: string): void {
  const manifestPath = resolveManifestPath(distPath);
  const jsonString = readFileSync(manifestPath, "utf-8");
  const jsonData: Record<string, Entry> = JSON.parse(jsonString);

  const entries = Object.entries(jsonData).filter(
    ([, entry]) => entry.isEntry === true
  );

  if (entries.length === 0) {
    console.warn(
      `No manifest entries with "isEntry: true" were found in "${manifestPath}". Nothing to generate.`
    );
    return;
  }

  const seenNames = new Set<string>();

  for (const [srcKey, entry] of entries) {
    const phpFileName = safePhpFileName(entry, srcKey);

    if (seenNames.has(phpFileName)) {
      console.warn(
        `Duplicate PHP filename detected ("${phpFileName}"). The last one will overwrite previous files.`
      );
    }

    seenNames.add(phpFileName);
    writePhpFile(srcKey, entry, prefixPath, distPath);
  }
}

async function buildVite(config: CliOptions): Promise<void> {
  const cwd = process.cwd();
  const distPath = resolve(cwd, config.distPath);

  ensureDirectory(distPath);

  const inlineConfig: InlineConfig = {
    root: config.root ? resolve(cwd, config.root) : cwd,
    configFile: config.configFile
      ? resolve(cwd, config.configFile)
      : undefined,
    build: {
      rollupOptions: {
        input: config.entries.map((entry) => resolve(cwd, entry)),
      },
      outDir: distPath,
      emptyOutDir: true,
      manifest: true,
    },
  };

  try {
    await build(inlineConfig);
    writePhpFiles(config.prefixPath, distPath);
  } catch (error) {
    console.error("Build failed:", error);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const cliOptions = parseCommandLineArgs();
  await buildVite(cliOptions);
}

// Avoid top level await for better compatibility.
void main();
