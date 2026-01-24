import * as path from 'path';
import * as mkdirp from 'mkdirp';
import { exists, glob, rimraf, writeFile, readFile, WORKING_DIRECTORY } from './cli-utils';
import { ConfigManager } from '../../configManager';
import { docker } from './dockerImageManagement';
import axios from 'axios';
import * as spinner from './logIndicator';
import { versionFromUrl } from './dockerImageManagement';

/** @hidden Snapshot directory path */
const SNAPSHOT_DIRECTORY = path.join('.lamington', 'snapshots');

/** @hidden Maximum snapshot retention */
const MAX_SNAPSHOT_RETENTION = 5;

/** @hidden Snapshot metadata structure */
export interface SnapshotMetadata {
    timestamp: string;
    eosVersion: string;
    contractsVersion: string;
    blockHeight: number;
    systemContractsInstalled: boolean;
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
 * Checks if system contracts are installed
 * @returns True if system contracts are installed
 */
export const areSystemContractsInstalled = async (): Promise<boolean> => {
	try {
		// Check if eosio.system contract is installed and has expected tables
		const result = await axios.post('http://localhost:8888/v1/chain/get_code', {
			account_name: 'eosio',
			code_as_wasm: 1,
		});

		// Check for system contract hash (not the default bios hash)
		return (
			result.data.code_hash !== 'bfa1211a432693fa0b5a537f47fe8460009e5165197725254d41fe09be9dff14'
		);
	} catch (error) {
		return false;
	}
};

/**
 * Gets current blockchain info
 * @returns Blockchain information
 */
const getBlockchainInfo = async (): Promise<any> => {
	const response = await axios.post('http://localhost:8888/v1/chain/get_info', {});
	return response.data;
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

	return eosVersionMatch && contractsVersionMatch && metadata.systemContractsInstalled;
};

/**
 * Gets the current container ID
 * @returns Container ID or null
 */
const getContainerId = async (): Promise<string | null> => {
	try {
		const result = await docker.command('ps --filter name=lamington --format {{.ID}}');
		if (result.containerList && result.containerList.length > 0) {
			return result.containerList[0].id;
		}
		return null;
	} catch (error) {
		return null;
	}
};

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

		// Create a temporary container to perform backup
		const tempContainerName = `lamington-snapshot-${Date.now()}`;

		// Create backup using docker exec and tar
		await docker.command(`exec ${containerId} tar czf /backup.tar.gz -C /mnt/dev data`);

		// Copy backup from container to host
		await docker.command(`cp ${containerId}:/backup.tar.gz ${backupPath}`);

		// Clean up backup file from container
		await docker.command(`exec ${containerId} rm /backup.tar.gz`);

		return true;
	} catch (error) {
		console.error('Docker volume backup failed:', error);
		return false;
	}
};

/**
 * Restores blockchain data from a backup
 * @param backupPath Path to backup file
 * @returns True if restore successful
 */
const dockerVolumeRestore = async (backupPath: string): Promise<boolean> => {
	try {
		// Start a new container with the backup data
		const tempContainerName = `lamington-restore-${Date.now()}`;

		// Create a temporary container
		await docker.command(`create --name ${tempContainerName} alpine`);

		// Copy backup into temporary container
		await docker.command(`cp ${backupPath} ${tempContainerName}:/backup.tar.gz`);

		// Extract backup to get the data
		await docker.command(`exec ${tempContainerName} tar xzf /backup.tar.gz`);

		// Clean up
		await docker.command(`rm ${tempContainerName}`);

		return true;
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
		// Ensure snapshot directory exists
		const snapshotDir = await ensureSnapshotDirectory();

		// Generate filename if not provided
		const filename = snapshotName || (await generateSnapshotFilename());
		const snapshotPath = path.join(snapshotDir, filename);

		// Get current blockchain info for metadata
		const blockchainInfo = await getBlockchainInfo();

		// Create metadata
		const metadata: SnapshotMetadata = {
			timestamp: new Date().toISOString(),
			eosVersion: versionFromUrl(ConfigManager.eos),
			contractsVersion: ConfigManager.contracts,
			blockHeight: blockchainInfo.head_block_num,
			systemContractsInstalled: await areSystemContractsInstalled(),
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
const deleteSnapshot = async (snapshotName: string): Promise<boolean> => {
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
const cleanupSnapshots = async (maxRetention: number = MAX_SNAPSHOT_RETENTION): Promise<number> => {
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