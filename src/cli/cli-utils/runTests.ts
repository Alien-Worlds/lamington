import * as Mocha from 'mocha';
import * as path from 'path';
import * as minimatch from 'minimatch';
import { EOSManager } from '../../eosManager';
import { ConfigManager } from '../../configManager';
import { exists, WORKING_DIRECTORY, glob } from './cli-utils';

/** @hidden Slowest Expected test duration */
export const TEST_EXPECTED_DURATION = 5000;
/** @hidden Maximum test duration */
export const TEST_TIMEOUT_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Loads all test files and executes with Mocha
 * @author Kevin Brown <github.com/thekevinbrown>
 * @note This is where we should allow configuration over all files or specified files/folder
 */

export const runTests = async (options?: { grep?: string }) => {
	// Initialize the EOS connection manager
	EOSManager.initWithDefaults();
	// Register ts-mocha if it's a Typescript project
	if (await exists(path.join(WORKING_DIRECTORY, 'tsconfig.json'))) {
		require('ts-mocha');
	}

	// Register their .env file variables if they have one.
	if (await exists(path.join(WORKING_DIRECTORY, '.env'))) {
		require('dotenv').config({ path: path.join(WORKING_DIRECTORY, '.env') });
	}

	// Find all existing test file paths
	const files = [
		// All ts and js files under the test folder get added.
		// ...(await glob('{test,tests}/**/*.{js,ts}')),
		// Any .test.ts, .test.js, .spec.ts, .spec.js files anywhere in the working tree
		// outside of node_modules get added.
		...(await glob('**/contracts/**/*.{test,spec}.{js,ts}')),
	];

	// Filter out files matching excludeTests patterns
	const filteredFiles = files.filter(file => {
		return !ConfigManager.excludeTests.some(pattern => 
			minimatch(file, pattern)
		);
	});

	// Instantiate a Mocha instance.
	const mocha = new Mocha();
	if (options?.grep) {
		mocha.grep(options.grep);
		console.log('Applying grep filter to tests: ', options.grep);
	}

	for (const testFile of filteredFiles) {
		mocha.addFile(path.join(WORKING_DIRECTORY, testFile));
	}

	// Our tests are more like integration tests than unit tests. Taking two seconds is
	// pretty reasonable in our case and it's possible a successful test would take 10 seconds.
    mocha.slow(TEST_EXPECTED_DURATION);
    mocha.timeout(TEST_TIMEOUT_DURATION);
	mocha.reporter(ConfigManager.testReporter);
	mocha.bail(ConfigManager.bailOnFailure);

	// Run the tests.
	await new Promise<void>((resolve, reject) =>
		mocha.run((failures) => {
			if (failures) return reject(failures);
			return resolve();
		})
	);
};
