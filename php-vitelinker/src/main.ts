#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';
import { resolve } from 'path';
import { build } from 'vite';


interface Entry {
  file: string;
  name: string;
  src?: string;
  isEntry?: boolean;
  imports?: string[];
  css?: string[];
  assets?: string[];
}


function parseCommandLineArgs() {
  const argumentsNames = '<.ts/.tsx/.js/.jsxFileOrGlobPatternEntryPoints...>';
  const prefixFlags = '--prefix <path>'
  const distFlags = '--dist <path>';

  const command = new Command();
  command
    .description('Provides includable php files after vite build')
    .arguments(argumentsNames)
    .option(prefixFlags, 'Server-side prefix path to the assets')
    .option(distFlags, 'Output directory')
    .parse(process.argv);

  const options = command.opts();
  const rawEntries = command.args;

  if (!options.dist) {
    console.error(`Output directory is required. Usage: npx php-vitelinker ${argumentsNames} ${prefixFlags} ${distFlags}`);
    process.exit(1);
  }

  if (rawEntries.length === 0) {
    console.error('At least one entry point must be provided.');
    process.exit(1);
  }

  const entries = rawEntries.flatMap(pattern => glob.sync(pattern));
  return { entries, prefixPath: options.prefix || './', distPath: options.dist };
}


function writePHPFile(src: string, entry: Entry, prefixPath: string, distPath: string) {
  const fileTag = `<script type="module" src="${prefixPath}${entry.file}"></script>`;
  const importTagAll = (entry.imports ?? []).map((i) => `<link rel="modulepreload" href="${prefixPath}${i}" />`).join("\n");
  const cssTagAll = (entry.css ?? []).map((i) => `<link rel="stylesheet" href="${prefixPath}${i}" />`).join("\n");
  const content = [fileTag, importTagAll, cssTagAll].join("");
  const path = resolve(distPath, `packed__${entry.name}.php`);
  writeFileSync(path, content);
  console.log(`Build for ${src} completed. Include(or require) ${path}`);
}


function writePHPFiles(prefixPath: string, distPath: string) {
  const jsonString = readFileSync(resolve(distPath, "./.vite/manifest.json"), 'utf-8')
  const jsonData: Record<string, Entry> = JSON.parse(jsonString);
  const entries = Object.entries(jsonData).filter(
    ([, entry]: [string, Entry]) => Object.prototype.hasOwnProperty.call(entry, 'isEntry') && entry.isEntry === true
  );
  entries.map(([src, entry]) => { writePHPFile(src, entry, prefixPath, distPath) });
}


async function buildVite(entries: string[], prefixPath: string, distPath: string) {
  const path = process.cwd();
  const inputEntries = entries.map(entry => resolve(path, entry));
  distPath = resolve(path, distPath)

  if (!existsSync(distPath)) {
    mkdirSync(distPath);
  }

  try {
    await build({
      build: {
        rollupOptions: {
          input: inputEntries,
        },
        outDir: resolve(distPath),
        emptyOutDir: true,
        manifest: true
      },
    });

    writePHPFiles(prefixPath, distPath);

  } catch (error) {
    console.error(`Build failed: ${error}`);
  }

}


async function main() {
  const { entries, prefixPath: prefixPath, distPath: distPath } = parseCommandLineArgs();
  await buildVite(entries, `${prefixPath}`, `${distPath}`);
}


await main();
