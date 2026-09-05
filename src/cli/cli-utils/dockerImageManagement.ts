import * as mkdirp from 'mkdirp';
import * as path from 'path';
import { ConfigManager } from '../../configManager';
import { WORKING_DIRECTORY, rimraf, writeFile } from './cli-utils';
import * as spinner from './logIndicator';

/** @hidden Config directory for running EOSIO */
export const CONFIG_DIRECTORY = path.join(__dirname, '../../eosio-config');
/** @hidden Pre-Compiled EOSIO system contracts */
export const CONTRACTS_DIRECTORY = path.join(__dirname, '../../eosio-contracts');
/** @hidden Temporary docker resource directory */
export const TEMP_DOCKER_DIRECTORY = path.join(__dirname, '../.temp-docker');

import { Docker, Options } from 'docker-cli-js';
// export const docker = new Docker(new Options('default', undefined, true));
export const docker = new Docker(new Options(undefined, undefined, true));

/**
 * Extracts the version identifier from a string
 * @author Kevin Brown <github.com/thekevinbrown>
 * @returns Version identifier
 */
export const versionFromUrl = (url: string) => {
	// Looks for strings in this format: `/v1.4.6/`
	const pattern = /\/(v\d+\.\d+\.\d+)\//g;
	const result = pattern.exec(url);

	// Handle result
	if (!result) return 'unknown';
	return result[1];
};

/**
 * Configures and builds the docker image
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @author Johan Nordberg <github.com/jnordberg>
 */

export const buildImage = async () => {
	// Log notification
	spinner.create('Building docker image for :' + ConfigManager.cdt + ' on: ' + ConfigManager.eos);
	// Clear the docker directory if it exists.
	await rimraf(TEMP_DOCKER_DIRECTORY);
	await mkdirp(TEMP_DOCKER_DIRECTORY, {});

	// Write a Dockerfile so Docker knows what to build.
	const systemDeps = ['build-essential', 'ca-certificates', 'cmake', 'curl', 'git', 'wget'];

	await writeFile(
		path.join(TEMP_DOCKER_DIRECTORY, 'Dockerfile'),
		`
		FROM ubuntu:18.04

		RUN apt-get update --fix-missing && apt-get install -y --no-install-recommends ${systemDeps.join(
			' '
		)}
		
		RUN wget ${ConfigManager.eos} && apt-get install -y ./*.deb && rm -f *.deb
		RUN wget ${ConfigManager.cdt} && apt-get install -y ./*.deb && rm -f *.deb

		RUN apt-get clean && rm -rf /tmp/* /var/tmp/* && rm -rf /var/lib/apt/lists/*
		`.replace(/\t/gm, '')
	);
	// Execute docker build process
	// No callback: docker.command rejects on a failed build, and a callback here
	// would print "error: null" on every successful one.
	await docker.command(
		`build --platform linux/amd64 -t ${await dockerImageName()} "${TEMP_DOCKER_DIRECTORY}"`
	);
	// Clean up after ourselves.
	await rimraf(TEMP_DOCKER_DIRECTORY);
	spinner.end('Built docker image');
};
/**
 * Pulls a prebuilt chain image from the configured registry and gives it the
 * local name the rest of the tooling looks for.
 *
 * Building this image takes several minutes, and on an arm64 host the amd64
 * build runs under emulation, which is far slower again. Pulling is the
 * difference between a coffee break and a progress bar.
 *
 * Never throws: no published image for this toolchain, no network, or a private
 * registry all just mean the caller should build instead.
 * @returns True when the image is now available locally
 */
export const pullImage = async (): Promise<boolean> => {
	const registry = ConfigManager.imageRegistry;
	if (!registry) return false;

	const localName = await dockerImageName();
	const remoteName = `${registry}/lamington-chain:${localName.replace(/^lamington:/, '')}`;

	try {
		spinner.create(`Pulling prebuilt chain image ${remoteName}`);
		await docker.command(`pull --platform linux/amd64 ${remoteName}`);
		await docker.command(`tag ${remoteName} ${localName}`);
		spinner.end('Pulled prebuilt chain image');
		return true;
	} catch (error) {
		spinner.end('No prebuilt image for this toolchain, building it instead');
		return false;
	}
};
/**
 * Determines if the docker image exists
 * @author Kevin Brown <github.com/thekevinbrown>
 * @returns Result of search
 */

export const imageExists = async () => {
	// Fetch image name and check existence
	const result = await docker.command(`images ${await dockerImageName()}`);
	return result.images.length > 0;
};
/**
 * Starts the Lamington container
 * @author Kevin Brown <github.com/thekevinbrown>
 */

export const startContainer = async (skipInit: boolean = false) => {
	try {
		await docker.command(`network create -d bridge lamington`);
	} catch (error) {
		const stderr =
			typeof error === 'object' && error && 'stderr' in error
				? String((error as { stderr?: unknown }).stderr)
				: '';
		if (stderr !== 'Error response from daemon: network with name lamington already exists\n') {
			throw error;
		}
		// console.log(`error: ${JSON.stringify(e.stderr, null, 2)}`);
	}

	if (skipInit) {
		// Start container in empty state for snapshot restoration
		await docker.command(
			`run
				--rm
				--name ${ConfigManager.containerName}
				-d
				-p ${ConfigManager.rpcPort}:8888
				-p ${ConfigManager.stateHistoryPort}:8080
				-p ${ConfigManager.p2pPort}:9876
				--network=lamington
				--platform linux/amd64
				--mount type=bind,src="${WORKING_DIRECTORY}",dst=/opt/eosio/bin/project
				--mount type=bind,src="${__dirname}/../../scripts",dst=/opt/eosio/bin/scripts
				--mount type=bind,src="${CONFIG_DIRECTORY}",dst=/mnt/dev/config
				--mount type=bind,src="${CONTRACTS_DIRECTORY}",dst=/usr/opt/eosio.contracts/build/contracts
				-w "/opt/eosio/bin/"
				${await dockerImageName()}
				sleep infinity`
				.replace(/\n/gm, '')
				.replace(/\t/gm, ' ')
		);
	} else {
		// Start container with normal initialization
		await docker.command(
			`run
				--rm
				--name ${ConfigManager.containerName}
				-d
				-p ${ConfigManager.rpcPort}:8888
				-p ${ConfigManager.stateHistoryPort}:8080
				-p ${ConfigManager.p2pPort}:9876
				--network=lamington
				--platform linux/amd64
				--mount type=bind,src="${WORKING_DIRECTORY}",dst=/opt/eosio/bin/project
				--mount type=bind,src="${__dirname}/../../scripts",dst=/opt/eosio/bin/scripts
				--mount type=bind,src="${CONFIG_DIRECTORY}",dst=/mnt/dev/config
				--mount type=bind,src="${CONTRACTS_DIRECTORY}",dst=/usr/opt/eosio.contracts/build/contracts
				-w "/opt/eosio/bin/"
				${await dockerImageName()}
				/bin/bash -c "./scripts/${
					ConfigManager.skipSystemContracts ? 'init_blockchain_wo_system.sh' : 'init_blockchain.sh'
				}"`
				.replace(/\n/gm, '')
				.replace(/\t/gm, ' ')
		);
	}
};

export const resumeBlockchainInContainer = async () => {
	try {
		// Resume against the restored data directory. This deliberately does NOT
		// run init_blockchain.sh: that script clears /mnt/dev/data and re-runs the
		// whole chain setup, which would discard the snapshot we just restored.
		await docker.command(
			`exec ${ConfigManager.containerName} /bin/bash -c "./scripts/resume_blockchain.sh&"`
		);
	} catch (error) {
		console.error('Failed to resume blockchain in container:', error);
		throw error;
	}
};
/**
 * Stops the current Lamington container
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @returns Docker command promise
 */

export const stopContainer = async () => {
	spinner.create('Stopping EOS Docker Container');

	try {
		await docker.command(`kill ${ConfigManager.containerName}`);
		spinner.end('Stopped EOS Docker Container');
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		spinner.fail(message);
	}
};
/**
 * Constructs the name of the current Lamington Docker image
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Johan Nordberg <github.com/jnordberg>
 * @returns Docker image name
 */

export const dockerImageName = async () => {
	await ConfigManager.loadConfigFromDisk();
	const skipSystemContracts = ConfigManager.skipSystemContracts
		? 'skipSystemContracts'
		: 'includeSystemContracts';

	return `lamington:eos.${versionFromUrl(ConfigManager.eos)}-cdt.${versionFromUrl(
		ConfigManager.cdt
	)}-contracts.${ConfigManager.contracts}.${skipSystemContracts}`;
};
export const compile = async ({
	contractPath,
	outputPath,
	basename,
	buildFlags,
}: {
	contractPath: string;
	outputPath: string;
	basename: string;
	buildFlags: string;
}) => {
	await docker
		.command(
			// Arg 1 is filename, arg 2 is contract name.
			`exec ${ConfigManager.containerName} /opt/eosio/bin/scripts/compile_contract.sh "/${path.join(
				'opt',
				'eosio',
				'bin',
				'project',
				contractPath
			)}" "${outputPath}" "${basename}" "${buildFlags}"`
		)
		.catch((err) => {
			spinner.fail('Failed to compile');
			console.log(` --> ${err}`);
			throw err;
		});
};
