import { assert } from 'chai';

import { nextExpireSeconds } from './eosManager';

/**
 * Two identical actions sent close together used to produce a byte-identical
 * transaction, which nodeos rejects as a duplicate before it reaches the
 * contract: `blocksBehind: 1` resolves to the same reference block for both
 * because blocks are 500ms apart, and `expireSeconds` is whole seconds so both
 * shared an expiration.
 *
 * The failure named a duplicate that did not exist in the test source -- the
 * actions only have to be identical, not intentionally repeated. It was found
 * in a consumer's suite where every amount differed and a `sleep(1000)` had
 * already been added by someone who hit it and papered over it.
 *
 * See issue #75.
 */
describe('nextExpireSeconds', () => {
	it('returns a different value on consecutive calls', () => {
		// The whole point: identical actions must not pack to identical bytes.
		assert.notStrictEqual(nextExpireSeconds(), nextExpireSeconds());
	});

	it('produces no repeat across a realistic burst', () => {
		const values = Array.from({ length: 40 }, () => nextExpireSeconds());

		assert.strictEqual(
			new Set(values).size,
			values.length,
			'two transactions in one block would collide again'
		);
	});

	it('stays within a sane range', () => {
		// Long enough to land, far short of the chain's max transaction lifetime.
		for (let i = 0; i < 200; i++) {
			const seconds = nextExpireSeconds();

			assert.isAtLeast(seconds, 30);
			assert.isBelow(seconds, 90);
		}
	});

	it('increments rather than randomises, so a failing run reproduces', () => {
		const first = nextExpireSeconds();
		const second = nextExpireSeconds();

		// Wraps at the top of the spread, hence the modulo rather than a plain +1.
		const expected = second === 30 ? 89 : second - 1;

		assert.strictEqual(first, expected);
	});
});
