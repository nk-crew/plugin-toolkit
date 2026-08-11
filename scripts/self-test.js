#!/usr/bin/env node

/**
 * Checks that the package is internally consistent before it is published.
 *
 * Everything here is cheap and dependency-free: the point is to catch a broken
 * `exports` map, a missing bin, an undeclared dependency or a config that no
 * longer parses — the kinds of mistake that only surface once a consumer
 * installs the package.
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

let failures = 0;

/**
 * Runs a single named check.
 *
 * @param {string}   name The check description.
 * @param {Function} fn   The check itself; throws on failure.
 */
function check(name, fn) {
	try {
		fn();
		console.log(`ok    ${name}`);
	} catch (error) {
		failures++;
		console.error(`FAIL  ${name}\n      ${error.message}`);
	}
}

check('every exports target exists', () => {
	for (const target of Object.values(pkg.exports)) {
		assert.ok(
			fs.existsSync(path.join(root, target)),
			`missing export target ${target}`
		);
	}
});

check('every bin target exists and is executable', () => {
	for (const target of Object.values(pkg.bin)) {
		const file = path.join(root, target);
		assert.ok(fs.existsSync(file), `missing bin target ${target}`);
		// eslint-disable-next-line no-bitwise
		assert.ok(
			fs.statSync(file).mode & 0o111,
			`bin target ${target} is not executable`
		);
	}
});

check('every published path is listed in files', () => {
	const listed = new Set(pkg.files);

	for (const target of [
		...Object.values(pkg.exports),
		...Object.values(pkg.bin),
	]) {
		const top = target.replace(/^\.\//, '').split('/')[0];
		assert.ok(
			listed.has(top) || top === 'package.json',
			`${top} is not in the files array`
		);
	}
});

check('biome config parses and pins the shared decisions', () => {
	const biome = JSON.parse(
		fs.readFileSync(path.join(root, 'biome.json'), 'utf-8')
	);
	const rules = biome.linter.rules;

	assert.equal(
		rules.complexity.useOptionalChain,
		'off',
		'useOptionalChain must stay off: its fix is not behaviour preserving'
	);
	assert.ok(
		biome.files.includes.includes('!.claude'),
		'.claude must be excluded, anchored to the root — a worktree there carries its own config'
	);
	assert.ok(
		!biome.files.includes.includes('!**/.claude'),
		'the .claude exclude must not be prefixed with **/, which also matches ancestors'
	);
});

check('stylelint config loads', () => {
	const config = require(path.join(root, 'stylelint.js'));
	assert.ok(config.extends, 'stylelint config has no extends');
});

check('lint-staged factory filters generated paths', () => {
	const { createLintStagedConfig } = require(
		path.join(root, 'lint-staged.js')
	);
	const config = createLintStagedConfig();
	const result = config['**/*.{js,jsx,json,jsonc}']([
		'assets/a.js',
		'build/b.js',
		'core-plugin/c.js',
	]);

	assert.ok(result.includes('assets/a.js'), 'source file was filtered out');
	assert.ok(!result.includes('build/b.js'), 'build output was not filtered');
	assert.ok(
		!result.includes('core-plugin/c.js'),
		'submodule was not filtered'
	);
});

check('env ports fall back to the defaults outside a worktree', () => {
	const { getPorts } = require(path.join(root, 'scripts', 'env-ports.js'));
	const previous = process.env.CI;

	process.env.CI = '1';
	const { port, testsPort } = getPorts();
	process.env.CI = previous;

	assert.equal(port, 8888);
	assert.equal(testsPort, 8889);
});

/**
 * Builds a Playwright config with `CI` forced on or off.
 *
 * `createPlaywrightConfig` reads `CI` and writes `WP_BASE_URL`; both are put
 * back so the checks stay independent of each other and of the caller's shell.
 *
 * @param {boolean} ci      Whether to build the config as CI would.
 * @param {Object}  options Options passed through to the factory.
 * @return {Object} The resulting Playwright configuration.
 */
function buildPlaywrightConfig(ci, options = {}) {
	const { createPlaywrightConfig } = requireWithoutPlaywright(
		path.join(root, 'playwright.js')
	);
	const previousCI = process.env.CI;
	const previousBaseURL = process.env.WP_BASE_URL;

	if (ci) {
		process.env.CI = '1';
	} else {
		delete process.env.CI;
	}

	try {
		return createPlaywrightConfig({
			testDir: '/specs',
			globalSetup: '/global-setup.js',
			...options,
		});
	} finally {
		if (previousCI === undefined) {
			delete process.env.CI;
		} else {
			process.env.CI = previousCI;
		}

		if (previousBaseURL === undefined) {
			delete process.env.WP_BASE_URL;
		} else {
			process.env.WP_BASE_URL = previousBaseURL;
		}
	}
}

/**
 * Requires a module with `@playwright/test` stubbed out.
 *
 * It is an optional peer dependency and is not installed here. The config
 * factory only reads `devices` from it, for the `projects` block that none of
 * these checks look at, so an empty stub keeps the self-test instant instead of
 * pulling in a browser download.
 *
 * @param {string} id The module to load.
 * @return {Object} The module exports.
 */
function requireWithoutPlaywright(id) {
	const Module = require('node:module');
	const load = Module._load;

	Module._load = function (request, ...rest) {
		return request === '@playwright/test'
			? { devices: {} }
			: load.call(this, request, ...rest);
	};

	try {
		return require(id);
	} finally {
		Module._load = load;
	}
}

/**
 * Flattens a `reporter` value to the reporter names it resolves to.
 *
 * @param {string|Array} reporter A Playwright `reporter` value.
 * @return {Array<string>} The reporter names, in order.
 */
function reporterNames(reporter) {
	return typeof reporter === 'string'
		? [reporter]
		: reporter.map((entry) =>
				typeof entry === 'string' ? entry : entry[0]
			);
}

check('extra reporters are appended to the defaults, not swapped in', () => {
	const flaky = './config/flaky-tests-reporter.js';

	assert.deepEqual(
		reporterNames(buildPlaywrightConfig(true).reporter),
		['github'],
		'the CI default changed'
	);
	assert.deepEqual(
		reporterNames(buildPlaywrightConfig(false).reporter),
		['list'],
		'the local default changed'
	);

	assert.deepEqual(
		reporterNames(
			buildPlaywrightConfig(true, { reporters: [flaky] }).reporter
		),
		['github', flaky],
		'the CI default was lost when a reporter was appended'
	);
	assert.deepEqual(
		reporterNames(
			buildPlaywrightConfig(false, { reporters: [flaky] }).reporter
		),
		['list', flaky],
		'the local default was lost when a reporter was appended'
	);
});

check('appended reporters keep their options', () => {
	const { reporter } = buildPlaywrightConfig(true, {
		reporters: [['json', { outputFile: 'results.json' }]],
	});

	assert.deepEqual(reporter, [
		['github'],
		['json', { outputFile: 'results.json' }],
	]);
});

check('an explicit overrides.reporter still wins', () => {
	const { reporter } = buildPlaywrightConfig(true, {
		reporters: ['./config/flaky-tests-reporter.js'],
		overrides: { reporter: 'dot' },
	});

	assert.equal(
		reporter,
		'dot',
		'overrides.reporter must keep full control of the reporter list'
	);
});

check('navigations are bounded, not left to the per-test budget', () => {
	const { use } = buildPlaywrightConfig(true);

	assert.equal(
		typeof use.navigationTimeout,
		'number',
		'without an explicit navigationTimeout Playwright uses 0, and a stuck page load eats the whole test timeout on every attempt'
	);
	assert.ok(
		use.navigationTimeout > 0,
		'0 means "no timeout", which is the bug this guards against'
	);
});

check('tracing is not paid for on the happy path', () => {
	const { use, retries } = buildPlaywrightConfig(true);

	assert.equal(
		use.trace,
		'on-first-retry',
		'`retain-on-failure` traces every test and discards it on success, so a green suite pays the tracing cost in full'
	);
	assert.ok(
		retries > 0,
		'on-first-retry only yields artefacts if a failing test is actually retried under CI'
	);
});

check('slow tests are reported', () => {
	const { reportSlowTests } = buildPlaywrightConfig(true);

	assert.notEqual(
		reportSlowTests,
		null,
		'null silences the one report that would surface an expensive beforeEach'
	);
	assert.ok(
		reportSlowTests && reportSlowTests.threshold > 0,
		'a threshold of 0 flags every test and so says nothing'
	);
});

check('every runtime require is a declared dependency', () => {
	const declared = new Set([
		...Object.keys(pkg.dependencies || {}),
		...Object.keys(pkg.peerDependencies || {}),
	]);
	const files = [
		'lint-staged.js',
		'playwright.js',
		'stylelint.js',
		'scripts/env-ports.js',
		'scripts/wp-env.js',
		'scripts/activate-plugin.js',
	];

	for (const file of files) {
		const source = fs.readFileSync(path.join(root, file), 'utf-8');

		for (const [, id] of source.matchAll(/require\(\s*'([^']+)'/g)) {
			if (id.startsWith('.') || id.startsWith('node:')) {
				continue;
			}

			const name = id.startsWith('@')
				? id.split('/').slice(0, 2).join('/')
				: id.split('/')[0];

			assert.ok(
				declared.has(name),
				`${file} requires "${name}", which is not declared`
			);
		}
	}
});

if (failures) {
	console.error(`\n${failures} check(s) failed.`);
	process.exit(1);
}

console.log('\nAll checks passed.');
