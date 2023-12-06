import { assert } from 'chai';

import { ConfigManager, LamingtonDebugLevel } from './configManager';
import { eosIsReady, startEos, buildAll, stopContainer } from './cli/utils';
import { mapParameterType, generateTypesFromString } from './contracts/typeGenerator';
import { EOSManager } from './eosManager';
import { EosioAction, EosioTransaction } from './accounts';

describe('eos manager', function () {
	EOSManager.initWithDefaults();
	context('map parameter types', function () {
		it(`should add nonce action`, async function () {
			const action: EosioAction = {
				authorization: [{ actor: 'eosio', permission: 'active' }],
				account: 'eosio.token',
				name: 'transfer',
				data: '',
			};

			const txn: EosioTransaction = {
				actions: [action],
			};
			EOSManager.initWithDefaults();
			const result = await EOSManager.transact(txn, {
				addNonce: true,
				debug: true,
				blocksBehind: 3,
				logMessage: 'my log message',
			});
			chai.expect(result).equal({});
		});
	});
});
