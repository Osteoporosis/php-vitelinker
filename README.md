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
npx php-vitelinker <entry...> --outDir <path> [--prefix <path>] [--root <path>] [--config <vite.config.ts>]
```

Examples:

```bash
# Simple SPA entry
npx php-vitelinker src/main.tsx --outDir dist

# Multiple entries with glob
npx php-vitelinker "resources/scripts/**/*.{ts,js,tsx,jsx}" src/main.tsx --outDir dist

# Custom server prefix and Vite root/config
npx php-vitelinker "assets/ts/*.ts" \
  --outDir dist \
  --prefix "/scripts/" \
  --root . \
  --config vite.config.ts
```

### Supported entry files

This tool intentionally supports JS/TS script entries only:

* `.js`
* `.jsx`
* `.ts`
* `.tsx`
* `.mjs`
* `.cjs`
* `.mts`
* `.cts`

### Options

* `--outDir <path>` **(required)**
  Directory where Vite writes the build output and where packed__*.php files are created.

* `--prefix <path>`
  Base URL for generated tags. You can pass either a path-only prefix (e.g., `/scripts/`) or a full URL including a domain/subdomain (e.g., `https://sub.example.com/scripts/`).
  The tool normalizes the path to ensure it ends with a single trailing `/`, so both `/scripts` and `/scripts/` become `/scripts/` (and likewise for full URLs).
  Default: `./`

* `--root <path>`
  Explicit Vite project root.

  When provided:

  * this directory is used as Vite `root`
  * `vite.config.*` is searched **only in this directory**
  * parent directories are **not** searched

* `--config <path>`
  Explicit Vite config file path.

  When provided:

  * it overrides automatic config discovery
  * it is passed to Vite as `configFile`
  * if `--root` is not provided, the config file’s directory is used as Vite `root`

### What gets generated?

After a successful run you will see PHP files like:

```php
<link rel="stylesheet" href="./assets/app-AAAA.css" />
<link rel="stylesheet" href="./assets/shared-BBBB.css" />
<script type="module" src="./assets/app-CCCC.js"></script>
<link rel="modulepreload" href="./assets/shared-DDDD.js" />
```

Each generated `packed__{name}.php` corresponds to an `isEntry: true` item in the manifest.

### Example usage in typical PHP template

```php
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>react-app</title>
  </head>
  <body>
    <div id="root"></div>
    <?php include __DIR__ . '/dist/packed__main.php'; ?>
  </body>
</html>
```

## Example project

To reproduce the `example_project/dist` directory in this repository, run from the repo root:

```bash
npm ci
npm run build:example_project
````

This will:

1. install dependencies for the React example app,
2. build this package (`tsc`),
3. run `php-vitelinker` against:

   * the React entry file: `example_project/react-app/src/main.tsx`
   * the "hello world" scripts: `example_project/hello_world_scripts/**/*.{ts,js,tsx,jsx}`

```json
{
  "scripts": {
    "build:example_project": "npm --prefix example_project/react-app ci && tsc && node ./dist/main.js example_project/react-app/src/main.tsx \"example_project/hello_world_scripts/**/*.{ts,js,tsx,jsx}\" --outDir example_project/dist"
  }
}
```

Because the React entry file is `.../src/main.tsx`, the generated PHP output is based on `main`:

```txt
example_project/dist/
├─ .vite/
├─ assets/
├─ packed__bye_cruel_world.php
├─ packed__hello_world.php
├─ packed__main.php
└─ vite.svg
```

## Vite config resolution

`php-vitelinker` applies the following config resolution rules.

### 1) If `--config` is provided

That file is used directly.

* `configFile = <explicit file>`
* if `--root` is also provided, that value is used as Vite `root`
* otherwise, `root = dirname(configFile)`

### 2) If `--root` is provided but `--config` is not

The tool checks only that directory for `vite.config.*`.

* it does **not** search parent directories
* if a config file exists there, it is used
* otherwise, it behaves as if no config was found there

In this case:

* `root = <explicit root>`
* `configFile = <found config>`, or `false` if none exists there

### 3) If neither `--root` nor `--config` is provided

The tool discovers config files from the entry points.

For each entry:

* if the entry is inside `process.cwd()`, the tool searches from the entry’s directory upward until `process.cwd()`
* if the entry is outside `process.cwd()`, the tool checks **only the entry’s own directory**

Then:

* entries that found no config are marked as having no config
* only entries that found a config participate in config uniqueness checking
* if exactly one unique config file is found, that config is used for the whole build
* if multiple different config files are found, the tool fails
* if no config file is found anywhere, the tool uses:

```txt
configFile: false
root: process.cwd()
```

This means Vite config auto-discovery is explicitly disabled when no config can be resolved.

## Console output

Before building, the tool prints a Vite config resolution report for each entry, including:

* the entry path
* the search range used
* the config file found, or `(none)`
* a short explanation of how the result was determined

After a successful build, it prints the generated `packed__*.php` filename for each entry.
The `packed__*.php` portion is highlighted in bright white in terminal output.


## Notes / limitations

* The tool relies on Vite manifest format. Changes in Vite internals may require an update.
* If multiple entries end up with the same generated PHP filename, the last one will win (a warning is printed).

**Feedback and contributions are welcome.**
