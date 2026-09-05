import * as path from 'path';
import * as mkdirp from 'mkdirp';
import { exists, glob, rimraf, writeFile, readFile, WORKING_DIRECTORY } from './cli-utils';
import { ConfigManager } from '../../configManager';
import { sleep } from '../../utils';
import { docker } from './dockerImageManagement';
import axios from 'axios';
import * as spinner from './logIndicator';
import { versionFromUrl, CONFIG_DIRECTORY } from './dockerImageManagement';
import * as fs from 'fs';
import * as crypto from 'crypto';

/** @hidden Snapshot directory path */
const SNAPSHOT_DIRECTORY = path.join('.lamington', 'snapshots');


/** @hidden Number of one second polls to await full system contract initialization */
const SYSTEM_CONTRACT_POLL_ATTEMPTS = 180;


/** @hidden Snapshot metadata structure */
export interface SnapshotMetadata {
	timestamp: string;
	eosVersion: string;
	contractsVersion: string;
	blockHeight: number;
	systemContractsInstalled: boolean;
	systemContractHash?: string;
	genesisHash?: string;
	rammarketInitialized?: boolean;
	initializationComplete?: boolean;
}

/**
 * Ensures snapshot directory exists
 * @returns Path to snapshot directory
 */
const ensureSnapshotDirectory = async (): Promise<string> => {
	const snapshotDir = path.join(WORKING_DIRECTORY, SNAPSHOT_DIRECTORY);
	await mkdirp(snapshotDir, {});
	return snapshotDir;
};

/**
 * Generates snapshot filename based on current configuration
 * @returns Snapshot filename with metadata
 */
const generateSnapshotFilename = async (): Promise<string> => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const eosVersion = versionFromUrl(ConfigManager.eos);
	const contractsVersion = ConfigManager.contracts;

	return `snapshot-${timestamp}-eos-${eosVersion}-contracts-${contractsVersion}.tar.gz`;
};

/**
 * Hashes the genesis file the chain is started from. The chain id is derived
 * from genesis, so a snapshot taken under a different genesis belongs to a
 * different chain and must not be restored over this one.
 * @returns Hex sha256 of genesis.json, or empty string when it cannot be read
 */
const getGenesisHash = (): string => {
	try {
		const genesis = fs.readFileSync(path.join(CONFIG_DIRECTORY, 'genesis.json'));
		return crypto.createHash('sha256').update(genesis).digest('hex');
	} catch (error) {
		console.log('Could not read genesis.json to hash it');
		return '';
	}
};

/**
 * Checks if system contracts are installed and initialized
 * @returns True if system contracts are installed and initialized
 */
export const areSystemContractsInstalled = async (): Promise<boolean> => {
	try {
		// Check if eosio.system contract is installed and has expected tables
		const result = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_code`, {
			account_name: 'eosio',
			code_as_wasm: 1,
		});

		// Check for system contract hash (not the default bios hash)
		const hasSystemContract =
			result.data.code_hash !== 'bfa1211a432693fa0b5a537f47fe8460009e5165197725254d41fe09be9dff14';

		if (!hasSystemContract) {
			return false;
		}

		// Additional check: verify that system contract tables are initialized
		try {
			const rammarketResult = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_table_rows`, {
				json: true,
				code: 'eosio',
				scope: 'eosio',
				table: 'rammarket',
				limit: 1,
			});

			// Check if rammarket table has expected data (indicating proper initialization)
			const hasRammarketData =
				rammarketResult.data && rammarketResult.data.rows && rammarketResult.data.rows.length > 0;

			return hasRammarketData;
		} catch (tableError) {
			console.log('System contract tables not fully initialized yet');
			return false;
		}
	} catch (error) {
		return false;
	}
};

/**
 * Gets current blockchain info
 * @returns Blockchain information
 */
const getBlockchainInfo = async (): Promise<any> => {
	const response = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_info`, {});
	return response.data;
};

/**
 * Waits until every block produced so far is irreversible.
 *
 * A snapshot only captures blocks.log, which holds irreversible blocks. The
 * reversible block database is excluded because nodeos rejects it as dirty and
 * rebuilds it on replay. That means anything not yet irreversible when the
 * snapshot is taken is simply lost.
 *
 * It matters most for exactly the case snapshots exist to serve: taking one
 * immediately after initialization. On a fast machine the last steps of
 * init_blockchain.sh, including the `init` action that creates the rammarket
 * table, are still reversible, so restoring produced a chain that looked
 * initialized but had no system contract state. On a slow machine the same code
 * worked, because initialization took long enough for irreversibility to catch
 * up on its own.
 *
 * @param attempts Number of half second polls before giving up
 * @returns True once the head block is irreversible
 */
const waitForIrreversibility = async (attempts: number = 120): Promise<boolean> => {
	const { head_block_num: target } = await getBlockchainInfo();

	for (let attempt = 0; attempt < attempts; attempt++) {
		const { last_irreversible_block_num: irreversible } = await getBlockchainInfo();
		if (irreversible >= target) return true;
		await sleep(500);
	}

	return false;
};

/**
 * Checks if snapshot is compatible with current configuration
 * @param metadata Snapshot metadata
 * @returns True if compatible
 */
export const isSnapshotCompatible = (metadata: SnapshotMetadata): boolean => {
	const currentEosVersion = versionFromUrl(ConfigManager.eos);
	const currentContractsVersion = ConfigManager.contracts;

	// Allow minor version differences but require same major version
	const eosVersionMatch = metadata.eosVersion.split('.')[0] === currentEosVersion.split('.')[0];
	const contractsVersionMatch = metadata.contractsVersion === currentContractsVersion;

	// Check if snapshot has complete initialization (prefer fully initialized snapshots)
	const hasCompleteInitialization = metadata.initializationComplete === true;

	// A snapshot taken under a different genesis is a different chain. Snapshots
	// written before this was recorded have no hash and cannot be trusted.
	const genesisMatch = !!metadata.genesisHash && metadata.genesisHash === getGenesisHash();

	return eosVersionMatch && contractsVersionMatch && hasCompleteInitialization && genesisMatch;
};

/**
 * Gets the current container ID
 * @returns Container ID or null
 */
const getContainerId = async (): Promise<string | null> => {
    try {

			// Try the format approach first
			// Anchor the filter: `--filter name=` is a substring match, so an unanchored
			// name matches unrelated containers and returns several ids at once
			const result = await docker.command(
				`ps --filter name=^${ConfigManager.containerName}$ --format {{.ID}}`
			);

			// Fix: Parse from raw output instead of containerList
			if (result.raw && result.raw.trim()) {
				const containerId = result.raw.trim();
				return containerId;
			}

			// Try alternative approach if format didn't work
			const inspectResult = await docker.command(
				`ps --filter name=^${ConfigManager.containerName}$`
			);

			// Parse from alternative format
			if (inspectResult.raw) {
				const lines = inspectResult.raw.split('\n');
				if (lines.length > 1) {
					const containerId = lines[1].trim().split(' ')[0];
					if (containerId) {
						return containerId;
					}
				}
			}

			return null;
		} catch (error) {
			console.error('Error getting container ID:', error);
			return null;
		}
};

/**
 * Creates a backup of the docker volume containing blockchain data
 * @param backupPath Path to save backup
 * @returns True if backup successful
 */
/**
 * Creates a backup of the docker volume containing blockchain data
 * @param backupPath Path to save backup
 * @returns True if backup successful
 */
const dockerVolumeBackup = async (backupPath: string): Promise<boolean> => {
	try {

				// Get the container ID
				const containerId = await getContainerId();

				if (!containerId) {
					throw new Error('No running container found');
				}


				// Try to pause the blockchain process to avoid file changes during backup
				try {
					await docker.command(`exec ${containerId} pkill -STOP nodeos`);
					await new Promise((resolve) => setTimeout(resolve, 2000));
				} catch (pauseError) {
					// Pausing is best effort: it only reduces file churn during the
					// backup. tar runs with --ignore-failed-read either way.
				}

				try {
					// Create backup using docker exec and tar with file exclusion

					// Use tar with ignore errors and exclude volatile files that cause issues
					// NOTE: every option must come BEFORE the `-C`/member arguments. tar
					// applies --exclude positionally, so options listed after `data` are
					// silently ignored and nothing is excluded at all.
					//
					// `state` and `blocks/reversible` are memory mapped databases that are
					// captured mid-write while nodeos is paused, so nodeos rejects them with
					// a dirty flag. `state-history` is an append only index which the replay
					// rewrites, and shipping it makes nodeos die with a fatal
					// state_history_write_exception. All three are rebuilt from blocks.log,
					// so leave them out: only blocks.log/blocks.index need to be captured,
					// the archive stays small, and the restore replays cleanly.
					const tarCommand =
						`exec ${containerId} tar czf /backup.tar.gz ` +
						`--ignore-failed-read ` +
						`--warning=no-file-changed ` +
						`--exclude=data/state ` +
						`--exclude=data/blocks/reversible ` +
						`--exclude=data/state-history ` +
						`-C /mnt/dev data`;

					await docker.command(tarCommand);

					// Copy backup from container to host
					await docker.command(`cp ${containerId}:/backup.tar.gz ${backupPath}`);

					// Clean up backup file from container
					await docker.command(`exec ${containerId} rm /backup.tar.gz`);

					return true;
				} catch (backupError) {
					console.error(
						'Primary backup method failed, trying fallback:',
						(backupError as Error).message
					);

					// Fallback: Try copying individual directories instead of full tar
					try {

						// Create a temporary directory structure
						await docker.command(`exec ${containerId} mkdir -p /backup_data`);

						// Copy blocks only: state and reversible are rebuilt on replay
						await docker.command(`exec ${containerId} cp -r /mnt/dev/data/blocks /backup_data/`);
						await docker.command(`exec ${containerId} rm -rf /backup_data/blocks/reversible`);

						// Create tar of the copied data
						await docker.command(`exec ${containerId} tar czf /backup.tar.gz -C /backup_data .`);
						await docker.command(`cp ${containerId}:/backup.tar.gz ${backupPath}`);
						await docker.command(`exec ${containerId} rm -rf /backup_data /backup.tar.gz`);

						return true;
					} catch (fallbackError) {
						console.error('Fallback backup also failed:', (fallbackError as Error).message);
						return false;
					}
				}
			} finally {
		// Resume the blockchain process
		try {
			const containerId = await getContainerId();
			if (containerId) {
				await docker.command(`exec ${containerId} pkill -CONT nodeos`);
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		} catch (resumeError) {
			// Best effort: the backup result is already decided, and the container
			// may legitimately be gone by now.
		}
	}
};

/**
 * Restores blockchain data from a backup
 * @param backupPath Path to backup file
 * @returns True if restore successful
 */
const dockerVolumeRestore = async (backupPath: string): Promise<boolean> => {
	try {

		// Get the current container ID
		const containerId = await getContainerId();

		if (!containerId) {
			throw new Error('No running container found for restoration');
		}


		// Check if nodeos process exists before trying to pause it
		try {
			const checkProcessResult = await docker.command(`exec ${containerId} pgrep nodeos`);
			const hasNodeosProcess = checkProcessResult.raw && checkProcessResult.raw.trim();

			if (hasNodeosProcess) {
				// Pause the blockchain process during restoration
				await docker.command(`exec ${containerId} pkill -STOP nodeos`);
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
		} catch (checkError) {
			// Continue without pausing if we can't check
		}

		try {
			// Copy backup into the running container
			await docker.command(`cp ${backupPath} ${containerId}:/restore.tar.gz`);

			// Remove old data and extract new data
			await docker.command(`exec ${containerId} rm -rf /mnt/dev/data`);
			await docker.command(`exec ${containerId} mkdir -p /mnt/dev/data`);
			await docker.command(`exec ${containerId} tar xzf /restore.tar.gz -C /mnt/dev`);

			// Clean up backup file
			await docker.command(`exec ${containerId} rm /restore.tar.gz`);

			return true;
		} finally {
			// Only resume if we actually paused
			try {
				const checkProcessResult = await docker.command(`exec ${containerId} pgrep nodeos`);
				const hasNodeosProcess = checkProcessResult.raw && checkProcessResult.raw.trim();

				if (hasNodeosProcess) {
					await docker.command(`exec ${containerId} pkill -CONT nodeos`);
					await new Promise((resolve) => setTimeout(resolve, 2000));
				}
			} catch (checkError) {
				// Nothing to resume, or the container is already gone. The restore
				// itself has either succeeded or thrown by this point, so failing to
				// resume must not mask that result.
			}
		}
	} catch (error) {
		console.error('Docker volume restore failed:', error);
		return false;
	}
};

/**
 * Creates a snapshot of the current blockchain state
 * @param snapshotName Optional custom name for snapshot
 * @returns Path to created snapshot
 */
export const createSnapshot = async (snapshotName?: string): Promise<string> => {
	spinner.create('Creating blockchain snapshot');

	try {
				// Everything the snapshot captures has to be irreversible first, or the
				// tail of it is dropped and the restored chain is quietly incomplete
				if (!(await waitForIrreversibility())) {
					throw new Error('Timed out waiting for the chain to become irreversible');
				}

				// Ensure snapshot directory exists
				const snapshotDir = await ensureSnapshotDirectory();

				// Generate filename if not provided
				const filename = snapshotName || (await generateSnapshotFilename());
				const snapshotPath = path.join(snapshotDir, filename);

				// Get current blockchain info for metadata
				const blockchainInfo = await getBlockchainInfo();

				// Create metadata with enhanced system contract information
				const systemContractsInstalled = await areSystemContractsInstalled();

				// Get system contract hash for metadata
				let systemContractHash = '';
				let rammarketInitialized = false;

				try {
					const codeResult = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_code`, {
						account_name: 'eosio',
						code_as_wasm: 1,
					});
					systemContractHash = codeResult.data.code_hash;
				} catch (error) {
					console.log('Could not get system contract hash for metadata');
				}

				try {
					const rammarketResult = await axios.post(
						`${ConfigManager.rpcEndpoint}/v1/chain/get_table_rows`,
						{
							json: true,
							code: 'eosio',
							scope: 'eosio',
							table: 'rammarket',
							limit: 1,
						}
					);
					rammarketInitialized =
						rammarketResult.data &&
						rammarketResult.data.rows &&
						rammarketResult.data.rows.length > 0;
				} catch (error) {
					console.log('Could not verify rammarket table for metadata');
				}

				const metadata: SnapshotMetadata = {
					timestamp: new Date().toISOString(),
					eosVersion: versionFromUrl(ConfigManager.eos),
					contractsVersion: ConfigManager.contracts,
					blockHeight: blockchainInfo.head_block_num,
					systemContractsInstalled: systemContractsInstalled,
					systemContractHash: systemContractHash,
					genesisHash: getGenesisHash(),
					rammarketInitialized: rammarketInitialized,
					initializationComplete: systemContractsInstalled && rammarketInitialized,
				};

				// Create snapshot using docker volume backup
				const snapshotSuccess = await dockerVolumeBackup(snapshotPath);

				if (!snapshotSuccess) {
					throw new Error('Failed to create docker volume backup');
				}

				// Save metadata
				const metadataPath = `${snapshotPath}.metadata.json`;
				await writeFile(metadataPath, JSON.stringify(metadata, null, 2));

				spinner.end(`Snapshot created: ${filename}`);
				return snapshotPath;
			} catch (error) {
		spinner.fail('Failed to create snapshot');
		console.error(`Snapshot creation error: ${error}`);
		throw error;
	}
};

/**
 * Restores blockchain from a snapshot
 * @param snapshotName Name of snapshot to restore from
 * @returns True if restoration successful
 */
export const restoreSnapshot = async (snapshotName: string): Promise<boolean> => {
	spinner.create(`Restoring from snapshot: ${snapshotName}`);

	try {
		const snapshotDir = await ensureSnapshotDirectory();
		const snapshotPath = path.join(snapshotDir, snapshotName);
		const metadataPath = `${snapshotPath}.metadata.json`;

		// Validate snapshot exists
		if (!(await exists(snapshotPath))) {
			throw new Error(`Snapshot ${snapshotName} not found`);
		}

		// Load and validate metadata
		const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as SnapshotMetadata;

		if (!isSnapshotCompatible(metadata)) {
			throw new Error('Snapshot is not compatible with current configuration');
		}

		// Restore from snapshot
		const restoreSuccess = await dockerVolumeRestore(snapshotPath);

		if (!restoreSuccess) {
			throw new Error('Failed to restore from snapshot');
		}

		spinner.end('Blockchain restored from snapshot');
		return true;
	} catch (error) {
		spinner.fail('Failed to restore snapshot');
		console.error(`Snapshot restoration error: ${error}`);
		return false;
	}
};

/**
 * Lists available snapshots
 * @returns Array of snapshot information
 */
export const listSnapshots = async (): Promise<
	Array<{ name: string; metadata: SnapshotMetadata }>
> => {
	const snapshotDir = await ensureSnapshotDirectory();
	const files = await glob('*.tar.gz', { cwd: snapshotDir });

	const snapshots = [];

	for (const file of files) {
		const metadataPath = path.join(snapshotDir, `${file}.metadata.json`);
		if (await exists(metadataPath)) {
			const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
			snapshots.push({ name: file, metadata });
		}
	}

	// Sort by timestamp (newest first)
	return snapshots.sort(
		(a, b) => new Date(b.metadata.timestamp).getTime() - new Date(a.metadata.timestamp).getTime()
	);
};

/**
 * Deletes a snapshot
 * @param snapshotName Name of snapshot to delete
 * @returns True if deletion successful
 */
export const deleteSnapshot = async (snapshotName: string): Promise<boolean> => {
	try {
		const snapshotDir = await ensureSnapshotDirectory();
		const snapshotPath = path.join(snapshotDir, snapshotName);
		const metadataPath = `${snapshotPath}.metadata.json`;

		if (await exists(snapshotPath)) {
			await rimraf(snapshotPath);
		}

		if (await exists(metadataPath)) {
			await rimraf(metadataPath);
		}

		return true;
	} catch (error) {
		console.error(`Failed to delete snapshot ${snapshotName}:`, error);
		return false;
	}
};

/**
 * Cleans up old snapshots according to retention policy
 * @param maxRetention Maximum number of snapshots to keep
 * @returns Number of snapshots deleted
 */
export const cleanupSnapshots = async (
	maxRetention: number = ConfigManager.snapshotRetention
): Promise<number> => {
	const snapshots = await listSnapshots();

	if (snapshots.length <= maxRetention) {
		return 0;
	}

	const toDelete = snapshots.slice(maxRetention);
	let deletedCount = 0;

	for (const snapshot of toDelete) {
		if (await deleteSnapshot(snapshot.name)) {
			deletedCount++;
		}
	}

	return deletedCount;
};

/**
 * Deletes all existing snapshots
 * @returns Number of snapshots deleted
 */
export const deleteAllSnapshots = async (): Promise<number> => {
	const snapshots = await listSnapshots();
	let deletedCount = 0;

	for (const snapshot of snapshots) {
		if (await deleteSnapshot(snapshot.name)) {
			deletedCount++;
		}
	}

	return deletedCount;
};
/**
 * Finds the newest snapshot compatible with the current configuration
 * @returns Compatible snapshot, or null when none exist
 */
export const findCompatibleSnapshot = async (): Promise<{
	name: string;
	metadata: SnapshotMetadata;
} | null> => {
	const snapshots = await listSnapshots();

	return snapshots.find((snapshot) => isSnapshotCompatible(snapshot.metadata)) || null;
};

/**
 * Polls until the system contracts report as fully initialized
 * @param maxAttempts Maximum number of one second polls
 * @returns True once the system contracts are initialized, false on timeout
 */
export const waitForSystemContracts = async (
	maxAttempts: number = SYSTEM_CONTRACT_POLL_ATTEMPTS
): Promise<boolean> => {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			if (await areSystemContractsInstalled()) {
				console.log(`System contracts fully initialized after ${attempt} attempt(s)`);
				return true;
			}

			console.log(`System contracts not fully initialized yet, attempt ${attempt}/${maxAttempts}`);
		} catch (error) {
			console.log(`Error checking system contract initialization: ${(error as Error).message}`);
		}

		await sleep(1000);
	}

	return false;
};

/**
 * Creates a snapshot of the fully initialized blockchain, unless a compatible
 * snapshot already exists. Never throws; snapshots are an optimisation, so a
 * failure here must not fail the caller.
 * @returns Path to the created snapshot, or null when none was created
 */
export const createSnapshotIfNeeded = async (): Promise<string | null> => {
	if (!ConfigManager.autoCreateSnapshot) {
		return null;
	}

	try {
		const compatibleSnapshot = await findCompatibleSnapshot();

		if (compatibleSnapshot) {
			console.log('Compatible snapshot already exists, skipping snapshot creation');
			return null;
		}

		console.log('No compatible snapshot found, waiting for full initialization before snapshot');

		if (!(await waitForSystemContracts())) {
			console.log('System contracts never fully initialized, skipping snapshot creation');
			return null;
		}

		// No explicit name: the generated filename carries the eos and contracts
		// versions, so snapshots for different toolchains coexist under retention
		const snapshotPath = await createSnapshot();
		console.log(`Snapshot created successfully: ${snapshotPath}`);

		// Trim to the retention policy rather than wiping every other snapshot,
		// so snapshots for other eos/contracts versions survive
		const deletedCount = await cleanupSnapshots();
		if (deletedCount > 0) {
			console.log(`Removed ${deletedCount} snapshot(s) beyond the retention limit`);
		}

		return snapshotPath;
	} catch (error) {
		console.log(`Failed to create snapshot: ${(error as Error).message}`);
		return null;
	}
};
