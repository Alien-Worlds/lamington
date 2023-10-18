import { ConfigManager } from '../configManager';
import { eosIsReady, startEos } from './cli-utils/blockchainManagement';
import { buildAll } from './cli-utils/contactBuilding';
import { stopContainer } from './cli-utils/dockerImageManagement';

import { Command } from 'commander';
const program = new Command();

program
	.option('-p, --path <string>', 'contract path')
	.option('-c, --contracts [string...]', 'select contracts to compile')
	.option('-D, --defines [value...]', 'Addtional -D arguments that will be passed to eosio-cpp')
	.option('-g, --generateOnly', 'Only generate TypeScript types, do not compile contracts', false)
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
	await buildAll(program.generateOnly, [program.path], program.contracts, program.defines);
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
