import axios from 'axios';

import { ConfigManager } from '../../configManager';
import { sleep } from '../../utils';

/**
 * How long to wait for the system contracts, in one-second polls.
 *
 * Installing them is the slowest part of chain initialization and it runs under
 * emulation on an arm64 host, so this is deliberately generous.
 */
const SYSTEM_CONTRACT_POLL_ATTEMPTS = 180;

/**
 * The code hash of `eosio.boot`, installed early in `init_blockchain.sh`. While
 * `eosio` still reports this hash the real system contract has not replaced it
 * yet.
 */
const BOOT_CONTRACT_CODE_HASH =
	'bfa1211a432693fa0b5a537f47fe8460009e5165197725254d41fe09be9dff14';

/**
 * Whether the chain has a usable `eosio.system`.
 *
 * Two conditions, because either alone gives a false positive: the contract has
 * to have replaced `eosio.boot`, *and* `eosio init` has to have run. The
 * `rammarket` table is the cheapest evidence of the second -- it is empty until
 * initialization, and every system action depends on it.
 * @returns True when the system contract is installed and initialized
 */
export const areSystemContractsInstalled = async (): Promise<boolean> => {
	try {
		const result = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_code`, {
			account_name: 'eosio',
			code_as_wasm: 1,
		});

		if (result.data.code_hash === BOOT_CONTRACT_CODE_HASH) {
			return false;
		}

		const rammarket = await axios.post(`${ConfigManager.rpcEndpoint}/v1/chain/get_table_rows`, {
			json: true,
			code: 'eosio',
			scope: 'eosio',
			table: 'rammarket',
			limit: 1,
		});

		return Boolean(rammarket.data && rammarket.data.rows && rammarket.data.rows.length > 0);
	} catch (error) {
		// nodeos not answering yet, or the tables are not there. Either way, not ready.
		return false;
	}
};

/**
 * Polls until the system contracts are installed and initialized.
 *
 * `startEos` needs this because nodeos answers RPC roughly 19 seconds before
 * `init_blockchain.sh` finishes. Returning before then hands the caller a chain
 * that rejects any deploy needing a post-2.0 intrinsic with
 * `env.get_sender unresolveable`, and any system action with "system contract
 * must first be initialized". That shipped as v1.4.0.
 * @param maxAttempts One-second polls before giving up
 * @returns True once ready, false if it never became ready
 */
export const waitForSystemContracts = async (
	maxAttempts: number = SYSTEM_CONTRACT_POLL_ATTEMPTS
): Promise<boolean> => {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		if (await areSystemContractsInstalled()) {
			return true;
		}

		await sleep(1000);
	}

	return false;
};
