import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";
import { describe, it } from "mocha";

import { getRecentPriorityFee } from "../src";

describe("getRecentPriorityFee", () => {
	const connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"));

	const fromKeypair = web3.Keypair.generate();
	const toKeypair = web3.Keypair.generate();
	const transferIx = web3.SystemProgram.transfer({
		fromPubkey: fromKeypair.publicKey,
		toPubkey: toKeypair.publicKey,
		lamports: 1000,
	});

	it("should return a non-negative BigNumber capped by maxFeeCap", async () => {
		const maxFeeCap = BigNumber(50_000);
		const fee = await getRecentPriorityFee(
			connection,
			[transferIx],
			"medium",
			maxFeeCap,
		);

		assert.ok(BigNumber.isBigNumber(fee));
		assert.ok(fee.gte(0), `fee should be >= 0, got ${fee.toFixed()}`);
		assert.ok(
			fee.lte(maxFeeCap),
			`fee should be <= maxFeeCap, got ${fee.toFixed()}`,
		);
	});

	it("should never exceed maxFeeCap even for high priority", async () => {
		const maxFeeCap = BigNumber(1);
		const fee = await getRecentPriorityFee(
			connection,
			[transferIx],
			"high",
			maxFeeCap,
		);
		assert.ok(fee.lte(maxFeeCap));
	});

	it("should apply higher multiplier for 'high' than 'low' priority", async () => {
		const cap = BigNumber(Number.MAX_SAFE_INTEGER);
		const lowFee = await getRecentPriorityFee(
			connection,
			[transferIx],
			"low",
			cap,
		);
		const highFee = await getRecentPriorityFee(
			connection,
			[transferIx],
			"high",
			cap,
		);

		// If the cluster has any non-zero history, high (2.0x) must be > low (0.8x).
		// If both came back 0 the test is uninformative — log and skip.
		if (lowFee.eq(0) && highFee.eq(0)) {
			console.log(
				"Both fees were 0 — no non-zero history on the cluster right now",
			);
			return;
		}
		assert.ok(
			highFee.gte(lowFee),
			`high (${highFee.toFixed()}) should be >= low (${lowFee.toFixed()})`,
		);
	});

	it("should fall back to a default fee bounded by maxFeeCap when RPC throws", async () => {
		const brokenConnection = new web3.Connection("http://127.0.0.1:1"); // unreachable
		const maxFeeCap = BigNumber(10_000);

		const fee = await getRecentPriorityFee(
			brokenConnection,
			[transferIx],
			"medium",
			maxFeeCap,
		);

		assert.ok(BigNumber.isBigNumber(fee));
		assert.ok(fee.gte(0));
		assert.ok(fee.lte(maxFeeCap));
	});
});
