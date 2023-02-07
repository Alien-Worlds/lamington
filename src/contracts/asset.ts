const assert = require('assert');

export class Asset {
	readonly amount: number;
	readonly symbol: string;
	readonly precision: number;

	constructor(amount: string | number, symbol?: string, precision = 4) {
		if (!symbol) {
			const [amount_str, symbol_str] = (amount as string).split(' ');
			this.amount = parseFloat(amount_str);
			const decimal_str = amount_str.split('.')[1];
			this.precision = decimal_str.length;
			this.symbol = symbol_str;
		} else {
			this.amount = amount as number;
			this.symbol = symbol;
			this.precision = precision;
		}

		const x = Math.round(this.amount * 10 ** this.precision) / 10 ** this.precision;
	}

	toString() {
		return `${this.amount.toFixed(this.precision)} ${this.symbol}`;
	}

	amount_raw() {
		return this.amount * 10 ** this.precision;
	}

	assertSame(other: Asset) {
		assert(this.symbol === other.symbol, `Differing symbol. Trying to add ${other} to ${this}`);
		assert(
			this.precision === other.precision,
			`Differing precision. Trying to add ${other} to ${this}`
		);
	}

	add(other: Asset) {
		this.assertSame(other);
		return new Asset(this.amount + other.amount, this.symbol, this.precision);
	}
	sub(other: Asset) {
		this.assertSame(other);
		return new Asset(this.amount - other.amount, this.symbol, this.precision);
	}
}
