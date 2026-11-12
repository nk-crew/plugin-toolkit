/**
 * Shared lint-staged configuration.
 *
 * Biome owns JS and JSON, stylelint owns SCSS, composer owns PHP.
 */

const path = require('node:path');
const micromatch = require('micromatch');

const DEFAULT_IGNORES = [
	'!**/.*',
	'!**/build/**/*',
	'!**/core-plugin/**/*',
	'!**/dist/**/*',
	'!**/dist-zip/**/*',
	'!**/templates/**/*',
	'!**/vendor/**/*',
	'!**/vendors/**/*',
];

/**
 * Builds a lint-staged config.
 *
 * @param {Object}   [options]         Options.
 * @param {string[]} [options.ignore]  Extra glob patterns to skip, in
 *                                     micromatch negation form.
 * @return {Object} A lint-staged configuration object.
 */
function createLintStagedConfig({ ignore = [] } = {}) {
	const patterns = [...DEFAULT_IGNORES, ...ignore];

	const run = (command) => (filenames) => {
		// lint-staged passes absolute paths, where `**` stops at a dot-directory
		// such as `~/.t3` and an ancestor named `build` matches. Match below the
		// checkout, as lint-staged does for its own globs.
		const relative = filenames.map((file) =>
			path.relative(process.cwd(), file)
		);
		const kept = new Set(micromatch(relative, patterns));
		const files = filenames.filter((file, i) => kept.has(relative[i]));

		return files.length ? `${command} ${files.join(' ')}` : [];
	};

	return {
		'**/*.php': run('composer run-script lint'),
		'**/*.{css,scss}': run('stylelint --custom-syntax postcss-scss'),
		'**/*.{js,jsx,json,jsonc}': run(
			'biome check --write --no-errors-on-unmatched --files-ignore-unknown=true'
		),
	};
}

module.exports = { createLintStagedConfig };
