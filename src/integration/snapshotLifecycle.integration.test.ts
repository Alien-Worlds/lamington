import { assert } from 'chai';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * End to end coverage of the snapshot lifecycle against a real chain.
 *
 * Every bug this file asserts against shipped, and every one of them was found
 * by integrating with a real project rather than by the test suite: restore was
 * silently discarded, pausing nodeos killed the container, rebuildable state in
 * the archive made replay fatal, and the system contract could not be linked at
 * all on the previous toolchain. None of them are visible without a container.
 *
 * These run under `yarn test:integration`, not `yarn test`. They need docker and
 * take minutes, so they are deliberately kept out of the fast suite.
 *
 * The tests share one chain and run in order. That is not laziness: a fresh
 * chain per test would multiply an already slow suite by seven, and the thing
 * under test *is* the sequence.
 */

/** Ports and a container name of its own, so a developer's chain is untouched */
const PROJECT_CONFIG = {
	// Set explicitly: snapshots are OFF by default, and this suite exists to
	// exercise them. Relying on the default would let every test here pass while
	// silently testing the non-snapshot path.
	useSnapshots: true,
	autoCreateSnapshot: true,
	containerName: 'lamington-integration',
	rpcPort: 8899,
	stateHistoryPort: 18099,
	p2pPort: 19899,
	keepAlive: true,
	debug: 0,
};

const RPC = `http://localhost:${PROJECT_CONFIG.rpcPort}`;

const originalWorkingDirectory = process.cwd();
const projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamington-integration-'));

/* eslint-disable @typescript-eslint/no-var-requires */
// Required lazily, after the chdir below, and from the built output rather than
// from src. Two reasons:
//
//   1. cli-utils captures `WORKING_DIRECTORY = process.cwd()` at import time,
//      and it decides both where snapshots are written and which directory is
//      mounted into the container.
//   2. CONTRACTS_DIRECTORY resolves relative to the module's own location and
//      only exists in the built layout, where `yarn build` copies
//      eosio-contracts/ next to the compiled code. Under ts-node the source
//      tree has no such directory and the container fails to mount it.
//
// Driving lib/ is also what a consumer does, so this exercises the artefact
// that actually ships.
let ConfigManager: any;
let blockchainManagement: any;
let snapshotManagement: any;
let dockerImageManagement: any;

const post = async (endpoint: string, body: unknown = {}) => {
	const response = await fetch(`${RPC}${endpoint}`, {
		method: 'POST',
		body: JSON.stringify(body),
	});
	return response.json() as Promise<any>;
};

const headBlock = async (): Promise<number> => (await post('/v1/chain/get_info')).head_block_num;

const rammarketRows = async (): Promise<number> => {
	const result = await post('/v1/chain/get_table_rows', {
		json: true,
		code: 'eosio',
		scope: 'eosio',
		table: 'rammarket',
		limit: 1,
	});
	return result.rows ? result.rows.length : 0;
};

const containerIsRunning = (): boolean => {
	const output = execFileSync('docker', [
		'ps',
		'--filter',
		`name=^${PROJECT_CONFIG.containerName}$`,
		'--format',
		'{{.Names}}',
	]).toString();
	return output.trim() === PROJECT_CONFIG.containerName;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until a condition holds, or gives up.
 *
 * startEos() returns once eosIsReady() passes, which is a single get_code call.
 * Reading a contract table can still fail for a moment after that on a slow
 * machine, and areSystemContractsInstalled() reports any error as false, so
 * asserting it the instant startEos() returns is a race.
 *
 * This is only ever used for checks that something *appears*, and only where a
 * stronger assertion has already run. It must never be used to soften the
 * question of whether the chain was restored at all: a wiped chain would
 * eventually reinstall its system contracts, so a poll on its own would go
 * green against exactly the bug this suite exists to catch.
 */
const until = async (
	description: string,
	condition: () => Promise<boolean>,
	attempts = 30
): Promise<void> => {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await condition()) return;
		await sleep(1000);
	}
	assert.fail(`${description} within ${attempts}s`);
};

describe('snapshot lifecycle', function () {
	// A cold run builds or pulls a 1.5GB image before it can start
	this.timeout(20 * 60 * 1000);

	let snapshotPath: string;
	let snapshotBlockHeight: number;

	before(async function () {
		try {
			execFileSync('docker', ['info'], { stdio: 'ignore' });
		} catch (error) {
			// Failing loudly beats skipping: you asked for the integration suite
			throw new Error('docker is not available, and these tests require it');
		}

		fs.writeFileSync(
			path.join(projectDirectory, '.lamingtonrc'),
			JSON.stringify(PROJECT_CONFIG, null, 2)
		);
		process.chdir(projectDirectory);

		ConfigManager = require('../../lib/configManager').ConfigManager;
		blockchainManagement = require('../../lib/cli/cli-utils/blockchainManagement');
		snapshotManagement = require('../../lib/cli/cli-utils/blockchainSnapshotManagement');
		dockerImageManagement = require('../../lib/cli/cli-utils/dockerImageManagement');

		await ConfigManager.loadConfigFromDisk();
		assert.strictEqual(
			ConfigManager.containerName,
			PROJECT_CONFIG.containerName,
			'the throwaway project config is not in effect, refusing to touch another chain'
		);

		try {
			await dockerImageManagement.stopContainer();
		} catch (error) {
			// nothing was running
		}
		await sleep(2000);
	});

	after(async function () {
		this.timeout(120000);
		try {
			await dockerImageManagement.stopContainer();
		} catch (error) {
			// already gone
		}
		process.chdir(originalWorkingDirectory);
		fs.rmSync(projectDirectory, { recursive: true, force: true });
	});

	it('should install the system contracts on a fresh chain', async function () {
		await blockchainManagement.startEos(false);

		const installed = await snapshotManagement.waitForSystemContracts(180);

		// Regression: the bundled eosio.system imports host functions added after
		// EOSIO 2.0, so on the previous default toolchain it could never be linked
		// and init looped forever without ever reporting failure.
		assert.isTrue(installed, 'system contracts never finished installing');
		await until('rammarket table was never initialized', async () => (await rammarketRows()) > 0);
	});

	it('should create a snapshot with complete metadata', async function () {
		snapshotPath = await snapshotManagement.createSnapshotIfNeeded();
		assert.isNotNull(snapshotPath, 'no snapshot was created');

		const metadata = JSON.parse(fs.readFileSync(`${snapshotPath}.metadata.json`, 'utf8'));
		snapshotBlockHeight = metadata.blockHeight;

		assert.isTrue(metadata.systemContractsInstalled);
		assert.isTrue(metadata.rammarketInitialized);
		assert.isTrue(metadata.initializationComplete);
		assert.isNotEmpty(metadata.genesisHash, 'genesis hash was not recorded');
		assert.isAbove(metadata.blockHeight, 0);
		assert.isTrue(
			snapshotManagement.isSnapshotCompatible(metadata),
			'a freshly created snapshot was judged incompatible'
		);

		// The archive only carries blocks.log, which holds irreversible blocks, so
		// everything it describes has to be irreversible or the tail is dropped and
		// the restored chain is quietly incomplete. This is machine speed sensitive
		// in the worst way: a slow machine gives irreversibility time to catch up on
		// its own and hides the bug, which is exactly what happened here until CI
		// ran the suite on a faster runner.
		const info = await post('/v1/chain/get_info');
		assert.isAtLeast(
			info.last_irreversible_block_num,
			metadata.blockHeight,
			'the snapshot covers blocks that were not yet irreversible'
		);
	});

	it('should leave the container running after the snapshot pause', async function () {
		// Regression: snapshot creation SIGSTOPs nodeos to quiesce the data
		// directory. With job control enabled both `fg` and `wait` return when a
		// job merely stops, so the init script ran to completion and took the
		// container's PID 1 with it.
		assert.isTrue(containerIsRunning(), 'the container died during snapshot creation');

		const before = await headBlock();
		await sleep(3000);
		assert.isAbove(await headBlock(), before, 'the chain stopped producing blocks');
	});

	it('should exclude rebuildable state from the archive', async function () {
		const entries = execFileSync('tar', ['tzf', snapshotPath]).toString().split('\n');
		const hasEntry = (needle: string) => entries.some((entry) => entry.includes(needle));

		// Regression: the --exclude flags were listed after the -C/member
		// arguments, so tar ignored them and the archive shipped memory mapped
		// databases that made nodeos refuse to start or die during replay.
		assert.isTrue(hasEntry('data/blocks/blocks.log'), 'the block log is missing');
		assert.isFalse(hasEntry('data/state/'), 'state database was included');
		assert.isFalse(hasEntry('data/blocks/reversible/'), 'reversible blocks were included');
		assert.isFalse(hasEntry('data/state-history/'), 'state history was included');
	});

	it('should not create a second snapshot when a compatible one exists', async function () {
		assert.isNull(
			await snapshotManagement.createSnapshotIfNeeded(),
			'a redundant snapshot was created'
		);
	});

	it('should restore the chain from the snapshot', async function () {
		await dockerImageManagement.stopContainer();
		await sleep(4000);
		assert.isFalse(await blockchainManagement.eosIsReady(), 'the chain did not stop');

		await blockchainManagement.startEos(true);

		assert.isTrue(await blockchainManagement.eosIsReady(), 'the chain did not come back');

		// Regression: the restore path used to run init_blockchain.sh, whose first
		// act is `rm -rf /mnt/dev/data`, so the restored snapshot was deleted and
		// the chain silently reinitialised from genesis. A fresh chain restarts
		// near block 1, so this comparison is the whole assertion. No tolerance:
		// an earlier version of this check allowed a window and passed against a
		// chain that had been wiped.
		assert.isAtLeast(
			await headBlock(),
			snapshotBlockHeight,
			'the chain was reinitialised rather than restored'
		);

		// Safe to poll: the head block assertion above has already established that
		// this is the restored chain rather than a fresh one.
		await until('system contracts did not survive the restore', () =>
			snapshotManagement.areSystemContractsInstalled()
		);
		await until('rammarket did not survive the restore', async () => (await rammarketRows()) > 0);
	});

	it('should reject a snapshot taken under a different genesis', async function () {
		const metadataPath = `${snapshotPath}.metadata.json`;
		const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

		// The chain id is derived from genesis, so a snapshot taken under a
		// different one belongs to a different chain and must not be restored.
		const foreign = { ...metadata, genesisHash: 'a'.repeat(64) };
		assert.isFalse(snapshotManagement.isSnapshotCompatible(foreign));

		// And one with no hash at all predates the check, so it cannot be trusted
		const legacy = { ...metadata };
		delete legacy.genesisHash;
		assert.isFalse(snapshotManagement.isSnapshotCompatible(legacy));
	});
});
