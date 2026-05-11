import assert from "node:assert";
import BigNumber from "bignumber.js";
import { describe, it } from "mocha";

import { formatSol, formatToken, parseSol, parseToken } from "../src";

describe("amount conversion", () => {
	describe("parseSol", () => {
		it("should convert whole SOL to lamports", () => {
			assert.strictEqual(parseSol(1), 1_000_000_000n);
			assert.strictEqual(parseSol("1"), 1_000_000_000n);
		});

		it("should convert fractional SOL to lamports", () => {
			assert.strictEqual(parseSol(0.5), 500_000_000n);
			assert.strictEqual(parseSol("0.000000001"), 1n);
		});

		it("should return 0n for 0", () => {
			assert.strictEqual(parseSol(0), 0n);
			assert.strictEqual(parseSol("0"), 0n);
		});

		it("should accept BigNumber input", () => {
			assert.strictEqual(parseSol(BigNumber("2.5")), 2_500_000_000n);
		});

		it("should floor sub-lamport precision", () => {
			// 0.0000000001 SOL = 0.1 lamports → truncates to 0n
			assert.strictEqual(parseSol("0.0000000001"), 0n);
		});
	});

	describe("formatSol", () => {
		it("should convert lamports to whole SOL", () => {
			assert.strictEqual(formatSol(1_000_000_000), "1");
			assert.strictEqual(formatSol("1000000000"), "1");
		});

		it("should convert lamports to fractional SOL", () => {
			assert.strictEqual(formatSol(500_000_000), "0.5");
			assert.strictEqual(formatSol(1), "0.000000001");
		});

		it("should handle 0", () => {
			assert.strictEqual(formatSol(0), "0");
		});

		it("should round-trip with parseSol", () => {
			const original = "12.345678901";
			assert.strictEqual(formatSol(parseSol(original).toString()), original);
		});
	});

	describe("parseToken", () => {
		it("should convert ui amount to base units using decimals", () => {
			assert.strictEqual(parseToken("1", 6), 1_000_000n);
			assert.strictEqual(parseToken("1876.190996", 6), 1_876_190_996n);
		});

		it("should support 0 decimals", () => {
			assert.strictEqual(parseToken("42", 0), 42n);
		});

		it("should support large decimals", () => {
			assert.strictEqual(parseToken("1", 9), 1_000_000_000n);
		});

		it("should floor sub-base-unit precision", () => {
			// 1.9999999 USDC w/ 6 decimals → 1_999_999 (truncated)
			assert.strictEqual(parseToken("1.9999999", 6), 1_999_999n);
		});
	});

	describe("formatToken", () => {
		it("should convert base units to ui amount", () => {
			assert.strictEqual(formatToken(1_000_000, 6), "1");
			assert.strictEqual(formatToken(1_876_190_996, 6), "1876.190996");
		});

		it("should handle 0 decimals", () => {
			assert.strictEqual(formatToken(42, 0), "42");
		});

		it("should round-trip with parseToken", () => {
			const original = "123.456789";
			const decimals = 6;
			assert.strictEqual(
				formatToken(parseToken(original, decimals).toString(), decimals),
				original,
			);
		});
	});
});
