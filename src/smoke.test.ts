import { assert } from 'chai';
import { spawnSync } from 'child_process';
import * as path from 'path';

/**
 * Load-time smoke tests.
 *
 * These exist because a bug that crashed `lamington snapshots` on load shipped
 * unnoticed: the CLI declared an option named `name`, which clashes with
 * commander's own `Command.name`, so the command threw before running any of
 * its code. Nothing in the suite loaded that file, so nothing caught it.
 *
 * Cheap and shallow on purpose. They assert only that every entry point can be
 * loaded and that each CLI can print its help, which is the class of failure
 * that makes the whole tool unusable rather than subtly wrong.
 *
 * This file also lives at the root of src/ deliberately: the test glob used to
 * expand only one directory deep, silently skipping root level test files.
 */

const REPO_ROOT = path.join(__dirname, '..');

/** Library modules that must be safe to import without side effects */
const LIBRARY_MODULES = [
	'./index',
	'./configManager',
	'./utils',
	'./eosManager',
	'./gitignoreManager',
	'./accounts',
	'./contracts',
	'./cli/cli-utils/cli-utils',
	'./cli/cli-utils/blockchainManagement',
	'./cli/cli-utils/blockchainSnapshotManagement',
	'./cli/cli-utils/dockerImageManagement',
	'./cli/cli-utils/contactBuilding',
	'./cli/cli-utils/contractCompiling',
	'./cli/cli-utils/runTests',
	'./cli/cli-utils/logIndicator',
];

/**
 * CLI entry points that parse arguments and so can be asked for help.
 *
 * `lamington-start`, `lamington-stop` and `lamington-init` are deliberately
 * absent: they run their work on import rather than behind an argument parser,
 * so loading them would start or stop a docker container.
 */
const CLI_ENTRY_POINTS = [
	'cli/index.ts',
	'cli/lamington-build.ts',
	'cli/lamington-test.ts',
	'cli/lamington-snapshots.ts',
];

describe('smoke', function () {
	context('library modules load', function () {
		for (const moduleName of LIBRARY_MODULES) {
			it(`should import ${moduleName}`, function () {
				assert.doesNotThrow(() => require(moduleName));
			});
		}
	});

	context('cli entry points respond to --help', function () {
		// ts-node has to compile each entry point in its own process
		this.timeout(60000);

		for (const entryPoint of CLI_ENTRY_POINTS) {
			it(`should print help for ${entryPoint}`, function () {
				const result = spawnSync(
					process.execPath,
					['-r', 'ts-node/register', path.join('src', entryPoint), '--help'],
					{
						cwd: REPO_ROOT,
						encoding: 'utf8',
						env: { ...process.env, TS_NODE_FILES: 'true' },
						timeout: 55000,
					}
				);

				const output = `${result.stdout || ''}${result.stderr || ''}`;

				assert.notInclude(output, 'Cannot find module', `${entryPoint} has an unresolved import`);
				assert.notInclude(output, 'clashes with existing property', `${entryPoint} has a bad option`);
				assert.strictEqual(result.status, 0, `${entryPoint} exited ${result.status}:\n${output}`);
				assert.include(output, 'Usage:', `${entryPoint} printed no usage text`);
			});
		}
	});
});
