# eve-contrib

Reusable [eve](https://eve.dev) channels and contributions, published independently
under the `@chore-o-matic/*` scope.

This is an [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) monorepo.

## Packages

| Package | Description |
| --- | --- |
| [`@chore-o-matic/eve-whatsapp`](packages/eve-whatsapp) | WhatsApp Cloud API (Meta Graph) channel for eve agents. |

## Develop

```bash
npm install        # installs every workspace, one hoisted node_modules + root lockfile
npm run build      # build all packages
npm run typecheck  # type-check all packages
npm test           # run all package test suites
```

Target a single package with `-w`, e.g. `npm run build -w @chore-o-matic/eve-whatsapp`.

## Add a package

Create `packages/<name>` with its own `package.json` (name it `@chore-o-matic/<name>`).
It is picked up by the `packages/*` workspace glob automatically — no root changes needed.
Have its `tsconfig.json` extend the shared `tsconfig.base.json` at the repo root.
