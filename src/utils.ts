import * as assert from 'assert';
import * as chai from 'chai';
// @ts-ignore
import * as deepEqualInAnyOrder from 'deep-equal-in-any-order';
import * as chaiAsPromised from 'chai-as-promised';

import { EOSManager } from './eosManager';
import { TableRowsResult, TransactionResponse } from './contracts';
import { ConfigManager } from './configManager';
import * as chalk from 'chalk';

// Extend Chai's expect methods
chai.use(deepEqualInAnyOrder);
chai.use(chaiAsPromised);

/**
 * Pauses the current process until the specified EOS block number occurs
 * @note Assumes blocks will always be produced every 500ms
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param number Process sleep duration
 */
export const untilBlocknumber = async (number: number) => {
	// Loops until current head block number reaches desired
	let { head_block_num } = await EOSManager.rpc.get_info();
	while (head_block_num < number) {
		// Sleep for block duration and update current block number
		await sleep((number - head_block_num) * 500);
		({ head_block_num } = await EOSManager.rpc.get_info());
	}
};

/**
 * Pauses the current process for the specified duration
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param delayInMs Process sleep duration
 */
export const sleep = async (delayInMs: number) =>
	new Promise((resolve) => setTimeout(resolve, delayInMs));

/**
 * Pauses the current process for the 500ms EOS block time
 * @note The process will wake during and not on the next block
 * @author Kevin Brown <github.com/thekevinbrown>
 */
export const nextBlock = () => sleep(500);

/**
 * Compares table rows against expected rows irrespective of order
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @param getTableRowsResult Get table rows result promise
 * @param expected Expected table row query results
 */
export const assertRowsContain = async <RowType>(
	getTableRowsResult: Promise<TableRowsResult<RowType>>,
	expected: RowType,
	strict: boolean = false
) => {
	// Pass-through strict comparison

	// Call table row query and assert results eventually equal expected
	const result = await getTableRowsResult;
	// @ts-ignore - Not sure how to add this extended method `equalInAnyOrder`?
	// let matching: RowType[] = result.rows.some(value => {
	// 	return value == expected;
	// });
	// chai.expect(matching.length > 0).to.be.true;
	chai.expect(result.rows).contain(expected);
};

/**
 * Asserts that the promise succeeds in execution.
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @param operation Operation promise
 */
export const assertSucceeds = async (operation: Promise<any>): Promise<TransactionResponse> => {
	return await chai.expect(operation).to.be.fulfilled;
};

/**
 * Compares table rows against expected rows irrespective of order
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param getTableRowsResult Get table rows result promise
 * @param expected Expected table row query results
 * @param strict Strict comparison flag
 */
export const assertRowsEqual = async <RowType>(
	getTableRowsResult: Promise<TableRowsResult<RowType>>,
	expected: Array<RowType>,
	strict: boolean = false
) => {
	// Pass-through strict comparison
	if (strict) {
		assertRowsEqualStrict(getTableRowsResult, expected);
		return;
	}
	// Call table row query and assert results eventually equal expected
	const result = await getTableRowsResult;
	// @ts-ignore - Not sure how to add this extended method `equalInAnyOrder`?
	chai.expect(result.rows).to.deep.equalInAnyOrder(expected);
};

/**
 * Performs a strict comparison of queried table rows against expected rows
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param getTableRowsResult Get table rows result promise
 * @param expected Expected table row query results
 */
export const assertRowsEqualStrict = async <RowType>(
	getTableRowsResult: Promise<TableRowsResult<RowType>>,
	expected: Array<RowType>
) => {
	// Call the table row query and assert results equal expected
	const result = await getTableRowsResult;

	assert.deepStrictEqual(result.rows, expected);
};

/**
 * Validates the number of rows returned is equal to the expected count
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param getTableRowsResult Get table rows result promise
 * @param expectedRowCount Expected number of table rows
 */
export const assertRowCount = async (
	getTableRowsResult: Promise<TableRowsResult<any>>,
	expectedRowCount: number
) => {
	const result = await getTableRowsResult;
	// Precheck table rows don't extend beyond returned result
	assert.strictEqual(
		result.more,
		false,
		`There were more rows pending on the response which was not expected.`
	);
	// Validate the number of rows returned equals the expected count
	assert.strictEqual(
		result.rows.length,
		expectedRowCount,
		`Different number of rows than expected.`
	);
};

/**
 * Finds the right balance in table rows and asserts it's equal to quantity given
 * @author Angelo Laub <github.com/angelol>
 * @param getTableRowsResult Get table rows result promise
 * @param quantity Expected quantity (e.g. "123.4567 EOS")
 */
export const assertBalanceEqual = async (
	getTableRowsResult: Promise<TableRowsResult<any>>,
	quantity: string
) => {
	const [expected_amount, expected_symbol] = quantity.split(' ');
	const rows = (await getTableRowsResult).rows;
	let found_symbol = false;
	for (const row of rows) {
		const bal = row.balance;
		if (!bal) {
			continue;
		}
		const [amount, symbol] = bal.split(' ');
		if (symbol == expected_symbol) {
			chai.expect(amount).to.equal(expected_amount);
			found_symbol = true;
		}
	}
	assert.ok(found_symbol, `No balance found for symbol ${expected_symbol}`);
};

/**
 * Asserts EOS throws an error and validates the error output name matches the expected `eosErrorName`
 * Also asserts that other aspects of the error as checked through an optional passed in function.
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @author Kevin Brown <github.com/thekevinbrown>
 * @author Mitch Pierias <github.com/MitchPierias>
 * @param operation Operation promise
 * @param eosErrorName Expected EOS error name
 * @param description Output message description
 * @param furtherErrorCheck function to run further assertions on a thrown error.
 * @returns a Boolean of true if an error was thrown as is expected.
 */
const assertExpectedEOSError = async (
	operation: Promise<any>,
	eosErrorName: string,
	furtherErrorCheck?: (err: any) => any
): Promise<boolean> => {
	// Execute operation and handle exceptions
	try {
		await operation;
	} catch (error) {
		if (error.json && error.json.error && error.json.error.name) {
			// Compare error and fail if the error doesn't match the expected
			assert(
				error.json.error.name === eosErrorName,
				`Expected ${eosErrorName}, got ${JSON.stringify(error, null, 4)} instead.`
			);
			if (furtherErrorCheck) {
				furtherErrorCheck(error);
			}
		} else {
			// Fail if error not thrown by EOS
			assert.fail(
				`Expected EOS error ${eosErrorName}, but got ${JSON.stringify(error, null, 4)} instead.`
			);
		}
		return true;
	}
	return false;
};

/**
 * Asserts EOS throws an error and validates the error output name matches the expected `eosErrorName`
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param operation Operation promise
 * @param eosErrorName Expected EOS error name
 * @param description Output message description
 */
export const assertEOSError = async (
	operation: Promise<any>,
	eosErrorName: string,
	description: string
) => {
	if (assertExpectedEOSError(operation, eosErrorName)) {
		// Execute operation and handle exceptions
		assert.fail(`Expected ${description} but operation completed successfully.`);
	}
};

/**
 * Asserts EOS throws an error and validates the error output name matches the
 * expected 'eosio_assert_message_exception' and the error message includes `description`
 * @author Dallas Johnson <github.com/dallasjohnson>
 * @param operation Operation promise
 * @param message Output message expected to be included
 */
export const assertEOSErrorIncludesMessage = async (
	operation: Promise<any>,
	message: string,
	errorName?: string
) => {
	const eosErrorName = errorName || 'eosio_assert_message_exception';
	// Execute operation and handle exceptions
	if (
		!(await assertExpectedEOSError(operation, eosErrorName, (error) => {
			let errorMessage = error.json.error.details[0].message;

			if (!errorMessage) {
				assert.fail(
					`Expected EOS error ${eosErrorName}, but got ${JSON.stringify(error, null, 4)} instead.`
				);
			}
			assert(
				errorMessage.includes(message),
				`Expected to include \"${message}\", got \"${JSON.stringify(error, null, 4)}\" instead.`
			);
		}))
	) {
		// Fail if no exception thrown
		assert.fail(
			`Expected ${eosErrorName} with message to include \"${message}\" but operation completed successfully.`
		);
	}
};

/**
 * Asserts operation throws an `eosio_assert_message_exception` error
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param operation Operation promise
 */
export const assertEOSException = async (operation: Promise<any>) =>
	assertEOSError(operation, 'eosio_assert_message_exception', 'assert');

/**
 * Asserts operation is missing the required authority by throwing a `missing_auth_exception` error
 * @author Kevin Brown <github.com/thekevinbrown>
 * @param operation Operation promise
 */
export const assertMissingAuthority = async (operation: Promise<any>) =>
	assertEOSErrorIncludesMessage(operation, '', 'missing_auth_exception');

export async function debugPromise<T>(
	promise: Promise<T>,
	successMessage: string,
	errorMessage?: string
) {
	let debugPrefix = 'DebugPromise: ';
	let successString = debugPrefix + successMessage;

	let errorString = errorMessage
		? debugPrefix + errorMessage + ': '
		: debugPrefix + 'error - ' + successMessage + ': ';
	const promiseTimer = timer();
	return promise
		.then((value) => {
			if (ConfigManager.debugLevelVerbose || ConfigManager.debugLevelMin) {
				console.log(chalk.green(successString) + chalk.blue(' (%s)'), promiseTimer.ms);
			}
			if (ConfigManager.debugLevelVerbose) {
				console.log(`Promise result: ${JSON.stringify(value, null, 4)}`);
			}
			return value;
		})
		.catch((err) => {
			assert.fail(errorString + err);
		});
}

/**
 * Simple timer
 */
export function timer() {
	let timeStart = new Date().getTime();
	return {
		/** <integer>s e.g 2s etc. */
		get seconds() {
			const seconds = Math.ceil((new Date().getTime() - timeStart) / 1000) + 's';
			return seconds;
		},
		/** Milliseconds e.g. 2000ms etc. */
		get ms() {
			const ms = new Date().getTime() - timeStart + 'ms';
			return ms;
		},
	};
}
