import { eosIsReady } from './cli-utils/blockchainManagement';
import { stopContainer } from './cli-utils/dockerImageManagement';
import { startEos } from './cli-utils/blockchainManagement';
import { runTests } from './cli-utils/runTests';
import { buildAll } from './cli-utils/contactBuilding';
import { GitIgnoreManager } from '../gitignoreManager';
import { ConfigManager } from '../configManager';
import { sleep } from '../utils';
const { Command } = require('commander');
const program = new Command();

program
	.option('-g, --grep <value>', 'grep pattern to pass to Mocha')
	.option('-s, --skip-build', 'Skip building the smart contracts and just run the tests')
	.option('-p, --path <string>', 'contract path')
	.option('-c, --contracts [string...]', 'select contracts to compile')
	.option('-D, --defines [value...]', 'Addtional -D arguments that will be passed to eosio-cpp')
	.option('-f, --force', 'Force-compile all contracts, even if they have not changed')
	.parse(process.argv);

console.log(
	'Running tests with options:',
	JSON.stringify(
		{
			grep: program.grep,
			skipBuild: program.skipBuild,
			path: program.path,
			contracts: program.contracts,
		},
		null,
		4
	)
);

/**
 * Executes a build and test procedure
 * @note Keep alive setup is incomplete
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @author Dallas Johnson <github.com/dallasjohnson>
 */
const run = async (options: { grep?: string | undefined } | undefined) => {
	// Initialize the configuration
	await ConfigManager.initWithDefaults();

	// Stop running instances for fresh test environment
	if (await eosIsReady()) {
		await stopContainer();
	}

	// Start an EOSIO instance if not running
	if (!(await eosIsReady())) {
		await startEos();
	}
	// Start compiling smart contracts
	if (!program.skipBuild) {
		await buildAll(false, [program.path], program.contracts, program.defines, program.force);
	} else {
		await sleep(500);
	}
	// Begin running tests
	await runTests(options);
	// Stop EOSIO instance if keepAlive is false
	if (!ConfigManager.keepAlive) {
		await stopContainer();
	}
};

run(program).catch(async (error) => {
	process.exitCode = 1;
	console.log(error);

	if (!ConfigManager.keepAlive && (await eosIsReady())) {
		await stopContainer();
	}
});
