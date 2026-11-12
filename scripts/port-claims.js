/**
 * Hands each linked worktree its own `wp-env` port pair.
 *
 * A worktree starts from a pair derived from its path and walks forward past
 * pairs another worktree holds or something listens on. A claim is recorded as
 * one file per pair, named by its development port and holding the git
 * directory of the worktree that holds it, so a worktree keeps its pair on
 * every later run. Once no unheld pair is free, a claim takes over the pair of
 * a stopped worktree, the least recently started first; that worktree claims
 * a new one on its next start.
 */

const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Worktree ports live above the defaults, in pairs: 8900/8901, 8902/8903, ...
const WORKTREE_PORT_BASE = 8900;
const WORKTREE_PORT_PAIRS = 40;

// A claim takes well under a second; a lock older than this was left behind
// by a process that died holding it.
const STALE_LOCK_MS = 30_000;

/**
 * The pair whose development port is `port`.
 *
 * @param {number} port The development port.
 * @return {{ port: number, testsPort: number }} The pair.
 */
function pairOf(port) {
	return { port, testsPort: port + 1 };
}

/**
 * Whether nothing answers on either port of a pair.
 *
 * Connecting catches a listener on any loopback address, where binding does
 * not: macOS lets `::` be bound next to `127.0.0.1`. `net` connects only
 * asynchronously and `getPorts` is synchronous, so the probe runs in a child
 * process.
 *
 * @param {{ port: number, testsPort: number }} pair The pair to test.
 * @return {boolean} True when neither port accepts a connection.
 */
function isPairFree({ port, testsPort }) {
	const probe = `
		const net = require('node:net');
		const targets = process.argv.slice(1).flatMap((port) => [
			['127.0.0.1', port],
			['::1', port],
		]);
		let left = targets.length;
		for (const [host, port] of targets) {
			net.connect(Number(port), host)
				.once('connect', () => process.exit(1))
				.once('error', () => --left || process.exit(0));
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
 * Runs `fn` while holding the claims directory's lock.
 *
 * @param {string}   claimsDir Where claims are recorded.
 * @param {Function} fn        The critical section.
 * @return {*} What `fn` returns.
 */
function withLock(claimsDir, fn) {
	const lock = path.join(claimsDir, 'lock');

	fs.mkdirSync(claimsDir, { recursive: true });

	for (;;) {
		try {
			fs.mkdirSync(lock);
			break;
		} catch (error) {
			if (error.code !== 'EEXIST') {
				throw error;
			}
		}

		const since = fs.statSync(lock, { throwIfNoEntry: false });

		if (since && Date.now() - since.mtimeMs > STALE_LOCK_MS) {
			fs.rmSync(lock, { recursive: true, force: true });
		} else {
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
		}
	}

	try {
		return fn();
	} finally {
		fs.rmSync(lock, { recursive: true, force: true });
	}
}

/**
 * Picks the pair for a linked worktree.
 *
 * @param {Object}   options             Options.
 * @param {string}   options.projectRoot The checkout path the first pair is derived from.
 * @param {string}   options.owner       The worktree's git directory.
 * @param {string}   options.claimsDir   Where claims are recorded.
 * @param {boolean}  [options.claim]     Record the pair, skipping pairs in use.
 * @param {Function} [options.isFree]    Tests whether a pair is unused.
 * @return {{ port: number, testsPort: number }} The pair.
 */
function selectPorts({ claim = false, claimsDir, ...options }) {
	return claim
		? withLock(claimsDir, () => choose({ claim, claimsDir, ...options }))
		: choose({ claim, claimsDir, ...options });
}

/**
 * The body of `selectPorts`, run under the lock when it claims.
 *
 * @param {Object} options See `selectPorts`.
 * @return {{ port: number, testsPort: number }} The pair.
 */
function choose({ projectRoot, owner, claimsDir, claim, isFree = isPairFree }) {
	const records = (fs.existsSync(claimsDir) ? fs.readdirSync(claimsDir) : [])
		.filter((name) => /^\d+$/.test(name))
		.map((name) => {
			const file = path.join(claimsDir, name);

			return {
				file,
				port: Number(name),
				holder: fs.readFileSync(file, 'utf-8').trim(),
				startedAt: fs.statSync(file).mtimeMs,
			};
		});
	const own = records.find((record) => record.holder === owner);

	if (own) {
		if (claim) {
			const now = new Date();
			fs.utimesSync(own.file, now, now);
		}

		return pairOf(own.port);
	}

	const held = new Map(
		records
			.filter((record) => fs.existsSync(record.holder))
			.map((record) => [record.port, record])
	);
	const hash = crypto.createHash('md5').update(projectRoot).digest();
	const start = hash.readUInt16BE(0) % WORKTREE_PORT_PAIRS;
	const pairs = Array.from({ length: WORKTREE_PORT_PAIRS }, (_, i) =>
		pairOf(WORKTREE_PORT_BASE + ((start + i) % WORKTREE_PORT_PAIRS) * 2)
	);
	const unheld = pairs.filter(({ port }) => !held.has(port));

	if (!claim) {
		return unheld[0] || pairs[0];
	}

	const stoppedFirst = pairs
		.filter(({ port }) => held.has(port))
		.sort(
			(a, b) => held.get(a.port).startedAt - held.get(b.port).startedAt
		);
	const pair = [...unheld, ...stoppedFirst].find((candidate) =>
		isFree(candidate)
	);

	if (!pair) {
		throw new Error(
			`All ${WORKTREE_PORT_PAIRS} wp-env port pairs from ${WORKTREE_PORT_BASE} are in use. Stop an environment with "npm run env:stop", or set WP_ENV_PORT and WP_ENV_TESTS_PORT.`
		);
	}

	// Renamed into place, so a reader never sees a half-written record.
	const temp = path.join(claimsDir, `${pair.port}.${process.pid}.tmp`);
	fs.writeFileSync(temp, owner);
	fs.renameSync(temp, path.join(claimsDir, String(pair.port)));

	return pair;
}

module.exports = { selectPorts };
