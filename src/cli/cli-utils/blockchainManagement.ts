import axios, { AxiosRequestConfig } from 'axios';
import * as qrcode from 'qrcode-terminal';
import { sleep } from '../../utils';
import { buildImage, imageExists, startContainer, versionFromUrl } from './dockerImageManagement';
import * as spinner from './logIndicator';
import { ConfigManager } from '../../configManager';
import {
	createSnapshot,
	restoreSnapshot,
	listSnapshots,
	areSystemContractsInstalled,
	isSnapshotCompatible,
} from './blockchainSnapshotManagement';

/** @hidden Maximum number of EOS connection attempts before fail */
export const MAX_CONNECTION_ATTEMPTS = 40;

/**
 * Pulls the EOSIO docker image if it doesn't exist and starts
 * a new EOSIO docker container
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 */

export const startEos = async (useSnapshot?: boolean) => {
	// spinner.create('Starting EOS docker container');
	// Ensure an EOSIO build image exists
	console.log('Starting EOS docker container');
	console.log('ensure an EOSIO build image exists');

	// Check if we should use snapshot
	const shouldUseSnapshot = useSnapshot || false; // TODO: Add ConfigManager.useSnapshots

	if (shouldUseSnapshot) {
		// Try to restore from latest compatible snapshot
		const snapshots = await listSnapshots();
		const compatibleSnapshot = snapshots.find((s) => isSnapshotCompatible(s.metadata));

		if (compatibleSnapshot) {
			console.log(`Found compatible snapshot: ${compatibleSnapshot.name}`);
			const restoreSuccess = await restoreSnapshot(compatibleSnapshot.name);

			if (restoreSuccess) {
				console.log('Blockchain restored from snapshot successfully');
				// Start container with restored data
				await startContainer();
				await untilEosIsReady();
				console.log(
					'                                        \n\
\
==================================================== \n\
\
     EOS running from snapshot, admin account created.            \n\
\
     RPC: http://localhost:8888                     \n\\t Docker Container: lamington                    \n\
\
==================================================== \n'
				);
				spinner.end('Started EOS docker container from snapshot');
				return;
			} else {
				console.log('Snapshot restoration failed, falling back to full initialization');
			}
		} else {
			console.log('No compatible snapshot found, proceeding with full initialization');
		}
	}
	if (!(await imageExists())) {
		console.log('--------------------------------------------------------------');
		console.log('Docker image does not yet exist. Building...');
		console.log(
			'Note: This will take a few minutes but only happens once for each version of the EOS tools you use.'
		);
		console.log();
		console.log(`We've prepared some hold music for you: https://youtu.be/6g4dkBF5anU`);
		console.log();
		qrcode.generate('https://youtu.be/6g4dkBF5anU');
		// Build EOSIO image
		await buildImage();
	}
	// Start EOSIO
	try {
		// Start the EOS docker container
		console.log('starting container');
		await startContainer();
		// Pause process until ready
		console.log('started container');

		await untilEosIsReady();
		console.log(
			'                                        \n\
==================================================== \n\
                                                     \n\
      EOS running, admin account created.            \n\
                                                     \n\
      RPC: http://localhost:8888                     \n\
	  Docker Container: lamington                    \n\
                                                     \n\
==================================================== \n'
		);
		spinner.end('Started EOS docker container');

		// Auto-create snapshot if configured and system contracts are installed
		if (false) {
			// TODO: Add ConfigManager.autoCreateSnapshot
			try {
				const contractsInstalled = await areSystemContractsInstalled();
				if (contractsInstalled) {
					console.log('Auto-creating snapshot after system contracts installation...');
					await createSnapshot();
				}
			} catch (snapshotError) {
				console.log('Failed to auto-create snapshot:', snapshotError);
			}
		}
	} catch (error) {
		spinner.fail('Failed to start the EOS container');
		console.log(` --> ${error}`);
		process.exit(1);
	}
};
/**
 * Determines if EOS is available using the `get_code` from eosio query response
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @returns EOS instance availability
 */

export const eosIsReady = async () => {
	try {
		const data = JSON.stringify({ account_name: 'eosio', code_as_wasm: 1 });

		const config: AxiosRequestConfig = {
			method: 'POST',
			url: 'http://localhost:8888/v1/chain/get_code',
			headers: {
				'Content-Type': 'application/json',
			},
			data: data,
		};

		const info = await axios(config);

		return (
			info &&
			info.status === 200 &&
			info.data &&
			info.data.code_hash != 'bfa1211a432693fa0b5a537f47fe8460009e5165197725254d41fe09be9dff14'
		);
	} catch (error) {
		return false;
	}
};
/**
 * Sleeps the process until the EOS instance is available
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @returns Connection success or throws error
 */

export const untilEosIsReady = async (attempts: number = MAX_CONNECTION_ATTEMPTS) => {
	// Begin logging
	spinner.create('Waiting for EOS');
	// Repeat attempts every second until threshold reached
	let attempt = 0;
	while (attempt < attempts) {
		attempt++;
		// Check EOS status
		if (await eosIsReady()) {
			spinner.end('EOS is ready');
			return true;
		}
		// Wait one second
		await sleep(1000);
	}
	// Failed to connect within attempt threshold
	spinner.fail(`Failed to connect with an EOS instance`);
	throw new Error(`Could not contact EOS after trying for ${attempts} second(s).`);
};


