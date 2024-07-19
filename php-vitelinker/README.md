# php-vitelinker
Provides includable php files after vite build

## Usage
### install
`$ npm install -D php-vitelinker`

### run
`$ npx php-vitelinker <.ts/.tsx/.js/.jsxFileOrGlobPatternEntryPoints...> --prefix <path> --dist <path>`

### What is --prefix <path>?
Server-side prefix path to the assets. As you include the packed php from outside, you may need specific absolute/relative prefix. The default value is './'.

### How to reproduce the dist directory in example_project
`$ npm run build:example_project`

Actually it executes the following
> `"build:example_project": "tsc && node ./dist/main.js ../example_project/react-app/src/main.tsx \"../example_project/hello_world_scripts/**/*(*.ts*|*.js*)\" --dist ../example_project/dist"`

### You get...
`packed__{entry_point_name}.php` files tagging assets as a result. All you need to do is including them into your php codebase.
