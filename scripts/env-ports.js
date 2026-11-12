/**
 * Resolves the `wp-env` ports for the checkout that is being worked on.
 *
 * `wp-env` already isolates every checkout: it keys its instance directory,
 * Docker containers and volumes on a hash of the `.wp-env.json` path. The only
 * thing that collides between a main checkout and a `git worktree` is the pair
 * of published HTTP ports, which both default to 8888/8889.
 *
 * The main checkout keeps the familiar defaults. A linked worktree starts from
 * a pair derived from its path and moves to the next free one when another
 * worktree, of any plugin, already holds it. `nk-wp-env start` records the
 * pair it picked, so the worktree keeps it from then on.
 */

const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_PORT = 8888;
const DEFAULT_TESTS_PORT = 8889;

// Worktree ports live above the defaults, in pairs: 8900/8901, 8902/8903, ...
const WORKTREE_PORT_BASE = 8900;
const WORKTREE_PORT_PAIRS = 40;

// One file per held pair, named by its development port and holding the git
// directory of the worktree that holds it. Shared by every plugin, since they
// all publish to the same ports.
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
 * The pair in a given slot of the worktree range.
 *
 * @param {number} slot Zero-based slot.
 * @return {{ port: number, testsPort: number }} The pair.
 */
function slotPorts(slot) {
	const port = WORKTREE_PORT_BASE + slot * 2;

	return { port, testsPort: port + 1 };
}

/**
 * Whether nothing listens on either port of a pair.
 *
 * `net` binds only asynchronously and `getPorts` is synchronous, so the probe
 * runs in a child process.
 *
 * @param {{ port: number, testsPort: number }} pair The pair to test.
 * @return {boolean} True when both ports can be bound.
 */
function isPairFree({ port, testsPort }) {
	const probe = `
		const net = require('node:net');
		let left = 2;
		for (const port of process.argv.slice(1)) {
			const server = net.createServer();
			server.once('error', () => process.exit(1));
			server.listen(Number(port), () => server.close(() => --left || process.exit(0)));
		}`;

	return (
		spawnSync(process.execPath, [
			'-e',
			probe,
			String(port),
			String(testsPort),
		]).status === 0
	);
}

/**
 * Picks the pair for a linked worktree.
 *
 * Starts at the slot derived from the checkout path and walks forward past
 * pairs another live worktree holds. With `claim`, it also skips pairs in use
 * and records the result. The record is created exclusively, so two worktrees
 * claiming at once do not both take the same free pair. A worktree that
 * already holds a pair gets it back unchanged.
 *
 * @param {Object}   options             Options.
 * @param {string}   options.projectRoot The checkout path the start slot is derived from.
 * @param {string}   options.owner       The worktree's git directory.
 * @param {string}   options.claimsDir   Where held pairs are recorded.
 * @param {boolean}  [options.claim]     Whether to record the pair.
 * @param {Function} [options.isFree]    Tests whether a pair can be bound.
 * @return {{ port: number, testsPort: number }} The pair.
 */
function selectPorts({
	projectRoot,
	owner,
	claimsDir,
	claim = false,
	isFree = isPairFree,
}) {
	const holders = new Map();
	const names = fs.existsSync(claimsDir) ? fs.readdirSync(claimsDir) : [];

	for (const name of names) {
		const holder = fs
			.readFileSync(path.join(claimsDir, name), 'utf-8')
			.trim();

		if (holder === owner) {
			return { port: Number(name), testsPort: Number(name) + 1 };
		}

		holders.set(Number(name), holder);
	}

	const hash = crypto.createHash('md5').update(projectRoot).digest();
	const start = hash.readUInt16BE(0) % WORKTREE_PORT_PAIRS;

	for (let i = 0; i < WORKTREE_PORT_PAIRS; i++) {
		const pair = slotPorts((start + i) % WORKTREE_PORT_PAIRS);
		const holder = holders.get(pair.port);

		if (holder && fs.existsSync(holder)) {
			continue;
		}

		if (!claim) {
			return pair;
		}

		if (!isFree(pair)) {
			continue;
		}

		const file = path.join(claimsDir, String(pair.port));

		if (holder) {
			fs.rmSync(file, { force: true });
		}

		try {
			fs.mkdirSync(claimsDir, { recursive: true });
			fs.writeFileSync(file, owner, { flag: 'wx' });
		} catch (error) {
			if (error.code === 'EEXIST') {
				continue;
			}

			throw error;
		}

		return pair;
	}

	throw new Error(
		`Every wp-env port pair from ${WORKTREE_PORT_BASE} to ${WORKTREE_PORT_BASE + WORKTREE_PORT_PAIRS * 2 - 1} is held or in use. Remove finished worktrees, or set WP_ENV_PORT and WP_ENV_TESTS_PORT.`
	);
}

/**
 * The ports this checkout should use.
 *
 * Explicit environment variables always win, so CI and one-off overrides keep
 * working unchanged.
 *
 * @param {Object}  [options]       Options.
 * @param {boolean} [options.claim] Record the pair for this worktree, skipping
 *                                  pairs in use. Only `nk-wp-env start` does:
 *                                  a running environment holds its own ports
 *                                  and would push itself off them.
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

module.exports = { getPorts, findProjectRoot, selectPorts };
