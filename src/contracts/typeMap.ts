/**
 * Type Mappings
 * @note I've kept this as a TypeScript file and not JSON cause I wasn't sure if we could
 * // do some kind of fancy auto compiling from a TypeScript interface definition to
 * // JSON object type map?
 */

export interface ExtendedSymbol {
	contract: string;
	symbol: string;
}

export interface ExtendedAsset {
	contract: string;
	quantity: string;
}

const types: { [key: string]: string } = {
	string: 'string',
	bool: 'boolean',
	name: 'string',
	action_name: 'string',
	scope_name: 'string',
	account_name: 'string',
	permission_name: 'string',
	table_name: 'string',
	checksum: 'string',
	checksum256: 'string',
	symbol: 'string',
	extended_symbol: 'ExtendedSymbol',
	extended_asset: 'ExtendedAsset',
	asset: 'Asset',
	time_point_sec: 'Date',
	time_point: 'number',
	int8: 'number',
	int16: 'number',
	int32: 'number',
	int64: 'number',
	int128: 'number',
	int256: 'number',
	uint8: 'number',
	uint16: 'number',
	uint32: 'number',
	uint64: 'number | string | bigint',
	uint128: 'number | string | bigint',
	uint256: 'number | string | bigint',
	uint8_t: 'number',
	uint16_t: 'number',
	uint32_t: 'number',
	uint64_t: 'number | string | bigint',
	uint128_t: 'number | string | bigint',
	uint256_t: 'number | string | bigint',
	float32: 'number',
	float64: 'number',
	bytes: 'string',
};

export default types;
