import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Does `startEos` hand back a chain that is actually usable?
 *
 * This exists because v1.4.0 shipped a chain that was not. `untilEosIsReady`
 * only proves nodeos answers RPC, which it does roughly 19 seconds before
 * init_blockchain.sh has installed eosio.system, run `eosio init` and activated
 * the protocol features. Measured on this machine:
 *
 *   startEos() returned after 2715ms
 *     system contracts ready at that moment : false
 *     activated protocol features           : 0
 *     ... contracts appeared 19338ms later, features then 19
 *
 * A consumer deploying inside that window gets
 * `env.get_sender unresolveable` on any contract needing a post-2.0 intrinsic,
 * and "system contract must first be initialized" on any system action.
 *
 * Until 1.4.0 the wait happened by accident, inside a snapshot-creation step
 * that ran before the tests and happened to poll for the same condition. That
 * feature has since been removed, so this wait is now explicit in startEos and
 * this suite is the only thing guarding it.
 *
 * Runs under `yarn test:integration`. Needs docker.
 *
 * **Each integration suite must run in its own mocha process**, which is why
 * `test:integration` invokes them one at a time rather than with a glob.
 * `cli-utils` captures `WORKING_DIRECTORY = process.cwd()` at import time, and
 * that value decides which directory is bind-mounted into the container. Two
 * suites in one process means the first one to load pins it for both, so the
 * second mounts the wrong directory -- and once this suite removes its temp
 * project, the mount source no longer exists at all:
 *
 *     docker: invalid mount config for type "bind":
 *       bind source path does not exist: /tmp/lamington-readiness-hJtxmV
 */

/** Its own container name and ports, so a developer's chain is untouched */
const PROJECT_CONFIG = {
	containerName: 'lamington-readiness',
	rpcPort: 8866,
	stateHistoryPort: 18066,
	p2pPort: 19866,
	keepAlive: true,
	debug: 0,
};

const RPC = `http://localhost:${PROJECT_CONFIG.rpcPort}`;

const originalWorkingDirectory = process.cwd();
const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamington-readiness-'));

/* eslint-disable @typescript-eslint/no-var-requires */
// Required lazily, after the chdir, and from lib/ rather than src/ for the same
// reasons noted below: cli-utils
// captures WORKING_DIRECTORY at import time, and CONTRACTS_DIRECTORY only
// exists in the built layout.
let ConfigManager: any;
let blockchainManagement: any;
let dockerImageManagement: any;

const post = async (endpoint: string, body: unknown = {}) => {
	const response = await fetch(`${RPC}${endpoint}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return response.json() as Promise<any>;
};

const rammarketRows = async (): Promise<number> => {
	const result = await post('/v1/chain/get_table_rows', {
		json: true,
		code: 'eosio',
		scope: 'eosio',
		table: 'rammarket',
		limit: 1,
	});
	return Array.isArray(result.rows) ? result.rows.length : 0;
};

const activatedFeatureCount = async (): Promise<number> => {
	const result = await post('/v1/chain/get_activated_protocol_features', { limit: 100 });
	return Array.isArray(result.activated_protocol_features)
		? result.activated_protocol_features.length
		: 0;
};

describe('chain readiness on startEos', function () {
	// A cold run may pull or build the chain image before it can start.
	this.timeout(20 * 60 * 1000);

	before(async function () {
		fs.writeFileSync(
			path.join(projectDirectory, '.lamingtonrc'),
			JSON.stringify(PROJECT_CONFIG, null, 2)
		);
		fs.mkdirSync(path.join(projectDirectory, 'contracts'), { recursive: true });
		process.chdir(projectDirectory);

		ConfigManager = require('../../lib/configManager').ConfigManager;
		blockchainManagement = require('../../lib/cli/cli-utils/blockchainManagement');
		dockerImageManagement = require('../../lib/cli/cli-utils/dockerImageManagement');

		await ConfigManager.loadConfigFromDisk();

		await blockchainManagement.startEos(false);
	});

	after(async function () {
		try {
			await dockerImageManagement.stopContainer();
		} catch (error) {
			// Nothing to stop, or already gone.
		}
		process.chdir(originalWorkingDirectory);
		fs.rmSync(projectDirectory, { recursive: true, force: true });
	});

	it('has the system contract initialized by the time startEos returns', async function () {
		assert.isAbove(
			await rammarketRows(),
			0,
			'startEos returned before eosio.system was initialized, so any system action would fail with "system contract must first be initialized"'
		);
	});

	it('has the protocol features activated by the time startEos returns', async function () {
		// init_blockchain.sh activates 19. Asserting on a healthy floor rather
		// than the exact number, which is a property of the script, not of the
		// wait being tested. Zero is the failure mode that shipped.
		assert.isAtLeast(
			await activatedFeatureCount(),
			15,
			'startEos returned before the protocol features were activated, so deploying any contract using a post-2.0 intrinsic would fail with env.get_sender unresolveable'
		);
	});
});
