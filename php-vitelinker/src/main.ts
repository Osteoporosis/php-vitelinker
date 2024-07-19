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
  const optionFlags = '--dist <path>';

  const command = new Command();
  command
    .description('Provides includable php files after vite build')
    .arguments(argumentsNames)
    .option(optionFlags, 'Output directory')
    .parse(process.argv);

  const options = command.opts();
  const rawEntries = command.args;

  if (!options.dist) {
    console.error(`Output directory is required. Usage: npx php-vitelinker ${argumentsNames} ${optionFlags}`);
    process.exit(1);
  }

  if (rawEntries.length === 0) {
    console.error('At least one entry point must be provided.');
    process.exit(1);
  }

  const entries = rawEntries.flatMap(pattern => glob.sync(pattern));
  return { entries, distPath: options.dist };
}


function writePHPFile(src: string, entry: Entry, distPath: string) {
  const fileTag = `<script type="module" src="./${entry.file}"></script>`;
  const importTagAll = (entry.imports ?? []).map((i) => `<link rel="modulepreload" href="./${i}" />`).join("\n");
  const cssTagAll = (entry.css ?? []).map((i) => `<link rel="stylesheet" href="./${i}" />`).join("\n");
  const content = `<?= '${[fileTag, importTagAll, cssTagAll].join("\n")}' ?>`;
  const path = resolve(distPath, `packed__${entry.name}.php`);
  writeFileSync(path, content);
  console.log(`Build for ${src} completed. Include(or require) ${path}`);
}


function writePHPFiles(distPath: string) {
  const jsonString = readFileSync(resolve(distPath, "./.vite/manifest.json"), 'utf-8')
  const jsonData: Record<string, Entry> = JSON.parse(jsonString);
  const entries = Object.entries(jsonData).filter(
    ([_key, value]: [string, Entry]) => value.hasOwnProperty('isEntry') && value.isEntry === true
  );
  entries.map(([key, value]) => { writePHPFile(key, value, distPath) });
}


async function buildVite(entries: string[], distPath: string) {
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

    writePHPFiles(distPath);

  } catch (error) {
    console.error(`Build failed: ${error}`);
  }

}


async function main() {
  const { entries, distPath: distPath } = parseCommandLineArgs();
  await buildVite(entries, `${distPath}`);
}


await main();
