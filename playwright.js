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
 * Builds a Playwright config for a plugin.
 *
 * @param {Object}  options            Options.
 * @param {string}  options.testDir    Absolute path to the specs directory.
 * @param {string}  options.globalSetup Absolute path to the global setup file.
 * @param {number}  [options.timeout]  Per-test timeout in milliseconds.
 * @param {Object}  [options.overrides] Extra config merged over the result.
 * @return {Object} A Playwright configuration object.
 */
function createPlaywrightConfig({
	testDir,
	globalSetup,
	timeout,
	overrides = {},
}) {
	const { testsPort } = getPorts();
	const baseURL = process.env.WP_BASE_URL || `http://localhost:${testsPort}`;

	// `@wordpress/e2e-test-utils-playwright` reads this from the environment
	// rather than from the config.
	process.env.WP_BASE_URL = baseURL;

	return {
		reporter: process.env.CI ? [['github']] : 'list',
		forbidOnly: !!process.env.CI,
		workers: 1,
		retries: process.env.CI ? 2 : 0,
		timeout:
			Number.parseInt(process.env.TIMEOUT || '', 10) ||
			timeout ||
			200_000,
		reportSlowTests: null,
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
			trace: 'retain-on-failure',
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
