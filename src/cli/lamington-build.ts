import { eosIsReady, startEos, stopContainer, buildAll } from './utils';
import { ConfigManager } from '../configManager';

import { Command } from 'commander';
const program = new Command();

program
	.option('-p, --path <string>', 'contract path')
	.option('-c, --contracts [string...]', 'select contracts to compile')
	.parse();

console.log(
	'Running build with options:',
	JSON.stringify(
		{
			path: program.path,
			contracts: program.contracts,
		},
		null,
		4
	)
);

/**
 * Executes a contract build procedure
 * @note Keep alive setup is incomplete
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @author Dallas Johnson <github.com/dallasjohnson>
 */
const run = async () => {
	// Initialize Lamington configuration
	await ConfigManager.initWithDefaults();
	// Start the EOSIO container image if it's not running.
	if (!(await eosIsReady())) {
		await startEos();
	}
	// Build all smart contracts
	await buildAll([program.path], program.contracts);
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
