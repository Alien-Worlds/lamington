#!/usr/bin/env node
/**
 * Derives, and optionally builds, the chain docker image.
 *
 * This deliberately goes through lamington's own dockerImageName()/buildImage()
 * rather than keeping a copy of the Dockerfile in the workflow. The Dockerfile
 * is generated from configuration at runtime, so a second copy would drift
 * silently the moment the eos, cdt or contracts version changes.
 *
 *   node scripts/chain-image.js --tag     print the image tag and exit
 *   node scripts/chain-image.js --build   build it locally under that tag
 *
 * Toolchain versions come from DEFAULT_CONFIG unless .lamingtonrc overrides
 * them, so this stays correct without being told the versions.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { dockerImageName, buildImage, imageExists } = require('../lib/cli/cli-utils/dockerImageManagement');

(async () => {
	// ConfigManager reads .lamingtonrc from the working directory. An empty one
	// means "use the pinned defaults", which is exactly what we want to publish.
	const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lamington-image-'));
	fs.writeFileSync(path.join(workingDirectory, '.lamingtonrc'), '{}\n');
	process.chdir(workingDirectory);

	const imageName = await dockerImageName();
	// `lamington:<tag>` -> `<tag>`, which is what a registry reference needs
	const tag = imageName.replace(/^lamington:/, '');

	if (process.argv.includes('--tag')) {
		process.stdout.write(`${tag}\n`);
		return;
	}

	if (process.argv.includes('--build')) {
		if (await imageExists()) {
			console.log(`${imageName} already present, nothing to build`);
			return;
		}
		await buildImage();
		console.log(`built ${imageName}`);
		return;
	}

	console.error('usage: chain-image.js --tag | --build');
	process.exitCode = 1;
})().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
