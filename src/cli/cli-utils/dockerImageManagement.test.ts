import { assert } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { compile, tokenizeBuildFlags, versionFromUrl } from './dockerImageManagement';

describe('tokenizeBuildFlags', () => {
	it('returns nothing for an empty or blank string', () => {
		assert.deepEqual(tokenizeBuildFlags(''), []);
		assert.deepEqual(tokenizeBuildFlags('   '), []);
	});

	it('splits plain flags on whitespace', () => {
		assert.deepEqual(tokenizeBuildFlags('-DONE -DTWO'), ['-DONE', '-DTWO']);
	});

	it('collapses runs of whitespace', () => {
		assert.deepEqual(tokenizeBuildFlags('  -DONE \t\n -DTWO  '), ['-DONE', '-DTWO']);
	});

	it('keeps a quoted value with spaces as one argument', () => {
		assert.deepEqual(tokenizeBuildFlags('-I "/some path/include" -DX'), [
			'-I',
			'/some path/include',
			'-DX',
		]);
	});

	it('handles single quotes and quotes joined to a flag', () => {
		assert.deepEqual(tokenizeBuildFlags("-I'/a b/c' -DY"), ['-I/a b/c', '-DY']);
	});

	it('preserves an explicitly empty quoted value', () => {
		assert.deepEqual(tokenizeBuildFlags('-DEMPTY=""'), ['-DEMPTY=']);
	});

	it('treats shell metacharacters as ordinary text', () => {
		// The point of the function: these become compiler arguments, never
		// commands. The quote groups the payload into a single argument, exactly
		// as a shell would -- but it stays an argument, so nothing runs.
		assert.deepEqual(tokenizeBuildFlags('-DX" ; touch /tmp/pwned ; echo "'), [
			'-DX ; touch /tmp/pwned ; echo ',
		]);
		// Unquoted, the same characters split into separate arguments and are
		// still only ever arguments
		assert.deepEqual(tokenizeBuildFlags('-DX ; touch /tmp/pwned'), [
			'-DX',
			';',
			'touch',
			'/tmp/pwned',
		]);
		assert.deepEqual(tokenizeBuildFlags('-DX$(id)'), ['-DX$(id)']);
		assert.deepEqual(tokenizeBuildFlags('-DX`id`'), ['-DX`id`']);
	});

	it('keeps the real-world cppFlags value intact', () => {
		assert.deepEqual(tokenizeBuildFlags('-I=/opt/eosio/bin/project/contracts/atomicassets/'), [
			'-I=/opt/eosio/bin/project/contracts/atomicassets/',
		]);
	});
});

describe('compile', () => {
	/**
	 * Build flags are untrusted: lamington reads `<contract>.lamflags` from the
	 * contract directory, which is repository content, and appends it verbatim.
	 *
	 * This used to be interpolated into a single string passed to
	 * docker-cli-js, which runs it via child_process.exec -- a shell on the
	 * host. A pull request adding a .lamflags file could therefore run commands
	 * on any machine that built the project. Verified before the fix: this test
	 * created the marker.
	 */
	it('does not execute host commands smuggled through build flags', async () => {
		const marker = path.join(
			fs.mkdtempSync(path.join(os.tmpdir(), 'lamington-injection-')),
			'MARKER'
		);
		const buildFlags = `-DX" ; touch ${marker} ; echo "`;

		try {
			await compile({
				contractPath: 'does-not-exist.cpp',
				outputPath: 'out',
				basename: 'does-not-exist',
				buildFlags,
			});
		} catch (error) {
			// Expected: there is no container to exec into, and docker may not be
			// installed at all. Either way the injected command must not have run.
		}

		assert.isFalse(
			fs.existsSync(marker),
			'build flags reached a shell: a .lamflags file in a contract repository can run commands on the host'
		);
	}).timeout(20000);
});

describe('versionFromUrl', () => {
	// Untested until now, and its result becomes part of the docker image name,
	// which is interpolated into shell commands elsewhere.
	it('extracts the version from the pinned toolchain urls', () => {
		assert.strictEqual(
			versionFromUrl(
				'https://github.com/AntelopeIO/leap/releases/download/v5.0.3/leap_5.0.3_amd64.deb'
			),
			'v5.0.3'
		);
		assert.strictEqual(
			versionFromUrl(
				'https://github.com/EOSIO/eosio.cdt/releases/download/v1.8.1/eosio.cdt_1.8.1-1-ubuntu-18.04_amd64.deb'
			),
			'v1.8.1'
		);
	});

	it('reports unknown rather than guessing when there is no version', () => {
		assert.strictEqual(versionFromUrl('https://example.com/no/version/here.deb'), 'unknown');
	});

	it('never returns anything a shell could interpret', () => {
		// The result lands in the image name, which is interpolated into shell
		// command strings by other callers.
		for (const url of [
			'https://h/d/v1.2.3;id/f.deb',
			'https://h/d/v1.2.3`id`/f.deb',
			'https://h/d/v1.2.3$(id)/f.deb',
			'https://h/d/v1.2.3 -x/f.deb',
		]) {
			assert.notMatch(versionFromUrl(url), /[^A-Za-z0-9.]/, `unsafe version from ${url}`);
		}
	});
});
