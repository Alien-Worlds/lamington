const chai = require('chai');
import { log } from 'console';
import { pascalCase } from './utils';

describe('util', function () {
	context('pascalCase', function () {
		context('with underscores', async () => {
			it('should work', function () {
				const source = 'variant_name_string_uint8_uint16_uint32_uint64_uint128_checksum256';
				const result = pascalCase(source);
				chai.expect(result).to.equal('VariantNameStringUint8Uint16Uint32Uint64Uint128Checksum256');
			});
		});
		context('with arrays', async () => {
			it('should work', function () {
				const source = 'variant_name_string_uint8_uint16_uint32[]_uint64[]_uint128_checksum256';
				const result = pascalCase(source);
				chai
					.expect(result)
					.to.equal('VariantNameStringUint8Uint16Uint32VecUint64VecUint128Checksum256');
			});
		});
	});
});
