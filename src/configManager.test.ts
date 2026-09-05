import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ConfigManager } from './configManager';

/**
 * Snapshot settings are the one part of the config whose *default* is
 * load-bearing: flipping it silently changes whether every consumer's chain is
 * restored or initialized. These tests pin the default and the master-switch
 * relationship so neither can drift unnoticed.
 */
describe('ConfigManager snapshot settings', () => {
	const originalWorkingDirectory = process.cwd();
	let projectDirectory: string;

	const loadConfig = async (config: Record<string, unknown>) => {
		fs.writeFileSync(path.join(projectDirectory, '.lamingtonrc'), JSON.stringify(config));
		await ConfigManager.loadConfigFromDisk();
	};

	beforeEach(() => {
		projectDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamington-config-'));
		process.chdir(projectDirectory);
	});

	afterEach(() => {
		process.chdir(originalWorkingDirectory);
		fs.rmSync(projectDirectory, { recursive: true, force: true });
	});

	it('defaults snapshots to off', async () => {
		await loadConfig({});

		assert.isFalse(ConfigManager.useSnapshots, 'snapshots must be opt-in');
	});

	it('enables snapshot creation when snapshots are turned on', async () => {
		await loadConfig({ useSnapshots: true });

		assert.isTrue(ConfigManager.useSnapshots);
		assert.isTrue(ConfigManager.autoCreateSnapshot);
	});

	it('treats useSnapshots as a master switch over autoCreateSnapshot', async () => {
		await loadConfig({ useSnapshots: false, autoCreateSnapshot: true });

		assert.isFalse(
			ConfigManager.autoCreateSnapshot,
			'turning snapshots off must also stop them being written'
		);
	});

	it('still allows creation to be disabled while restoring is enabled', async () => {
		await loadConfig({ useSnapshots: true, autoCreateSnapshot: false });

		assert.isTrue(ConfigManager.useSnapshots);
		assert.isFalse(ConfigManager.autoCreateSnapshot);
	});
});
