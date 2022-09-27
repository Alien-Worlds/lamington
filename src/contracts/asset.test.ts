const chai = require('chai');
import { Asset } from './asset';

describe('Asset', function () {
	context('constructor', function () {
		it('should work with string input', function () {
			const a = new Asset('10.12345 TLM');
			chai.expect(a.amount).to.equal(10.12345);
			chai.expect(a.symbol).to.equal('TLM');
			chai.expect(a.precision).to.equal(5);
			chai.expect(a.toString()).to.equal('10.12345 TLM');
			chai.expect(a.amount_raw()).to.equal(10.12345 * 10 ** 5);
		});
		it('should work with number and symbol input', function () {
			const a = new Asset(10.1235, 'XYZ');
			chai.expect(a.amount).to.equal(10.1235);
			chai.expect(a.symbol).to.equal('XYZ');
			chai.expect(a.precision).to.equal(4);
			chai.expect(a.toString()).to.equal('10.1235 XYZ');
			chai.expect(a.amount_raw()).to.equal(10.1235 * 10 ** 4);
		});
		it('should work with number and symbol and precision input', function () {
			const a = new Asset(10.1235, 'XYZ', 5);
			chai.expect(a.amount).to.equal(10.1235);
			chai.expect(a.symbol).to.equal('XYZ');
			chai.expect(a.precision).to.equal(5);
			chai.expect(a.toString()).to.equal('10.12350 XYZ');
			chai.expect(a.amount_raw()).to.equal(10.1235 * 10 ** 5);
		});
		it('should fail with incorrect precision', function () {
			chai
				.expect(() => {
					new Asset(10.12356, 'XYZ', 4);
				})
				.to.throw('Precision 4 too low to represent 10.12356');
		});
	});

	context('addition', function () {
		it('should work', function () {
			const a = new Asset(10.1235, 'XYZ');
			const b = a.add(new Asset(1, 'XYZ'));
			chai.expect(b.toString()).to.equal('11.1235 XYZ');
			chai.expect(a.toString()).to.equal('10.1235 XYZ');
		});
		it('should not mutate asset', function () {
			const a = new Asset(10.1235, 'XYZ');
			const b = a.add(new Asset(1, 'XYZ'));
			chai.expect(a.toString()).to.equal('10.1235 XYZ');
		});
		it('of wrong symbol should fail', function () {
			const a = new Asset(10.1235, 'XYZ');
			chai
				.expect(() => {
					a.add(new Asset(1, 'ABC'));
				})
				.to.throw('Differing symbol');
		});
		it('of wrong precision should fail', function () {
			const a = new Asset(10.1235, 'XYZ', 6);
			chai
				.expect(() => {
					a.add(new Asset(1, 'XYZ'));
				})
				.to.throw('Differing precision');
		});
	});
	context('subtraction', function () {
		it('should work', function () {
			const a = new Asset(10.1235, 'XYZ');
			const b = a.sub(new Asset(1, 'XYZ'));
			chai.expect(b.toString()).to.equal('9.1235 XYZ');
			chai.expect(a.toString()).to.equal('10.1235 XYZ');
		});
		it('should not mutate asset', function () {
			const a = new Asset(10.1235, 'XYZ');
			const b = a.sub(new Asset(1, 'XYZ'));
			chai.expect(a.toString()).to.equal('10.1235 XYZ');
		});
		it('of wrong symbol should fail', function () {
			const a = new Asset(10.1235, 'XYZ');
			chai
				.expect(() => {
					a.sub(new Asset(1, 'ABC'));
				})
				.to.throw('Differing symbol');
		});
		it('of wrong precision should fail', function () {
			const a = new Asset(10.1235, 'XYZ', 6);
			chai
				.expect(() => {
					a.sub(new Asset(1, 'XYZ'));
				})
				.to.throw('Differing precision');
		});
	});
});
