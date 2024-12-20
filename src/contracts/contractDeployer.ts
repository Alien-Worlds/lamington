import * as path from 'path';
import { readFile as readFileCallback, exists as existsCallback } from 'fs';
import { promisify } from 'util';
import { Serialize } from 'eosjs';
import * as ecc from 'eosjs-ecc';
import * as globCallback from 'glob';

const exists = promisify(existsCallback);
const readFile = promisify(readFileCallback);
const glob = promisify(globCallback);

import { Contract } from './contract';
import { Account, AccountManager } from '../accounts';
import { EOSManager } from '../eosManager';
import { ConfigManager } from '../configManager';
import { ContractLoader } from './contractLoader';

/**
 * Provides a set of methods to manage contract deployment
 */
export class ContractDeployer {
	/**
	 * Deploys contract files to a specified account
	 *
	 * ```typescript
	 * // Create a new account
	 * const account = await AccountManager.createAccount();
	 * // Deploy the contract `mycontract` to the account
	 * ContractDeployer.deployToAccount<MyContractTypeDef>('mycontract', account);
	 * ```
	 * @author Kevin Brown <github.com/thekevinbrown>
	 * @param contractIdentifier Contract identifier, typically the contract filename minus the extension
	 * @param account Account to apply contract code
	 * @returns Deployed contract instance
	 */
	public static async deployToAccount<T extends Contract>(
		contractIdentifier: string,
		account: Account
	) {
		EOSManager.addSigningAccountIfMissing(account);

		// Initialize the serialization buffer
		const buffer = new Serialize.SerialBuffer({
			textEncoder: EOSManager.api.textEncoder,
			textDecoder: EOSManager.api.textDecoder,
		});

		const abiPaths = await glob(`${ConfigManager.outDir}/**/${contractIdentifier}.abi`);
		const abiPath = abiPaths[0];

		if (!abiPath) {
			throw new Error(
				`ContractDeployer couldn't find ABI for ${contractIdentifier}. Are you sure you used the correct contract identifier?`
			);
		}

		const wasmPaths = await glob(`${ConfigManager.outDir}/**/${contractIdentifier}.wasm`);
		const wasmPath = wasmPaths[0];

		if (!wasmPath) {
			throw new Error(
				`ContractDeployer couldn't find WASM file for ${contractIdentifier}. Are you sure you used the correct contract identifier?`
			);
		}

		// Read resources files for paths
		let abi = JSON.parse(await readFile(abiPath!, 'utf8'));
		const wasm = await readFile(wasmPath!);
		// Extract ABI types
		const abiDefinition = EOSManager.api.abiTypes.get(`abi_def`);
		// Validate ABI definitions returned
		if (!abiDefinition)
			throw new Error('Could not retrieve abiDefinition from EOS API when flattening ABIs.');
		// Ensure ABI contains all fields from `abiDefinition.fields`
		abi = abiDefinition!.fields.reduce(
			(acc, { name: fieldName }) => Object.assign(acc, { [fieldName]: acc[fieldName] || [] }),
			abi
		);
		// Serialize ABI type definitions
		abiDefinition!.serialize(buffer, abi);

		try {
			// Set the contract code for the account
			await EOSManager.transact({
				actions: [
					{
						account: 'eosio',
						name: 'setcode',
						authorization: account.active,
						data: {
							account: account.name,
							vmtype: 0,
							vmversion: 0,
							code: wasm.toString('hex'),
						},
					},
					{
						account: 'eosio',
						name: 'setabi',
						authorization: account.active,
						data: {
							account: account.name,
							abi: Buffer.from(buffer.asUint8Array()).toString(`hex`),
						},
					},
				],
			});
		} catch (e) {
			/* If this exact version of the contract is already deployed, the error can safely be ignored */
			if (e.json.error.what != 'Contract is already running this version of code') {
				throw e;
			}
		}

		return await ContractLoader.at<T>(account);
	}

	/**
	 * Deploys contract files to a randomly generated account
	 *
	 * ```typescript
	 * // Deploy the contract with identifier
	 * ContractDeployer.deploy<MyContractTypeDef>('mycontract');
	 * ```
	 *
	 * @author Kevin Brown <github.com/thekevinbrown>
	 * @param contractIdentifier Contract identifier, typically the contract filename minus the extension
	 * @returns Deployed contract instance
	 */
	public static async deploy<T extends Contract>(contractIdentifier: string) {
		// Create a new account
		const account = await AccountManager.createAccount();
		// Call the deployToAccount method with the account
		return await ContractDeployer.deployToAccount<T>(contractIdentifier, account);
	}

	/**
	 * Deploys contract files to a specified account name
	 *
	 * ```typescript
	 * // Deploy the `mycontract` contract to the account with name `mycontractname`
	 * ContractDeployer.deployWithName<MyContractTypeDef>('mycontract', 'mycontractname');
	 * ```
	 *
	 * @note Generating a pseudorandom private key is not safe in the cryptographic sense. It can be used for testing.
	 * @author Mitch Pierias <github.com/MitchPierias>
	 * @param contractIdentifier Contract identifier, typically the contract filename minus the extension
	 * @param accountName Account name
	 * @returns Deployed contract instance
	 */
	public static async deployWithName<T extends Contract>(
		contractIdentifier: string,
		accountName: string
	) {
		// Initialize account with name
		const account = new Account(accountName, EOSManager.adminAccount.privateKey!);
		await AccountManager.setupAccount(account);

		// Call the deployToAccount method with the account
		return await ContractDeployer.deployToAccount<T>(contractIdentifier, account);
	}
}
