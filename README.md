# php-vitelinker
Provides includable php files after vite build

## Usage
### install
`$ npm install php-vitelinker`

### build
`$ npx php-vitelinker <.ts/.tsx/.js/.jsxFileOrGlobPatternEntryPoints...> --dist <path>`

### How to reproduce the dist directory in example_project
`$ npm run build:example_project`

Actually it executes the following
> `"build:example_project": "tsc && node ./dist/main.js ../example_project/react-app/src/main.tsx \"../example_project/hello_world_scripts/**/*(*.ts*|*.js*)\" --dist ../example_project/dist"`

### You get...
`packed__{entry_point_name}.php` files tagging assets as a result. All you need to do is including them into your php codebase.
