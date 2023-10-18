import { ConfigManager } from '../../configManager';
import { generateTypes } from '../../contracts';
import { glob } from './cli-utils';
import { compileContract } from './contractCompiling';
import * as spinner from './logIndicator';

export const getMatches = (paths: string[], matches: string[] = [], include: boolean = true) => {
	return paths.filter((filePath) => {
		const foundMatches = matches.reduce<boolean>((result, match) => {
			const pattern = new RegExp(match, 'gi');
			return result || pattern.test(filePath);
		}, false);
		return include ? foundMatches : !foundMatches;
	});
};

/**
 * Resolves the path to file identifier.
 * This is the path without trailing file extension
 * @author Kevin Brown <github.com/thekevinbrown>
 * @note What happens when the input path contains no trailing extension?
 * @param filePath Path to file
 * @returns Identifier path
 */
export const pathToIdentifier = (filePath: string) => filePath.substr(0, filePath.lastIndexOf('.'));

/**
 * Finds and builds all C++ contracts
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param path_match Optional specific contract identifiers to build
 */

export const buildAll = async (
	generateOnly: boolean,
	path_match?: string[],
	contracts_match?: string[],
	defines?: string[]
) => {
	// Find all contract files
	const errors = [];
	let contracts = await glob('!(node_modules)/**/*.cpp');
	// Cleanse ignored contracts
	// get all globs in the contract path
	contracts = getMatches(contracts, path_match || ['\\.cpp$']);
	if (contracts_match) {
		contracts = getMatches(contracts, contracts_match, true);
	} else {
		// get all globs in the config.includes
		contracts = getMatches(contracts, ConfigManager.include, true);

		// get all globs excluding the ones in the Config.exclude
		contracts = getMatches(contracts, ConfigManager.exclude, false);
	}
	if (contracts.length === 0) {
		console.error();
		console.error('Could not find any smart contracts to build.');
		process.exit(1);
	}

	// Log the batch building process
	console.log(`BUILDING ${contracts.length} SMART CONTRACT${contracts.length > 1 ? 'S' : ''}\n`);

	// Build each contract and handle errors
	for (const contract of contracts) {
		try {
			await build(contract, generateOnly, defines);
		} catch (error) {
			errors.push({
				message: `Failed to compile contract ${contract}`,
				error,
			});
		}
	}
	// Report any caught errors
	if (errors.length > 0) {
		// Print each error message and source
		for (const error of errors) console.error(error.message, '\n', ' -> ', error.error);
		// Terminate the current process
		throw new Error(
			`${errors.length} contract${errors.length > 0 ? 's' : ''} failed to compile. Quitting.`
		);
	}
};
/**
 * Builds contract resources for contract at path
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param contractPath Local path to C++ contract file
 */

export const build = async (contractPath: string, generateOnly: boolean, defines?: string[]) => {
	// Get the base filename from path and log status
	// const basename = path.basename(contractPath, '.cpp'); // Never Used
	// Compile contract at path
	let compileSucceeded: boolean = true;

	if (!generateOnly) {
		compileSucceeded = await compileContract(contractPath, defines);
	}
	// Generate Typescript definitions for contract
	if (generateOnly || compileSucceeded) {
		spinner.create(`Generating type definitions:` + contractPath);
		try {
			await generateTypes(pathToIdentifier(contractPath));
			spinner.end(`Generated type definitions: ` + contractPath);
		} catch (error) {
			spinner.fail(`Failed to generate type definitions: ` + contractPath);
			console.log(` --> ${error.message}`);
		}
	}
};
