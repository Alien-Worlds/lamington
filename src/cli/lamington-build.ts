import { eosIsReady, startEos, stopContainer, buildAll } from './utils';
import { GitIgnoreManager } from '../gitignoreManager';
import { ConfigManager } from '../configManager';
const { Command } = require('commander');
const program = new Command();

program
	.option('-p, --contract_path [value...]')
	.option('-D, --defines [value...]', 'Addtional -D arguments that will be passed to eosio-cpp')
	.parse(process.argv);

/**
 * Executes a contract build procedure
 * @note Keep alive setup is incomplete
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 */
const run = async () => {
	// Initialize Lamington configuration
	await ConfigManager.initWithDefaults();
	// Start the EOSIO container image if it's not running.
	if (!(await eosIsReady())) {
		await startEos();
	}
	// Build all smart contracts
	await buildAll(program.contract_path, program.defines);
	// And stop it if we don't have keepAlive set.
	if (!ConfigManager.keepAlive) {
		await stopContainer();
	}
};

run().catch(async (error) => {
	process.exitCode = 1;
	console.log(error);

	if (!ConfigManager.keepAlive && (await eosIsReady())) {
		await stopContainer();
	}
});
