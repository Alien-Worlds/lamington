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
	if (!result) throw new Error(`Could not extract version number from url: '${url}'`);
	return result[1];
};

/**
 * Configures and builds the docker image
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @author Johan Nordberg <github.com/jnordberg>
 */

export const buildImage = async () => {
	console.log('build image');
	// Log notification
	spinner.create('Building docker image for :' + ConfigManager.cdt + ' on: ' + ConfigManager.eos);
	// Clear the docker directory if it exists.
	await rimraf(TEMP_DOCKER_DIRECTORY);
	console.log('deleting temp directory.');
	await mkdirp(TEMP_DOCKER_DIRECTORY, {});
	console.log('\n\n\n creating temp directory.');

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
	await docker.command(
		`build --platform linux/amd64 -t ${await dockerImageName()} "${TEMP_DOCKER_DIRECTORY}"`,
		(err, data) => {
			console.log('error: ' + err);
			console.log('data: ' + data);
		}
	);
	// Clean up after ourselves.
	await rimraf(TEMP_DOCKER_DIRECTORY);
	spinner.end('Built docker image');
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

export const startContainer = async () => {
	try {
		await docker.command(`network create -d bridge lamington`);
	} catch (e) {
		if (e.stderr != 'Error response from daemon: network with name lamington already exists\n') {
			throw e;
		}
		// console.log(`error: ${JSON.stringify(e.stderr, null, 2)}`);
	}

	await docker.command(
		`run
				--rm
				--name lamington
				-d
				-p 8888:8888
				-p 8080:8080
				-p 9876:9876
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
		await docker.command('kill lamington');
		spinner.end('Stopped EOS Docker Container');
	} catch (err) {
		spinner.fail(err);
	}
};
/**
 * Constructs the name of the current Lamington Docker image
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Johan Nordberg <github.com/jnordberg>
 * @returns Docker image name
 */

export const dockerImageName = async () => {
	console.log('dockerImageName');
	await ConfigManager.loadConfigFromDisk();
	console.log('ConfigManager.loadConfigFromDisk');
	const skipSystemContracts = ConfigManager.skipSystemContracts
		? 'skipSystemContracts'
		: 'includeSystemContracts';

	console.log('skipSystemContracts: ' + skipSystemContracts);
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
			`exec lamington /opt/eosio/bin/scripts/compile_contract.sh "/${path.join(
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
