/**
 * Shared stylelint configuration.
 *
 * Stylelint still owns SCSS: Biome does not parse it yet. Once Biome ships SCSS
 * support this file, and stylelint itself, can go.
 */

module.exports = {
	extends: '@wordpress/stylelint-config/scss',
	rules: {
		'at-rule-empty-line-before': null,
		'at-rule-no-unknown': null,
		'comment-empty-line-before': null,
		'font-weight-notation': null,
		'no-descending-specificity': null,
		'no-invalid-position-at-import-rule': null,
		'rule-empty-line-before': null,
		'selector-class-pattern': null,
		'selector-id-pattern': null,
		'value-keyword-case': null,
		'scss/at-else-empty-line-before': null,
		'scss/at-extend-no-missing-placeholder': null,
		'scss/at-if-closing-brace-newline-after': null,
		'scss/at-if-closing-brace-space-after': null,
		'scss/at-import-partial-extension': null,
		'scss/comment-no-empty': null,
		'scss/load-partial-extension': null,
		'scss/no-global-function-names': null,
		'scss/operator-no-newline-after': null,
		'scss/operator-no-unspaced': null,
		'scss/selector-no-redundant-nesting-selector': null,
	},
};
