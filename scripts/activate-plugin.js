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
 * Runs a wp-cli command in a container.
 *
 * @param {string}   container The wp-env container to run in.
 * @param {string[]} args      The wp-cli arguments.
 * @return {{ status: number, output: string }} The result.
 */
function wpCli(container, args) {
	const result = spawnSync(wpEnvBin, ['run', container, 'wp', ...args], {
		cwd: projectRoot,
		encoding: 'utf-8',
		shell: process.platform === 'win32',
	});

	const stdout = result.stdout || '';
	const stderr = result.stderr || '';

	return {
		status: result.status,
		// wp-env writes its own progress lines to stderr and the command's
		// output to stdout, so keep both: the caller decides which it needs.
		stdout,
		stderr,
		output: `${stderr || stdout}`.trim(),
	};
}

/**
 * Lists which of the configured plugins are not active.
 *
 * `wp-env run` wraps command output in progress lines of its own, so the JSON
 * array is picked out of the surrounding noise rather than parsed whole.
 *
 * @param {string} container The wp-env container to inspect.
 * @return {string[]|null} The inactive plugins, or null if the list is unreadable.
 */
function findInactive(container) {
	const listed = wpCli(container, [
		'plugin',
		'list',
		'--status=active',
		'--field=name',
		'--format=json',
	]);

	if (listed.status !== 0) {
		return null;
	}

	const match = `${listed.stdout}\n${listed.stderr}`.match(/\[.*?\]/s);

	if (!match) {
		return null;
	}

	try {
		const active = new Set(JSON.parse(match[0]));

		return plugins.filter((name) => !active.has(name));
	} catch {
		return null;
	}
}

/**
 * Blocks for a moment between attempts.
 */
function pause() {
	spawnSync(process.execPath, [
		'-e',
		`setTimeout(() => {}, ${RETRY_DELAY_MS})`,
	]);
}

/**
 * Activates the configured plugins in a container, in order.
 *
 * Retries cover a database that is still coming up, but a plain retry is not
 * enough on its own. `wp plugin activate a b c` keeps going after one of them
 * fails, so a half-finished run can leave a test helper active while the plugin
 * it stubs is not. The helper's stub classes then load first and every
 * subsequent attempt dies on a redeclaration fatal — a state the retry loop
 * created and cannot escape.
 *
 * So after a failure the configured plugins are deactivated before trying
 * again, which puts the site back to a state activation can succeed from.
 *
 * @param {string} container The wp-env container to run in.
 * @return {{ ok: boolean, output: string }} The outcome of the last attempt.
 */
function activateIn(container) {
	let output = '';

	for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
		if (attempt > 1) {
			// Best effort: the site may simply not be up yet.
			wpCli(container, ['plugin', 'deactivate', ...plugins]);
		}

		const activated = wpCli(container, ['plugin', 'activate', ...plugins]);

		if (activated.status === 0) {
			// `wp plugin activate` can report success for the set while an
			// individual plugin stayed inactive, so confirm rather than trust.
			const missing = findInactive(container);

			if (missing === null) {
				output = 'could not read the list of active plugins';
			} else if (missing.length) {
				output = `these plugins did not become active: ${missing.join(', ')}`;
			} else {
				return { ok: true, output: activated.output };
			}
		} else {
			output = activated.output;
		}

		if (attempt < ATTEMPTS) {
			pause();
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
