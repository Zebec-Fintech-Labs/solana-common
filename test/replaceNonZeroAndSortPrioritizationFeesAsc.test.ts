import assert from "node:assert";
import type { web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import { replaceNonZeroAndSortPrioritizationFeesAsc } from "../src";

type Fee = web3.RecentPrioritizationFees;

function fee(prioritizationFee: number, slot = 0): Fee {
	return { prioritizationFee, slot };
}

describe("replaceNonZeroAndSortPrioritizationFeesAsc", () => {
	it("should return an empty array for empty input", () => {
		assert.deepStrictEqual(replaceNonZeroAndSortPrioritizationFeesAsc([]), []);
	});

	it("should filter out entries with prioritizationFee = 0", () => {
		const input = [fee(0, 1), fee(100, 2), fee(0, 3), fee(50, 4)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);
		assert.strictEqual(out.length, 2);
		assert.ok(out.every((f) => f.prioritizationFee > 0));
	});

	it("should filter out entries with NaN prioritizationFee", () => {
		const input = [fee(NaN, 1), fee(123, 2), fee(NaN, 3)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0]?.prioritizationFee, 123);
	});

	it("should filter out negative entries (predicate is > 0)", () => {
		const input = [fee(-10, 1), fee(0, 2), fee(5, 3), fee(-1, 4)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0]?.prioritizationFee, 5);
	});

	it("should sort surviving entries in strictly ascending order", () => {
		const input = [fee(50_000), fee(10), fee(123), fee(7_500_000), fee(1)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);

		assert.deepStrictEqual(
			out.map((f) => f.prioritizationFee),
			[1, 10, 123, 50_000, 7_500_000],
		);

		// Every adjacent pair must be non-decreasing.
		for (let i = 1; i < out.length; i++) {
			const prev = out[i - 1];
			const curr = out[i];
			assert.ok(prev && curr);
			assert.ok(
				prev.prioritizationFee <= curr.prioritizationFee,
				`pair (${prev.prioritizationFee}, ${curr.prioritizationFee}) is not ascending`,
			);
		}
	});

	it("should preserve the slot field for each surviving entry", () => {
		const input = [fee(30, 1001), fee(0, 1002), fee(20, 1003), fee(10, 1004)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);

		assert.deepStrictEqual(out, [
			{ prioritizationFee: 10, slot: 1004 },
			{ prioritizationFee: 20, slot: 1003 },
			{ prioritizationFee: 30, slot: 1001 },
		]);
	});

	it("should not mutate the input array", () => {
		const input = [fee(3, 1), fee(NaN, 2), fee(0, 3), fee(1, 4)];
		const snapshot = input.map((f) => ({ ...f }));

		replaceNonZeroAndSortPrioritizationFeesAsc(input);

		assert.strictEqual(input.length, snapshot.length);
		input.forEach((f, i) => {
			const original = snapshot[i];
			assert.ok(original);
			if (Number.isNaN(original.prioritizationFee)) {
				assert.ok(Number.isNaN(f.prioritizationFee));
			} else {
				assert.strictEqual(f.prioritizationFee, original.prioritizationFee);
			}
			assert.strictEqual(f.slot, original.slot);
		});
	});

	it("should return an empty array when every entry is zero or NaN", () => {
		const input = [fee(0, 1), fee(NaN, 2), fee(0, 3), fee(NaN, 4)];
		assert.deepStrictEqual(
			replaceNonZeroAndSortPrioritizationFeesAsc(input),
			[],
		);
	});

	it("should keep duplicate fees and order them stably enough to be ascending", () => {
		const input = [fee(100, 10), fee(50, 20), fee(100, 30), fee(50, 40)];
		const out = replaceNonZeroAndSortPrioritizationFeesAsc(input);
		assert.deepStrictEqual(
			out.map((f) => f.prioritizationFee),
			[50, 50, 100, 100],
		);
	});

	it("should handle a single positive entry unchanged", () => {
		const input = [fee(42, 99)];
		assert.deepStrictEqual(replaceNonZeroAndSortPrioritizationFeesAsc(input), [
			{ prioritizationFee: 42, slot: 99 },
		]);
	});

	it("should produce a fully ascending result on a large realistic dataset", () => {
		// Sampled from a real `getRecentPrioritizationFees` response containing
		// NaNs, zeros, and a wide value range. The result must be entirely
		// non-NaN, strictly positive, and ascending.
		const fees: Fee[] = [
			fee(NaN, 338801267),
			fee(1904, 338801268),
			fee(8514, 338801269),
			fee(976832, 338801270),
			fee(0, 338801271),
			fee(2584, 338801272),
			fee(1769, 338801273),
			fee(4366, 338801274),
			fee(0, 338801275),
			fee(10934, 338801276),
			fee(166667, 338801277),
			fee(1488, 338801278),
			fee(0, 338801279),
			fee(7088, 338801280),
			fee(4367, 338801281),
			fee(1507, 338801282),
			fee(NaN, 338801283),
			fee(1047, 338801284),
			fee(11890, 338801285),
			fee(2000000, 338801286),
			fee(10000000, 338801287),
			fee(20, 338801288),
		];

		const sorted = replaceNonZeroAndSortPrioritizationFeesAsc(fees);

		// No NaNs, no zeros.
		assert.ok(
			sorted.every(
				(f) => !Number.isNaN(f.prioritizationFee) && f.prioritizationFee > 0,
			),
			"result still contains NaN or zero entries",
		);

		// Strictly non-decreasing.
		for (let i = 1; i < sorted.length; i++) {
			const prev = sorted[i - 1];
			const curr = sorted[i];
			assert.ok(prev && curr);
			assert.ok(
				prev.prioritizationFee <= curr.prioritizationFee,
				`out of order at index ${i}: ${prev.prioritizationFee} > ${curr.prioritizationFee}`,
			);
		}

		// Survivor count = inputs with positive, finite fee.
		const expectedSurvivors = fees.filter(
			(f) => !Number.isNaN(f.prioritizationFee) && f.prioritizationFee > 0,
		).length;
		assert.strictEqual(sorted.length, expectedSurvivors);
	});
});
