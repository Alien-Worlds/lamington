import axios, { AxiosRequestConfig } from 'axios';
import * as qrcode from 'qrcode-terminal';
import { sleep } from '../../utils';
import {
	buildImage,
	imageExists,
	startContainer,
	resumeBlockchainInContainer,
	versionFromUrl,
} from './dockerImageManagement';
import * as spinner from './logIndicator';
import { ConfigManager } from '../../configManager';
import { restoreSnapshot, findCompatibleSnapshot } from './blockchainSnapshotManagement';

/** @hidden Maximum number of EOS connection attempts before fail */
export const MAX_CONNECTION_ATTEMPTS = 40;

/**
 * Pulls the EOSIO docker image if it doesn't exist and starts
 * a new EOSIO docker container
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 */

/**
 * Prints the "chain is up" banner, including the configured endpoint and
 * container name so it stays accurate when either is overridden
 * @param status Status line describing how the chain was started
 */
const printReadyBanner = (status: string) => {
	console.log(`
====================================================

      ${status}

      RPC: ${ConfigManager.rpcEndpoint}
      Docker Container: ${ConfigManager.containerName}

====================================================
`);
};

export const startEos = async (useSnapshot: boolean = true) => {
	// spinner.create('Starting EOS docker container');
	// Ensure an EOSIO build image exists
	console.log('Starting EOS docker container');
	console.log('ensure an EOSIO build image exists');

	// Restoring has to be asked for by the caller and enabled in config
	if (useSnapshot && ConfigManager.useSnapshots) {
		const compatibleSnapshot = await findCompatibleSnapshot();

		if (compatibleSnapshot) {
			console.log(`Found compatible snapshot: ${compatibleSnapshot.name}`);

			// Start container in empty state for snapshot restoration
			console.log('Starting container in empty state for snapshot restoration...');
			const containerStartTime = Date.now();
			await startContainer(true); // Skip initialization for snapshot restoration
			console.log(`Container started in ${Date.now() - containerStartTime}ms`);

			// Wait a short time for container to be ready
			console.log('Waiting briefly for container to stabilize...');
			await new Promise((resolve) => setTimeout(resolve, 2000));

			console.log(`Starting snapshot restoration from: ${compatibleSnapshot.name}`);
			const restoreStartTime = Date.now();
			const restoreSuccess = await restoreSnapshot(compatibleSnapshot.name);
			const restoreDuration = Date.now() - restoreStartTime;
			console.log(
				`Snapshot restoration completed in ${restoreDuration}ms, success: ${restoreSuccess}`
			);

			if (restoreSuccess) {
				console.log('Blockchain restored from snapshot successfully');

				// Now start the blockchain process in the container
				console.log('Resuming blockchain process after snapshot restoration...');
				await resumeBlockchainInContainer();

				// Wait for EOS to be ready
				console.log('Waiting for EOS to be ready after starting blockchain...');
				await untilEosIsReady(30);

				printReadyBanner('EOS running from snapshot, admin account created.');
				spinner.end('Started EOS docker container from snapshot');
				return;
			} else {
				console.log('Snapshot restoration failed, but container is running');
				// Container is already running, just continue
				printReadyBanner('EOS running, admin account created.');
				spinner.end('Started EOS docker container');
				return;
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
		printReadyBanner('EOS running, admin account created.');
		spinner.end('Started EOS docker container');
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
			url: `${ConfigManager.rpcEndpoint}/v1/chain/get_code`,
			headers: {
				'Content-Type': 'application/json',
			},
			data: data,
			timeout: 5000, // 5 second timeout
		};

		const info = await axios(config);

		return (
			info &&
			info.status === 200 &&
			info.data &&
			info.data.code_hash != 'bfa1211a432693fa0b5a537f47fe8460009e5165197725254d41fe09be9dff14'
		);
	} catch (error: unknown) {
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


