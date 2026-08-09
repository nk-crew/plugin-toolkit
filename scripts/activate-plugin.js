#!/usr/bin/env node

/**
 * Activates the plugins in both `wp-env` environments after a start.
 *
 * Plugins are mounted through `mappings` in `.wp-env.json` rather than through
 * `plugins`, so that each directory inside WordPress keeps a fixed name no
 * matter what the checkout directory is called. `mappings` does not activate
 * anything, which is what this script is for.
 *
 * Order matters, so the list is explicit rather than derived. Test helper
 * plugins tend to declare stub classes behind `class_exists()` guards, and
 * those guards only do the right thing once the real plugin is loaded.
 *
 * Configure it in the consuming package.json:
 *
 *     "nkPluginToolkit": {
 *         "plugins": [ "visual-portfolio", "some-test-helper" ]
 *     }
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { findProjectRoot } = require('./env-ports.js');

const CONTAINERS = ['cli', 'tests-cli'];

// A freshly created environment can still be finishing its database setup when
// this runs, so give it a few tries before calling it a failure.
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 3000;

const projectRoot = findProjectRoot();

/**
 * Reads the ordered plugin list from the consuming package.
 *
 * @return {string[]} Plugin directory names, the plugin itself first.
 */
function getPlugins() {
	const pkgPath = path.join(projectRoot, 'package.json');

	if (!fs.existsSync(pkgPath)) {
		return [];
	}

	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
	const configured = pkg.nkPluginToolkit?.plugins;

	if (Array.isArray(configured) && configured.length) {
		return configured;
	}

	return [];
}

const plugins = getPlugins();

if (!plugins.length) {
	console.error(
		'No plugins configured. Add "nkPluginToolkit": { "plugins": [ … ] } to package.json.'
	);
	process.exit(1);
}

const localBin = path.join(
	projectRoot,
	'node_modules',
	'.bin',
	process.platform === 'win32' ? 'wp-env.cmd' : 'wp-env'
);
const wpEnvBin = fs.existsSync(localBin) ? localBin : 'wp-env';

/**
 * Runs `wp plugin activate` in a container, retrying while the site is not ready.
 *
 * @param {string} container The wp-env container to run in.
 * @return {{ ok: boolean, output: string }} The outcome of the last attempt.
 */
function activateIn(container) {
	let output = '';

	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		const result = spawnSync(
			wpEnvBin,
			['run', container, 'wp', 'plugin', 'activate', ...plugins],
			{
				cwd: projectRoot,
				encoding: 'utf-8',
				shell: process.platform === 'win32',
			}
		);

		if (result.status === 0) {
			return { ok: true, output: result.stdout || '' };
		}

		output = `${result.stderr || result.stdout || ''}`.trim();

		if (attempt < ATTEMPTS) {
			// `spawnSync` keeps this simple: block until the next attempt.
			spawnSync(process.execPath, [
				'-e',
				`setTimeout(() => {}, ${RETRY_DELAY_MS})`,
			]);
		}
	}

	return { ok: false, output };
}

let failed = false;

for (const container of CONTAINERS) {
	const { ok, output } = activateIn(container);

	if (!ok) {
		failed = true;

		console.error(
			`Could not activate plugins in the "${container}" container.\n${output}`
		);
	}
}

if (failed) {
	process.exit(1);
}

console.log(`Activated: ${plugins.join(', ')}.`);
