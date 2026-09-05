import * as path from 'path';
import * as mkdirp from 'mkdirp';
import * as Mocha from 'mocha';
import {
	readFile as readFileCallback,
	writeFile as writeFileCallback,
	exists as existsCallback,
} from 'fs';
import { promisify } from 'util';

const exists = promisify(existsCallback);
const writeFile = promisify(writeFileCallback);
const readFile = promisify(readFileCallback);

/** @hidden Root config directory path */
const CACHE_DIRECTORY = '.lamington';
/** @hidden Default encoding */
const ENCODING = 'utf8';
/** @hidden Configuration file name */
const CONFIGURATION_FILE_NAME = '.lamingtonrc';

/** @hidden Configuration object structure */
export interface LamingtonConfig {
	cdt: string;
	eos: string;
	contracts: string;
	keepAlive?: boolean;
	outDir?: string;
	include?: Array<string>;
	exclude?: Array<string>;
	excludeTests?: Array<string>;
	debugTransactions?: boolean;
	debug: LamingtonDebugLevel;
	reporter?: any;
	reporterOptions?: any;
	bailOnFailure: boolean;
	skipSystemContracts: boolean;
	cppFlags: string;
	benchmark: boolean;
	/** Restore from a compatible snapshot instead of initializing from scratch */
	useSnapshots?: boolean;
	/** Snapshot the chain automatically once it is fully initialized */
	autoCreateSnapshot?: boolean;
	/** Number of snapshots to keep */
	snapshotRetention?: number;
	/**
	 * Registry holding a prebuilt chain image. Set to an empty string to always
	 * build the image locally instead of pulling it.
	 */
	imageRegistry?: string;
	/** Name of the docker container running the chain */
	containerName?: string;
	/** Host port mapped to the container's RPC port */
	rpcPort?: number;
	/** Host port mapped to the container's state history port */
	stateHistoryPort?: number;
	/** Host port mapped to the container's p2p port */
	p2pPort?: number;
	/** Optional additional search paths for compiled contracts as fallbacks */
	compiledContractsSearchPaths?: string[];
}

export interface DefaultLamingtonConfig {
	cdt: string;
	eos: string;
	contracts: string;
	keepAlive?: boolean;
	outDir: string;
	include: Array<string>;
	exclude: Array<string>;
	excludeTests: Array<string>;
	debugTransactions: boolean;
	debug: LamingtonDebugLevel;
	reporter: any;
	reporterOptions: any;
	bailOnFailure: boolean;
	skipSystemContracts: boolean;
	cppFlags: string;
	benchmark: boolean;
	useSnapshots: boolean;
	autoCreateSnapshot: boolean;
	snapshotRetention: number;
	imageRegistry: string;
	containerName: string;
	rpcPort: number;
	stateHistoryPort: number;
	p2pPort: number;
	compiledContractsSearchPaths: string[];
}

/**
 * Level of debug output
 */
export enum LamingtonDebugLevel {
	NONE = 0, // No debug logging
	MINIMAL, // Brief summary of actions as executed
	VERBOSE, // Verbose output from actions including all transaction output
}

export namespace LamingtonDebugLevel {
	export function isNone(debugLevel: LamingtonDebugLevel) {
		return debugLevel == LamingtonDebugLevel.NONE;
	}

	export function isMin(debugLevel: LamingtonDebugLevel) {
		return debugLevel == LamingtonDebugLevel.MINIMAL;
	}

	export function isVerbose(debugLevel: LamingtonDebugLevel) {
		return debugLevel == LamingtonDebugLevel.VERBOSE;
	}
}

/**
 * Default configuration values which are merged in
 * as the base layer config. Users can override these
 * values by specifying them in their `.lamingtonrc`
 */
const DEFAULT_CONFIG: DefaultLamingtonConfig = {
	eos: 'https://github.com/AntelopeIO/leap/releases/download/v5.0.3/leap_5.0.3_amd64.deb',
	cdt: 'https://github.com/EOSIO/eosio.cdt/releases/download/v1.8.1/eosio.cdt_1.8.1-1-ubuntu-18.04_amd64.deb',
	contracts: 'v1.9.2',
	debug: LamingtonDebugLevel.NONE,
	debugTransactions: false,
	keepAlive: false,
	outDir: CACHE_DIRECTORY,
	include: ['.*'],
	exclude: [],
	excludeTests: [],
	bailOnFailure: false,
	skipSystemContracts: false,
	reporter: Mocha.reporters.Min,
	reporterOptions: 0,
	cppFlags: '',
	benchmark: true,
	compiledContractsSearchPaths: [],
	useSnapshots: true,
	autoCreateSnapshot: true,
	snapshotRetention: 5,
	imageRegistry: 'ghcr.io/alien-worlds',
	containerName: 'lamington',
	rpcPort: 8888,
	stateHistoryPort: 8080,
	p2pPort: 9876,
};

/**
 * Manages Lamington configuration setup and caching
 */
export class ConfigManager {
	/** @hidden EOSIO and EOSIO.CDT configuration settings */
	private static config: LamingtonConfig;
	/** @hidden Active CLI-provided defines for current run (not persisted) */
	private static activeDefines?: string[];

	/**
	 * Initialize application configuration using the user
	 * defined configurations and defaults
	 * @author Kevin Brown <github.com/thekevinbrown>
	 * @author Mitch Pierias <github.com/MitchPierias>
	 */
	public static async initWithDefaults() {
		if (!(await ConfigManager.configExists())) {
			console.log('Project has not yet been initialized.');
			console.log('Please run lamington init before running this command.');

			process.exit(1);
		}

		await ConfigManager.loadConfigFromDisk();
	}

	public static async isValidConfig(config: object) {
		return true;
	}

	/**
	 * Creates a default configuration file if it doesn't exist at the specified path.
	 * @author Mitch Pierias <github.com/MitchPierias>
	 * @author Kevin Brown <github.com/thekevinbrown>
	 * @param atPath Optional configuration file path. Defaults to `.lamingtonrc`.
	 */
	public static async createConfigIfMissing(atPath = CONFIGURATION_FILE_NAME) {
		// Prevent overwriting existing configuration when valid
		if (
			(await ConfigManager.configExists(atPath)) &&
			(await ConfigManager.isValidConfig(ConfigManager.config))
		) {
			console.log('Config already exists. No Need to fetch');
			return;
		}
		// Create the config directory
		await mkdirp(CACHE_DIRECTORY, {});
		// Write the pinned toolchain from DEFAULT_CONFIG rather than resolving the
		// latest GitHub release. The EOSIO org is archived and its newest release is
		// not the version the system contracts in eosio-contracts/ require, so
		// "latest" produces a chain that cannot install them.
		const defaultConfig: LamingtonConfig = {
			...DEFAULT_CONFIG,
		};
		// Cache the configuration file to disk
		await writeFile(atPath, JSON.stringify(defaultConfig, null, 4), ENCODING);
	}

	/**
	 * Checks the existence of the configuration
	 * file at the default [[CONFIGURATION_FILE_NAME]] or
	 * optional path
	 * @author Mitch Pierias <github.com/MitchPierias>
	 * @param atPath Optional file path for lookup
	 * @returns Config exists determiner
	 */
	public static configExists(atPath: string = CONFIGURATION_FILE_NAME) {
		// Should filter out any trailing filename and concatonate
		// the default filename
		return exists(atPath);
	}

	/**
	 * Loads an existing configuration file into [[ConfigManager.config]]
	 * @author Kevin Brown <github.com/thekevinbrown>
	 * @param atPath Optional file path for lookup
	 */
	public static async loadConfigFromDisk(atPath = CONFIGURATION_FILE_NAME) {
		// Read existing configuration and store
		ConfigManager.config = {
			...DEFAULT_CONFIG,
			...JSON.parse(await readFile(atPath, ENCODING)),
		};
	}

	/**
	 * Sets the active defines for the current process. These are not persisted to disk.
	 */
	public static setActiveDefines(defines?: string[]) {
		ConfigManager.activeDefines = defines;
	}

	/**
	 * Returns the active defines for the current process, if any were provided via CLI.
	 */
	static get defines(): string[] | undefined {
		return ConfigManager.activeDefines;
	}

	/**
	 * Returns the current EOSIO configuration
	 * @author Kevin Brown <github.com/thekevinbrown>
	 */
	static get eos() {
		return (ConfigManager.config && ConfigManager.config.eos) || '';
	}

	/**
	 * Returns the current EOSIO.CDT configuration
	 * @author Kevin Brown <github.com/thekevinbrown>
	 */
	static get cdt() {
		return (ConfigManager.config && ConfigManager.config.cdt) || '';
	}

	/**
	 * Returns the current eosio.contracts configuration
	 * @author Johan Nordberg <github.com/jnordberg>
	 */
	static get contracts() {
		return (ConfigManager.config && ConfigManager.config.contracts) || 'master';
	}

	/**
	 * Returns the container keep alive setting or false
	 * @author Mitch Pierias <github.com/MitchPierias>
	 */
	static get keepAlive() {
		return (ConfigManager.config && ConfigManager.config.keepAlive) || DEFAULT_CONFIG.keepAlive;
	}

	/**
	 * Returns the container's debug log output setting
	 * @author Kevin Brown <github.com/thekevinbrown>
	 */
	static get debugTransactions() {
		return (
			(ConfigManager.config && ConfigManager.config.debugTransactions) ||
			DEFAULT_CONFIG.debugTransactions
		);
	}

	/**
	 * Returns the container's debugLevel output setting
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get debugLevel() {
		return (ConfigManager.config && ConfigManager.config.debug) || DEFAULT_CONFIG.debug;
	}

	/**
	 * Returns the container's debugLevel output setting
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get debugLevelNone() {
		return LamingtonDebugLevel.isNone(this.debugLevel);
	}

	static get debugLevelMin() {
		return LamingtonDebugLevel.isMin(this.debugLevel);
	}

	static get debugLevelVerbose() {
		return LamingtonDebugLevel.isVerbose(this.debugLevel);
	}

	/**
	 * Returns the output build directory or [[CACHE_DIRECTORY]]
	 * @author Mitch Pierias <github.com/MitchPierias>
	 */
	static get outDir() {
		return (ConfigManager.config && ConfigManager.config.outDir) || DEFAULT_CONFIG.outDir;
	}

	/**
	 * Returns the array of included strings or patterns. Defaults to include all `*.cpp` files
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get include() {
		return (ConfigManager.config && ConfigManager.config.include) || DEFAULT_CONFIG.include;
	}

	/**
	 * Returns the array of excluded strings or patterns
	 * @author Mitch Pierias <github.com/MitchPierias>
	 */
	static get exclude() {
		return (ConfigManager.config && ConfigManager.config.exclude) || DEFAULT_CONFIG.exclude;
	}

	/**
	 * Returns the array of excluded glob patterns for test files
	 */
	static get excludeTests() {
		return (ConfigManager.config && ConfigManager.config.excludeTests) || DEFAULT_CONFIG.excludeTests;
	}

	/**
	 * Returns the array of excluded strings or patterns
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get testReporter() {
		return (ConfigManager.config && ConfigManager.config.reporter) || Mocha.reporters.Min;
	}

	/**
	 * Returns a boolean to determine if the test run should terminate on the first test failure.
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get bailOnFailure() {
		return (
			(ConfigManager.config && ConfigManager.config.bailOnFailure) || DEFAULT_CONFIG.bailOnFailure
		);
	}

	/**
	 * Returns a boolean to determine if the system contract installation should be skipped
	 * @author Dallas Johnson <github.com/dallasjohnson>
	 */
	static get skipSystemContracts() {
		return (
			(ConfigManager.config && ConfigManager.config.skipSystemContracts) ||
			DEFAULT_CONFIG.skipSystemContracts
		);
	}

	static get cppFlags() {
		return (ConfigManager.config && ConfigManager.config.cppFlags) || DEFAULT_CONFIG.cppFlags;
	}

	static get benchmark() {
		return ConfigManager.config && ConfigManager.config.benchmark;
	}

	/**
	 * Returns additional search paths for compiled contracts
	 */
	static get compiledContractsSearchPaths(): string[] {
		return (
			(ConfigManager.config && ConfigManager.config.compiledContractsSearchPaths) ||
			DEFAULT_CONFIG.compiledContractsSearchPaths
		);
	}

	/**
	 * Whether a compatible snapshot should be restored instead of initializing a
	 * chain from scratch
	 */
	static get useSnapshots(): boolean {
		return ConfigManager.config && ConfigManager.config.useSnapshots !== undefined
			? ConfigManager.config.useSnapshots
			: DEFAULT_CONFIG.useSnapshots;
	}

	/**
	 * Whether a snapshot should be created automatically once the chain is fully
	 * initialized
	 */
	static get autoCreateSnapshot(): boolean {
		return ConfigManager.config && ConfigManager.config.autoCreateSnapshot !== undefined
			? ConfigManager.config.autoCreateSnapshot
			: DEFAULT_CONFIG.autoCreateSnapshot;
	}

	/**
	 * Returns the number of snapshots to keep
	 */
	static get snapshotRetention(): number {
		return (
			(ConfigManager.config && ConfigManager.config.snapshotRetention) ||
			DEFAULT_CONFIG.snapshotRetention
		);
	}

	/**
	 * Returns the registry holding a prebuilt chain image. Building that image
	 * takes minutes, and on an arm64 host the amd64 build runs under emulation,
	 * so it is far slower again. An empty value disables pulling.
	 */
	static get imageRegistry(): string {
		return ConfigManager.config && ConfigManager.config.imageRegistry !== undefined
			? ConfigManager.config.imageRegistry
			: DEFAULT_CONFIG.imageRegistry;
	}

	/**
	 * Returns the name of the docker container running the chain. Set this to run
	 * more than one Lamington chain on the same machine.
	 */
	static get containerName(): string {
		return (
			(ConfigManager.config && ConfigManager.config.containerName) || DEFAULT_CONFIG.containerName
		);
	}

	/**
	 * Returns the host port mapped to the container's RPC port
	 */
	static get rpcPort(): number {
		return (ConfigManager.config && ConfigManager.config.rpcPort) || DEFAULT_CONFIG.rpcPort;
	}

	/**
	 * Returns the host port mapped to the container's state history port
	 */
	static get stateHistoryPort(): number {
		return (
			(ConfigManager.config && ConfigManager.config.stateHistoryPort) ||
			DEFAULT_CONFIG.stateHistoryPort
		);
	}

	/**
	 * Returns the host port mapped to the container's p2p port
	 */
	static get p2pPort(): number {
		return (ConfigManager.config && ConfigManager.config.p2pPort) || DEFAULT_CONFIG.p2pPort;
	}

	/**
	 * Returns the host RPC endpoint for the chain. Single source of truth for
	 * every host side caller, so a custom `rpcPort` is picked up everywhere.
	 */
	static get rpcEndpoint(): string {
		return `http://localhost:${ConfigManager.rpcPort}`;
	}
}
