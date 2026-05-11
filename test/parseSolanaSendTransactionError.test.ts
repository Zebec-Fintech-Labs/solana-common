import assert from "node:assert";
import { describe, it } from "mocha";

import { parseSolanaSendTransactionError } from "../src";

describe("parseSolanaSendTransactionError", () => {
	const emptyIdlErrors = new Map<number, string>();

	describe("insufficient funds detection", () => {
		it("should detect 'Attempt to debit an account' message", () => {
			const raw = new Error(
				"Attempt to debit an account but found no record of a prior credit.",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(out instanceof Error);
			assert.strictEqual(
				out.message,
				"An account does not have enough SOL for transaction",
			);
		});

		it("should detect 'custom program error: 0x1' message", () => {
			const raw = new Error(
				"Transaction simulation failed: custom program error: 0x1\n",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.strictEqual(
				out.message,
				"An account does not have enough SOL for transaction",
			);
		});

		it("should detect 'insufficient funds' message", () => {
			const raw = new Error("rpc error: insufficient funds for rent");
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.strictEqual(
				out.message,
				"An account does not have enough SOL for transaction",
			);
		});
	});

	describe("Jupiter error detection", () => {
		it("should map 0x1771 to a slippage error", () => {
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/slippage exceed/i.test(out.message));
		});

		it("should map 0x1778 to a not-enough-account-keys error", () => {
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1778",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/insufficient account keys/i.test(out.message));
		});

		it("should map 0x1781 to an exact-out mismatch error", () => {
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1781",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/exact output amount/i.test(out.message));
		});

		it("should map 0x1788 to a jupiter insufficient funds error", () => {
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1788",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/insufficient funds/i.test(out.message));
			assert.ok(/Jupiter/i.test(out.message));
		});

		it("should map 0x1789 to an invalid token account error", () => {
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1789",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/invalid or uninitialized token account/i.test(out.message));
		});
	});

	describe("fallback paths", () => {
		it("should prefer transactionMessage over Error.message when present", () => {
			const raw = {
				message: "raw stringified logs blob",
				transactionMessage: "Transaction failed: Custom program error 0x999",
			};
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(out instanceof Error);
			assert.strictEqual(
				out.message,
				"Transaction failed: Custom program error 0x999",
			);
		});

		it("should return the translated error as-is for unrecognized shapes", () => {
			const raw = new Error("some other unrelated error");
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.strictEqual(out.message, "some other unrelated error");
		});
	});

	describe("resolution order", () => {
		it("should pick the Jupiter handler before the insufficient-funds handler when both substrings match", () => {
			// Message contains both "insufficient funds" and the Jupiter 0x1788 signature.
			// Jupiter check runs first, so we expect the Jupiter-formatted message.
			const raw = new Error(
				"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1788 (insufficient funds)",
			);
			const out = parseSolanaSendTransactionError(raw, emptyIdlErrors);
			assert.ok(/Jupiter/i.test(out.message));
		});
	});
});
