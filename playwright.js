/**
 * Shared Playwright configuration for the plugins.
 *
 * The important part is the web server block. Playwright only exports
 * `PLAYWRIGHT_TEST_BASE_URL` when `webServer` is given a `port`, never when it
 * is given a `url`, and specs build their expected URLs from that variable.
 * Using `url` here silently breaks every spec that compares absolute links.
 */

const os = require('node:os');
const path = require('node:path');
const { devices } = require('@playwright/test');
const { getPorts } = require('./scripts/env-ports.js');

/**
 * Normalises one reporter into Playwright's `[name, options]` form.
 *
 * @param {string|Array} reporter A reporter name, or a `[name, options]` pair.
 * @return {Array} The reporter as a `[name, options]` pair.
 */
function toReporterEntry(reporter) {
	return typeof reporter === 'string' ? [reporter] : reporter;
}

/**
 * Builds a Playwright config for a plugin.
 *
 * @param {Object} options             Options.
 * @param {string} options.testDir     Absolute path to the specs directory.
 * @param {string} options.globalSetup Absolute path to the global setup file.
 * @param {number} [options.timeout]   Per-test timeout in milliseconds.
 * @param {Array}  [options.reporters] Extra reporters appended to the defaults,
 *                                     each a name or a `[name, options]` pair.
 *                                     Prefer this over `overrides.reporter`,
 *                                     which replaces the defaults and makes
 *                                     every plugin restate the CI/local split.
 * @param {Object} [options.overrides] Extra config merged over the result.
 * @return {Object} A Playwright configuration object.
 */
function createPlaywrightConfig({
	testDir,
	globalSetup,
	timeout,
	reporters = [],
	overrides = {},
}) {
	const { testsPort } = getPorts();
	const baseURL = process.env.WP_BASE_URL || `http://localhost:${testsPort}`;

	// `@wordpress/e2e-test-utils-playwright` reads this from the environment
	// rather than from the config.
	process.env.WP_BASE_URL = baseURL;

	// The list form, so `reporters` can be appended to it. Playwright treats
	// `[['list']]` and `'list'` the same.
	const defaultReporters = process.env.CI ? [['github']] : [['list']];

	return {
		// `overrides.reporter` still wins, via the spread at the end.
		reporter: [...defaultReporters, ...reporters.map(toReporterEntry)],
		forbidOnly: !!process.env.CI,
		workers: 1,
		retries: process.env.CI ? 2 : 0,
		timeout:
			Number.parseInt(process.env.TIMEOUT || '', 10) ||
			timeout ||
			200_000,
		// Playwright's default is `{ max: 5, threshold: 15000 }`; `null` silenced
		// it entirely. That hid a suite where a `beforeEach` was loading the whole
		// of wp-admin before every test, for months. The cost of the report is a
		// few lines at the end of a run.
		reportSlowTests: { max: 5, threshold: 30_000 },
		testDir,
		globalSetup,
		outputDir: path.join(process.cwd(), 'artifacts/test-results'),
		snapshotPathTemplate:
			'{testDir}/{testFileDir}/__snapshots__/{arg}-{projectName}{ext}',
		use: {
			baseURL,
			headless: true,
			viewport: { width: 960, height: 700 },
			ignoreHTTPSErrors: true,
			locale: 'en-US',
			contextOptions: {
				reducedMotion: 'reduce',
				strictSelectors: true,
			},
			storageState:
				process.env.STORAGE_STATE_PATH ||
				path.join(process.cwd(), 'artifacts/storage-states/admin.json'),
			actionTimeout: 10000,
			// Playwright Test defaults this to `0`, and `actionTimeout` does
			// not cover navigations. Left unset, a `goto` or a
			// `waitForNavigation` that never resolves hangs until the whole
			// per-test budget is gone, so a single stuck page load costs the
			// full `timeout` (and the same again for every retry).
			navigationTimeout: 30000,
			// `retain-on-failure` records a trace for every test and throws it
			// away when the test passes, so the whole suite pays for tracing to
			// keep artefacts for the few tests that fail. `on-first-retry` moves
			// that cost onto the retry, which `retries` above already guarantees
			// for anything that fails under CI -- same artefacts where they are
			// useful, none of the overhead where they are not.
			trace: 'on-first-retry',
			screenshot: 'only-on-failure',
			video: 'on-first-retry',
		},
		webServer: {
			command: 'npm run env:start',
			// Must stay `port`, see the note at the top of this file.
			port: testsPort,
			timeout: 120000,
			reuseExistingServer: true,
		},
		projects: [
			{
				name: 'chromium',
				use: { ...devices['Desktop Chrome'] },
				grepInvert: /-chromium/,
			},
			{
				name: 'webkit',
				use: {
					...devices['Desktop Safari'],
					headless: os.type() !== 'Linux',
				},
				grep: /@webkit/,
				grepInvert: /-webkit/,
			},
			{
				name: 'firefox',
				use: { ...devices['Desktop Firefox'] },
				grep: /@firefox/,
				grepInvert: /-firefox/,
			},
		],
		...overrides,
	};
}

module.exports = { createPlaywrightConfig };
