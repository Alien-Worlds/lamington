#!/usr/bin/env node

import * as program from 'commander';
const packageConfig = require('../../package.json');

program
	.name('lamington')
	.allowUnknownOption(false)
	.version(packageConfig.version)
	.description(packageConfig.description)
	.command('init', 'initialize a lamington project', {
		executableFile: 'lamington-init',
	})
	.command('build', 'build all smart contracts', {
		executableFile: 'lamington-build',
	})
	.command('start', 'start the eos blockchain in docker', {
		executableFile: 'lamington-start',
	})
	.command('stop', 'stop the eos blockchain in docker', {
		executableFile: 'lamington-stop',
	})
	.command('test', 'run your unit / integration tests', {
		executableFile: 'lamington-test',
	})
	.command('snapshots', 'manage blockchain snapshots', {
		executableFile: 'lamington-snapshots',
	})
	.on('*', () => {
		console.log('Unknown Command: ' + program.args.join(' '));
		program.help();
	})
	.parse(process.argv);
