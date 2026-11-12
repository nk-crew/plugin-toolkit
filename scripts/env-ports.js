/**
 * Resolves the `wp-env` ports for the checkout that is being worked on.
 *
 * `wp-env` already isolates every checkout: it keys its instance directory,
 * Docker containers and volumes on a hash of the `.wp-env.json` path. The only
 * thing that collides between a main checkout and a `git worktree` is the pair
 * of published HTTP ports, which both default to 8888/8889.
 *
 * The main checkout keeps the familiar defaults. Linked worktrees get their own
 * pair from `port-claims.js`, so several branches can run side by side.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { selectPorts } = require('./port-claims.js');

const DEFAULT_PORT = 8888;
const DEFAULT_TESTS_PORT = 8889;

// Shared by every plugin, since they all publish to the same ports.
const CLAIMS_DIR = path.join(os.homedir(), '.nk-plugin-toolkit', 'env-ports');

/**
 * Finds the plugin checkout we are running for.
 *
 * This lives in a shared package, so the answer is never the package's own
 * directory. Walk up from the working directory instead, looking for the file
 * that marks a plugin checkout.
 *
 * @return {string} Absolute path to the checkout root.
 */
function findProjectRoot() {
	let current = process.cwd();

	while (true) {
		if (
			fs.existsSync(path.join(current, '.wp-env.json')) ||
			fs.existsSync(path.join(current, 'package.json'))
		) {
			return current;
		}

		const parent = path.dirname(current);

		if (parent === current) {
			return process.cwd();
		}

		current = parent;
	}
}

/**
 * The git directory of a linked worktree.
 *
 * In a linked worktree the git directory is `<main>/.git/worktrees/<name>`,
 * which the main checkout never is.
 *
 * @param {string} projectRoot The checkout to inspect.
 * @return {string|null} The git directory, or null for the main checkout.
 */
function getWorktreeGitDir(projectRoot) {
	try {
		const gitDir = execFileSync(
			'git',
			['rev-parse', '--absolute-git-dir'],
			{
				cwd: projectRoot,
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'ignore'],
			}
		).trim();

		return gitDir.split(/[\\/]/).includes('worktrees') ? gitDir : null;
	} catch {
		// Not a git checkout at all — treat it as the main one.
		return null;
	}
}

/**
 * The ports this checkout should use.
 *
 * Explicit environment variables always win, so CI and one-off overrides keep
 * working unchanged.
 *
 * @param {Object}  [options]       Options.
 * @param {boolean} [options.claim] Record the pair for this worktree, skipping
 *                                  pairs in use. Only what starts the
 *                                  environment does (`nk-wp-env start`, and
 *                                  the Playwright config, whose web server runs
 *                                  it), so both agree on the pair. Elsewhere a
 *                                  running environment would push itself off
 *                                  its own ports.
 * @return {{ port: number, testsPort: number }} The resolved ports.
 */
function getPorts({ claim = false } = {}) {
	const envPort = Number.parseInt(process.env.WP_ENV_PORT || '', 10);
	const envTestsPort = Number.parseInt(
		process.env.WP_ENV_TESTS_PORT || '',
		10
	);

	if (envPort && envTestsPort) {
		return { port: envPort, testsPort: envTestsPort };
	}

	const projectRoot = findProjectRoot();
	const gitDir = process.env.CI ? null : getWorktreeGitDir(projectRoot);
	const defaults = gitDir
		? selectPorts({
				projectRoot,
				owner: gitDir,
				claimsDir: CLAIMS_DIR,
				claim,
			})
		: { port: DEFAULT_PORT, testsPort: DEFAULT_TESTS_PORT };

	return {
		port: envPort || defaults.port,
		testsPort: envTestsPort || defaults.testsPort,
	};
}

module.exports = { getPorts, findProjectRoot };
