import * as path from 'path';
import { ConfigManager } from '../../configManager';
import * as spinner from './logIndicator';
import { exists, readFile, statFile } from './cli-utils';
import { compile } from './dockerImageManagement';
import * as fs from 'fs';

class FileModTracker {
	modDate: Date;
	path: string;

	static async create(outputPath: string, contractPath: string) {
		const sourceStats = await statFile(contractPath);
		return new FileModTracker(outputPath, sourceStats.mtime);
	}

	private constructor(path: string, modDate: Date) {
		this.path = path + '/.mod.json';
		this.modDate = modDate;
	}

	save() {
		fs.writeFileSync(this.path, JSON.stringify({ lastmodified: this.modDate.getTime() }));
	}

	async hasChanged() {
		if (!fs.existsSync(this.path)) return true;
		const prevStats = await readFile(this.path);
		const prevModTime = new Date(JSON.parse(prevStats.toString()).lastmodified);
		console.log(prevModTime, this.modDate);
		return prevModTime.getUTCMilliseconds() != this.modDate.getMilliseconds();
	}
}

/**
 * Determines the output location for a contract based on the full path of its C++ file.
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param contractPath Full path to C++ contract file
 * @returns Output path for contract compilation artefacts
 */
export const outputPathForContract = (contractName: string, defines: string[] | undefined) => {
	let pathComponents = [ConfigManager.outDir, 'compiled_contracts'];
	let definesPath = '';
	if (defines) {
		definesPath = defines.join('.');
	}
	return path.join(ConfigManager.outDir, 'compiled_contracts', definesPath, contractName);
};

/**
 * Compiles a C++ EOSIO smart contract at path
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param contractPath Full path to C++ contract file
 */

export const compileContract = async (
	contractPath: string,
	defines?: string[],
	force: boolean = false
): Promise<boolean> => {
	// Begin logs
	spinner.create(`Compiling contract: ` + contractPath);

	const basename = path.basename(contractPath, '.cpp');

	if (!(await exists(contractPath))) {
		spinner.fail(
			`Couldn't locate contract at ${contractPath}. Are you sure used the correct contract identifier when trying to build the contract?`
		);

		throw new Error("Contract doesn't exist on disk.");
	}

	const buildFlagsPathComponents = path.parse(contractPath);
	const buildFlagsPath =
		buildFlagsPathComponents.dir + '/' + buildFlagsPathComponents.name + '.lamflags';
	let buildFlags = '';
	let definesPath: string | undefined;

	if (ConfigManager.cppFlags) {
		buildFlags += ConfigManager.cppFlags + ' ';
	}

	if (defines && defines.length > 0) {
		definesPath = defines.join('.');
		buildFlags += defines.map((x) => '-D' + x).join(' ');
	}

	if (await exists(buildFlagsPath)) {
		const data = await readFile(buildFlagsPath);
		console.log('\n Adding build flags to compile command: ' + data.toString());
		buildFlags += ' ' + data.toString();
	}

	const contractName = path.basename(contractPath, '.cpp');
	let outputPath = outputPathForContract(contractName, defines);

	const fileTracker = await FileModTracker.create(outputPath, contractPath);

	if (!force && !(await fileTracker.hasChanged())) {
		spinner.end(`Source unchanged. Skipping Compile: ` + contractPath);
		return false;
	}
	// Run the compile contract script inside our docker container.
	await compile({ contractPath, outputPath, basename, buildFlags });

	fileTracker.save();

	// Notify build task completed
	spinner.end(`Compiled contract output into folder: ` + outputPath);
	return true;
};
