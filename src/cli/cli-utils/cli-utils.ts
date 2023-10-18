import * as rimrafCallback from 'rimraf';
import {
	writeFile as writeFileCallback,
	exists as existsCallback,
	readFile as readFileCallback,
	stat as statFileCallback,
} from 'fs';
import * as globCallback from 'glob';
import { promisify } from 'util';

export const exists = promisify(existsCallback);
export const glob = promisify(globCallback);
export const rimraf = promisify(rimrafCallback);
export const writeFile = promisify(writeFileCallback);
export const readFile = promisify(readFileCallback);
export const statFile = promisify(statFileCallback);

// It's nice to give people proper stack traces when they have a problem with their code.
// Trace shows async traces, and Clarify removes internal Node entries.
// Source Map Support adds proper source map support so line numbers match up to the original TS code.
import 'trace';
import 'clarify';
Error.stackTraceLimit = 20;

/** @hidden Current working directory reference */
export const WORKING_DIRECTORY = process.cwd();

// const includeMatches = (paths: string[]) => {
// 	return getMatches(paths, ConfigManager.include, true);
// };

// const filterMatches = (paths: string[]) => {
// 	return getMatches(paths, ConfigManager.exclude, false);
// };
