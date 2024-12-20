import * as ecc from 'eosjs-ecc';

/** Digit pattern expression */
const digitPattern = /[06789]/g;

/** Digit mapping lookup */
const digitMapping: { [key: string]: string } = {
	'0': '1',
	'6': '2',
	'7': '3',
	'8': '4',
	'9': '5',
};

/**
 * Generates an account name from the specified public key
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param publicKey Valid EOSIO public key
 * @returns EOSIO account name
 */
export const accountNameFromPublicKey = (publicKey: string) => hashToEOSName(ecc.sha256(publicKey));

export function randomAccountName() {
	function choices(population: String, k: Number) {
		var out = [];
		for (var i = 0; i < k; i++) {
			out.push(population[Math.floor(population.length * Math.random())]);
		}
		return out.join('');
	}
	let alphabet = 'abcdefghijklmnopqrstuvwxyz12345';
	return choices(alphabet, 12);
}

/**
 * Generates an account name from a hashed public key
 * @author Kevin Brown <github.com/thekevinbrown>
 * @returns EOSIO account name
 */
export const hashToEOSName = (data: string) =>
	`l${data
		.substring(0, 11)
		.replace(digitPattern, (match) => digitMapping[match])
		.toLowerCase()}`;

export type EosioAction = {
	account: string;
	name: string;
	authorization: { actor: string; permission: string }[];
	data: any;
};
