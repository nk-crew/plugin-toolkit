# @nk-crew/plugin-toolkit

Shared development tooling for the nk-crew WordPress plugins. One place for the
configuration and scripts that were previously copied into every repository.

## Install

```bash
npm install --save-dev @nk-crew/plugin-toolkit
```

## Biome

```json
{
	"extends": ["@nk-crew/plugin-toolkit/biome"]
}
```

The base config sets the formatting style, enables the recommended rules, and
turns off two of them for every plugin:

- `complexity/useOptionalChain` — its fix is not behaviour preserving. It
  rewrites `x && x.f()` into `x?.f()`, but `&&` short-circuits on any falsy
  value while `?.` short-circuits only on `null` and `undefined`.
- `correctness/noUnusedFunctionParameters` — WordPress hook callbacks routinely
  ignore trailing parameters.

Add anything repository-specific in the extending file; rules and excludes are
merged, not replaced.

Note that `.claude` is excluded. A `git worktree` created under
`.claude/worktrees/` carries its own `biome.json`, and Biome refuses to run when
it finds a nested root configuration.

## Stylelint

```js
module.exports = require('@nk-crew/plugin-toolkit/stylelint');
```

Provide `stylelint` and `@wordpress/stylelint-config` yourself — stylelint
resolves the `extends` target from your project, so this package deliberately
does not pin either of them. The rules assume stylelint 16.

Stylelint still owns SCSS because Biome does not parse it yet. Both this file
and stylelint itself can go once that lands.

## lint-staged

```js
const { createLintStagedConfig } = require('@nk-crew/plugin-toolkit/lint-staged');

module.exports = createLintStagedConfig();
```

## Playwright

```js
const { createPlaywrightConfig } = require('@nk-crew/plugin-toolkit/playwright');

module.exports = createPlaywrightConfig({
	testDir: …,
	globalSetup: …,
});
```

The web server is configured with `port`, never `url`. Playwright only exports
`PLAYWRIGHT_TEST_BASE_URL` for the `port` form, and specs build their expected
URLs from it.

### Reporters

The default is `github` under CI and `list` everywhere else. `reporters` appends
to that default, so a plugin can add its own without restating the split:

```js
module.exports = createPlaywrightConfig({
	testDir: …,
	globalSetup: …,
	reporters: ['./config/flaky-tests-reporter.js'],
});
```

Entries are either a name or a `[name, options]` pair, and they apply to both
branches — appended reporters run locally as well as under CI.

`overrides.reporter` replaces the defaults outright and still takes precedence
over `reporters`. Reach for it only when a plugin genuinely wants full control;
otherwise the CI/local split ends up duplicated in every repository.

## Environment scripts

```json
{
	"scripts": {
		"wp-env": "nk-wp-env",
		"env:start": "nk-wp-env start",
		"env:stop": "nk-wp-env stop",
		"env:destroy": "nk-wp-env destroy",
		"env:ports": "nk-env-ports"
	},
	"nkPluginToolkit": {
		"plugins": ["my-plugin", "my-test-helper"]
	}
}
```

`nk-wp-env` wraps `wp-env` and pins the ports for the current checkout: the main
checkout keeps 8888/8889, linked worktrees derive their own pair, and explicit
`WP_ENV_PORT` / `WP_ENV_TESTS_PORT` always win. Several branches can run their
own WordPress at the same time.

`nk-activate-plugins` activates the list in `nkPluginToolkit.plugins`, in order,
in both environments, retrying while the site is still coming up. Wire it into
`.wp-env.json`:

```json
{
	"mappings": { "wp-content/plugins/my-plugin": "." },
	"lifecycleScripts": { "afterStart": "nk-activate-plugins" }
}
```

Mount plugins through `mappings` rather than `plugins` so the directory inside
WordPress keeps a fixed name regardless of what the checkout is called. Order in
`nkPluginToolkit.plugins` matters — the plugin itself first, then any test
helper that inspects it.

`nk-worktree-setup` prepares a fresh checkout: submodules, npm, composer, and a
running environment.
