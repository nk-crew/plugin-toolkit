#!/usr/bin/env node

/**
 * Prints where the current checkout is served.
 *
 * A separate entry point rather than a flag on `env-ports.js`, because that one
 * is imported by the Playwright config and must stay silent.
 */

const { getPorts } = require('./env-ports.js');

const { port, testsPort } = getPorts();

console.log(`development  http://localhost:${port}`);
console.log(`tests        http://localhost:${testsPort}`);
