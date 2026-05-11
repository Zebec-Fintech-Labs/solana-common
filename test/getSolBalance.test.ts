import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";
import { describe, it } from "mocha";

import { formatSol, getSolBalance } from "../src";

describe("getSolBalance()", () => {
	const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
	const fundedAddress = "2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4";
	const emptyAddress = "KjC2CMdFWrqULujEECU4W2fQhdZ36vXn3XA8u8DpHqD";

	it("should fetch SOL balance for a funded address", async () => {
		const balance = await getSolBalance(connection, fundedAddress);

		assert.strictEqual(typeof balance, "string");
		assert.ok(balance.length > 0, "balance should be a non-empty string");
		assert.ok(BigNumber(balance).isFinite(), "balance should be numeric");
		assert.ok(BigNumber(balance).gt(0), "funded address should have > 0 SOL");
		// formatSol uses plain decimal notation; no exponent characters.
		assert.ok(
			!balance.includes("e") && !balance.includes("E"),
			"balance should not be in scientific notation",
		);
	});

	it("should return '0' for an empty (never-funded) address", async () => {
		const balance = await getSolBalance(connection, emptyAddress);
		assert.strictEqual(balance, "0");
	});

	it("should accept a web3.PublicKey and a string interchangeably", async () => {
		const pubkey = new web3.PublicKey(fundedAddress);
		const fromString = await getSolBalance(connection, fundedAddress);
		const fromPubkey = await getSolBalance(connection, pubkey);
		assert.strictEqual(fromString, fromPubkey);
	});

	it("should accept a GetBalanceConfig object", async () => {
		const balance = await getSolBalance(connection, fundedAddress, {
			commitment: "confirmed",
		});
		assert.strictEqual(typeof balance, "string");
		assert.ok(BigNumber(balance).gte(0));
	});

	it("should accept each commitment level", async () => {
		for (const commitment of ["processed", "confirmed", "finalized"] as const) {
			const balance = await getSolBalance(
				connection,
				fundedAddress,
				commitment,
			);
			assert.ok(
				BigNumber(balance).gte(0),
				`commitment=${commitment} should yield a non-negative balance`,
			);
		}
	});

	it("should equal formatSol(lamports) for the same account snapshot", async () => {
		// Pin both reads to the same commitment so the snapshot is comparable.
		const pubkey = new web3.PublicKey(fundedAddress);
		const [lamports, fromHelper] = await Promise.all([
			connection.getBalance(pubkey, "confirmed"),
			getSolBalance(connection, fundedAddress, "confirmed"),
		]);
		assert.strictEqual(fromHelper, formatSol(lamports));
	});

	it("should default to 'finalized' commitment when none is provided", async () => {
		const [defaulted, explicit] = await Promise.all([
			getSolBalance(connection, fundedAddress),
			getSolBalance(connection, fundedAddress, "finalized"),
		]);
		assert.strictEqual(defaulted, explicit);
	});
});
