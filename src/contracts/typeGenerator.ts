import * as globWithCallbacks from 'glob';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import mapTypes from './typeMap';
import { ConfigManager } from '../configManager';
import { pascalCase, camelCase } from './utils';
import { log } from 'console';
import { outputPathForContract } from '../cli/cli-utils/contractCompiling';
const glob = promisify(globWithCallbacks);
import { pathToIdentifier } from '../cli/cli-utils/contactBuilding';

type IndentedGeneratorLevel = { [key: string]: Array<string> | IndentedGeneratorLevel };
type GeneratorLevel = Array<string | IndentedGeneratorLevel>;
type Variant = { name: string; types: string[] };
type AddedType = { new_type_name: string; type: string };

/**
 * Parses a C++ type definition into a Typescript definition
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param eosType The type from the ABI we want to map over to a Typescript type
 * @param contractName (optional) The name of the contract to prefix the mapped type with if this is a contract struct type
 * @param contractStructs (optional) Structs in the contract used to match against, falling back to built in types if not found
 */
export const mapParameterType = ({
	eosType,
	contractName,
	contractStructs,
	variants,
	addedTypes,
}: {
	eosType: string;
	contractName: string;
	contractStructs: any;
	variants: { [key: string]: Variant };
	addedTypes: { [key: string]: AddedType };
}) => {
	// Handle array types
	// const isArray = eosType.endsWith('[]');
	// const isOptional = eosType.endsWith('?');
	// const parameterType = isArray ? eosType.slice(0, -2) : eosType.replace('?', '');
	// console.log('pre::: ' + eosType);

	function findType(key: string): string {
		if (contractStructs[key]) {
			return pascalCase(contractName) + pascalCase(key);
		}
		if (variants[key]) {
			return pascalCase(contractName) + pascalCase(variants[key].name);
		}
		if (addedTypes[key])
			return pascalCase(contractName) + pascalCase(addedTypes[key].new_type_name);
		return mapTypes[key];
	}

	function extractPair(type: string): string {
		const isPair = type.startsWith('pair_');
		const isArray = type.endsWith('[]');

		const isOptional = type.endsWith('?') || type.endsWith('$');
		const parameterType = isArray ? type.slice(0, -2) : type.replace(/\?|\$/, '');
		let resultType: string;

		// console.log('contractStructs:::: ' + JSON.stringify(contractStructs));

		if (isPair) {
			var _type = parameterType.replace('pair_', '');
			var pair_elements = _type.split('_');
			var [first, second] = [
				pair_elements[0],
				pair_elements.slice(1, pair_elements.length).join('_'),
			];
			// console.log('second before extract ::: ' + second);

			second = extractPair(second);

			// console.log('second after extract ::: ' + second);

			first = first.replace('[]', '').replace('?', '');
			second = second.replace('[]', '').replace('?', '');
			// first = findType({ contractStructs, contractName, key: first });

			// second = findType({ contractStructs, contractName, key: second });

			resultType = `{ key: ${mapTypes[first]}; value: ${second} }`;
		} else {
			resultType = findType(parameterType) || parameterType;
		}
		if (isArray) {
			return `Array<${resultType}>`;
		} else if (isOptional) {
			return resultType + ' | null';
		} else {
			return resultType;
		}
	}

	return extractPair(eosType);
};

export const generateTypesFromString = async (
	rawABI: string,
	contractName: string
): Promise<string> => {
	const abi = JSON.parse(rawABI);
	let contractActions = abi.actions;
	let contractTables = abi.tables;
	let variants: { [key: string]: Variant } = Object.assign(
		{},
		...abi.variants.map((variant: Variant) => {
			let key = variant['name']; //.replace(/\[\]/g, 'VEC');
			// if (key.length > 30) {
			// 	key = key.slice(0, 30) + 'PlusOthers';
			// }
			return { [key]: variant };
		})
	);
	let variants_by_name: { [key: string]: Variant } = Object.assign(
		{},
		...abi.variants.map((variant: Variant) => {
			let key = variant['name'];

			return { [key]: variant };
		})
	);
	let addedTypes: { [key: string]: AddedType } = Object.assign(
		{},
		...abi.types.map((addedType: AddedType) => ({ [addedType['new_type_name']]: addedType }))
	);
	let contractStructs = Object.assign(
		{},
		...abi.structs.map((struct: any) => ({ [struct['name']]: struct }))
	);

	// console.log('tables: ' + JSON.stringify(contractTables));
	// Prepend warning text
	const result: GeneratorLevel = [
		'// =====================================================',
		'// WARNING: GENERATED FILE',
		'//',
		'// Any changes you make will be overwritten by Lamington',
		'// =====================================================',
		'',
	];
	// Define imports
	const imports = [
		'Account',
		'Contract',
		'GetTableRowsOptions',
		'ExtendedAsset',
		'ExtendedSymbol',
		'ActorPermission',
		'Asset',
	];
	if (contractTables.length > 0) imports.push('TableRowsResult');
	// Generate import definitions
	result.push(`import { ${imports.join(', ')} } from 'lamington';`);
	result.push('');
	result.push('// Table row types');

	// Generate structs from ABI
	for (const key in contractStructs) {
		const extendsClass = contractStructs[key].base as string;
		const extendString =
			extendsClass.length > 0
				? ` extends ${pascalCase(contractName)}${pascalCase(extendsClass)}`
				: '';
		const structInterface = {
			[`export interface ${pascalCase(contractName)}${pascalCase(
				key
			)}${extendString}`]: contractStructs[key].fields.map(
				(field: any) =>
					`${field.name}: ${mapParameterType({
						contractName,
						contractStructs,
						eosType: field.type,
						variants,
						addedTypes,
					})};`
			),
		};

		result.push(structInterface);

		result.push('');
	}
	result.push('// Added Types');

	for (const key in addedTypes) {
		const typeInterface = `export type ${pascalCase(contractName)}${pascalCase(
			addedTypes[key].new_type_name
		)} = ${mapParameterType({
			eosType: addedTypes[key].type,
			contractName,
			contractStructs,
			variants,
			addedTypes,
		})};`;
		result.push(typeInterface);
	}

	result.push('');
	result.push('// Variants');

	// console.log('variants: ' + JSON.stringify(variants, null, 4));

	for (const key in variants) {
		// let inclusiveFields = new Array<string>();
		let fields = new Set<string>();
		for (const field of variants[key].types) {
			const mappedType =
				mapParameterType({
					eosType: field,
					contractName,
					contractStructs,
					variants,
					addedTypes,
				}) || field;
			if (mappedType.startsWith('Array')) {
				fields.add(mappedType);
			} else {
				mappedType.split('|').forEach((field) => {
					fields.add(field.trim());
				});
			}
		}

		const mappedFields = Array.from(fields.values());
		const typeInterface = `export type ${pascalCase(contractName)}${pascalCase(
			key
		)} = [string, ${mappedFields.join(' | ')}];`;
		result.push(typeInterface);
		result.push('');
	}
	result.push('');
	// Generate contract type from ABI
	const generatedContractActions = contractActions.map((action: any) => {
		// With a function for each action
		const parameters = contractStructs[action.name].fields.map((parameter: any) => {
			// Check if the parameter type ends with a '$', indicating it is optional
			const isOptional = parameter.type.endsWith('$');
			// Remove the '$' suffix if present
			const parameterType = isOptional ? parameter.type.slice(0, -1) : parameter.type;
			// Map the parameter type and add a TypeScript optional modifier if needed
			return `${parameter.name}${isOptional ? '?' : ''}: ${mapParameterType({
				contractName,
				contractStructs,
				eosType: parameterType,
				variants,
				addedTypes,
			})}`;
		});
		// Optional parameter at the end on every contract method.
		parameters.push('options?: { from?: Account, auths?: ActorPermission[] }');

		return `${action.name}(${parameters.join(', ')}): Promise<any>;`;
	});

	const generatedContractActionsObjects = contractActions.map((action: any) => {
		// With a function for each action using object for params

		const actionParams = contractStructs[action.name].fields.map(
			(parameter: any) =>
				`${parameter.name}: ${mapParameterType({
					contractName,
					contractStructs,
					eosType: parameter.type,
					variants,
					addedTypes,
				})}`
		);
		const parametersObj = [`params: {${actionParams.join(', ')}}`];
		// Optional parameter at the end on every contract method.
		parametersObj.push('options?: { from?: Account, auths?: ActorPermission[] }');

		return `${action.name}_object_params(${parametersObj.join(', ')}): Promise<any>;`;
	});
	// Generate tables
	const generatedTables = contractTables.map(
		(table: any) =>
			`${
				camelCase(table.name) + 'Table'
			}(options?: GetTableRowsOptions): Promise<TableRowsResult<${pascalCase(
				contractName
			)}${pascalCase(table.type)}>>;`
	);
	// Generate the contract interface with actions and tables
	const contractInterface = {
		[`export interface ${pascalCase(contractName)} extends Contract`]: [
			'// Actions',
			...generatedContractActions,
			'// Actions with object params. (This is WIP and not ready for use)',
			...generatedContractActionsObjects,
			'',
			'// Tables',
			...generatedTables,
		],
	};
	// Cache contract result
	result.push(contractInterface);
	result.push('');
	return flattenGeneratorLevels(result);
};

/**
 * Loads all `.abi` files and generates types
 * @author Kevin Brown <github.com/thekevinbrown>
 */
export const generateAllTypes = async () => {
	// Load all `.abi` files
	const files = await glob('**/*.abi');
	// Handle no files found
	if (files.length === 0) throw new Error('No ABI files to generate from. Exiting.');
	// Generate types for each file
	for (const file of files) await generateTypes(file);
};

/**
 * Generates a Typescript definition file from a contract ABI file
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @author Dallas Johnson <github.com/dallasjohnson>

 * @param contractIdentifier Path to file without extension
 */
export const generateTypes = async (contractPath: string, defines?: string[]) => {
	// Create contract details
	const contractName = path.basename(contractPath, '.cpp');

	const outputPath = outputPathForContract(contractName, defines);

	const abiPath = path.join(outputPath, `${contractName}.abi`);

	// Handle ABI file loading
	if (!fs.existsSync(path.resolve(abiPath)))
		throw new Error(
			`Missing ABI file at path '${path.resolve(
				abiPath
			)}' abiPath: ${abiPath} contractName: ${contractName} contractPath: ${contractPath} outputPath: ${outputPath}`
		);
	const rawABI = fs.readFileSync(path.resolve(abiPath), 'utf8');

	const contractIdentifier = pathToIdentifier(contractPath);
	const generaterLevels = await generateTypesFromString(rawABI, contractName);
	await saveInterface(contractIdentifier, generaterLevels);
};

const flattenGeneratorLevels = (interfaceContent: GeneratorLevel): string => {
	let result = '';
	let indentLevel = 0;
	const write = (value: string) => (result += '\t'.repeat(indentLevel) + value + '\n');
	const writeIndented = (level: IndentedGeneratorLevel) => {
		for (const outerWrapper of Object.keys(level)) {
			write(`${outerWrapper} {`);

			indentLevel++;
			writeLevel(level[outerWrapper]);
			indentLevel--;

			write('}');
		}
	};
	// Write block content or indent again
	const writeLevel = (level: GeneratorLevel | IndentedGeneratorLevel) => {
		if (Array.isArray(level)) {
			for (const entry of level) {
				if (typeof entry === 'string') {
					write(entry);
				} else {
					writeIndented(entry);
				}
			}
		} else {
			writeIndented(level);
		}
	};
	// Write interface to file and close
	writeLevel(interfaceContent);
	return result;
};

/**
 * Writes the contract interface to file
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @param contractIdentifier Path to file without extension
 * @param interfaceContent Generated contract interface as a string
 */
const saveInterface = async (contractIdentifier: string, interfaceContent: string) => {
	// Open a write stream to file
	const file = fs.createWriteStream(`${contractIdentifier}.ts`);

	file.write(interfaceContent, (error) => {
		if (error) {
			throw error;
		}
	});
	file.close();
};
