# php-vitelinker
A CLI tool for JS bundling. This tool generates includable PHP files after a Vite build, simplifying the integration of your JS assets into PHP projects.

## Installation
To get started, install php-vitelinker as a development dependency:
> `$ npm install -D php-vitelinker`

## Usage
Run php-vitelinker with your entry points, specifying the optional prefix and distribution paths as needed:
> `$ npx php-vitelinker <.ts/.tsx/.js/.jsxFileOrGlobPatternEntryPoints...> [--prefix <path>] --dist <path>`

### What is `--prefix <path>`?
The `--prefix` option allows you to set a server-side prefix path for the assets. This is useful when you need specific absolute or relative paths for your included assets. The default value is `./`.

## Example
To reproduce the `/dist` directory under `example_project`, you can use the following command:
> `$ npm run build:example_project`

This command is equivalent to:
> `"build:example_project": "tsc && node ./dist/main.js ../example_project/react-app/src/main.tsx \"../example_project/hello_world_scripts/**/*(*.ts*|*.js*)\" --dist ../example_project/dist"`

### Quick link to the `example_project`
https://github.com/Osteoporosis/php-vitelinker/tree/main/example_project

## Output
After running php-vitelinker, you will get `packed__{entry_point_name}.php` files. These files tag the assets, making them ready to be included in your PHP codebase.

**Your feedback and contributions are welcome.**
