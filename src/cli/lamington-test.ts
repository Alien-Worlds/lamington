import { eosIsReady, startEos, runTests, stopContainer, buildAll } from './utils';
import { GitIgnoreManager } from '../gitignoreManager';
import { ConfigManager } from '../configManager';
import { sleep } from '../utils';
const { Command } = require('commander');
const program = new Command();

program
	.option('-g, --grep <value>', 'grep pattern to pass to Mocha')
	.option('-s, --skip-build', 'Skip building the smart contracts and just run the tests')
	.option('-D, --defines [value...]', 'Addtional -D arguments that will be passed to eosio-cpp')
	.parse(process.argv);

// const options = prog.args;

console.log('Running tests with grep filter:', program.grep);
console.log('Running tests with skipBuild:', program.skipBuild);
/**
 * Executes a build and test procedure
 * @note Keep alive setup is incomplete
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
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
		await buildAll(undefined, program.defines);
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
