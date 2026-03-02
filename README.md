# php-vitelinker

A CLI tool for JS bundling. This tool runs a Vite build and generates includable PHP files that point at the built assets.

It is designed for PHP projects that want to use Vite for bundling without manually parsing `manifest.json`.

## Installation

Install as a development dependency:

```bash
npm install -D php-vitelinker
# or
pnpm add -D php-vitelinker
# or
yarn add -D php-vitelinker
````

## Basic usage

Run **php-vitelinker** with one or more entry points (files or glob patterns) and a required output directory:

```bash
npx php-vitelinker <entry...> --dist <path> [--prefix <path>] [--root <path>] [--config <vite.config.ts>]
```

Examples:

```bash
# Simple SPA entry
npx php-vitelinker src/main.tsx --dist dist

# Multiple entries with glob
npx php-vitelinker "resources/scripts/**/*.{ts,js,tsx,jsx}" src/main.tsx --dist dist

# Custom server prefix and Vite root/config
npx php-vitelinker "assets/ts/*.ts" \
  --dist dist \
  --prefix "/scripts/" \
  --root . \
  --config vite.config.ts
```

### Options

* `--dist <path>` **(required)**
  Directory where Vite writes the build output and where packed__*.php files are created.

* `--prefix <path>`
  Base URL for generated tags. You can pass either a path-only prefix (e.g., `/scripts/`) or a full URL including a domain/subdomain (e.g., `https://sub.example.com/scripts/`).
  The tool normalizes the path to ensure it ends with a single trailing `/`, so both `/scripts` and `/scripts/` become `/scripts/` (and likewise for full URLs).
  Default: `./`

* `--root <path>`
  Vite project root. Defaults to the current working directory.

* `--config <path>`
  Custom Vite config file path. Passed directly to Vite as the `configFile` option.

### What gets generated?

After a successful run you will see PHP files like:

```php
<?php // packed__main.php ?>
<script type="module" src="./assets/main-XXXX.js"></script>
<link rel="modulepreload" href="./assets/vendor-YYYY.js" />
<link rel="stylesheet" href="./assets/main-ZZZZ.css" />
```

Each generated `packed__{name}.php` corresponds to an `isEntry: true` item in Vite’s manifest.
You can simply `include` or `require` these files from your PHP templates.

## Example project

To reproduce the `/example_project/dist` directory under this repository, run:

```bash
npm install
npm run build:example_project
```

This runs `php-vitelinker` against the React example and the small "hello world" scripts.

```json
"build:example_project": "tsc && node ./dist/main.js example_project/react-app/src/main.tsx \"example_project/hello_world_scripts/**/*.{ts,js,tsx,jsx}\" --dist example_project/dist"
```

## Notes / limitations

* The tool currently relies on Vite’s manifest format. Changes in Vite internals may require an update.
* If multiple entries end up with the same generated PHP filename, the last one will win (a warning is printed).

**Feedback and contributions are welcome.**
