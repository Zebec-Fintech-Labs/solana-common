import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";
import { describe, it } from "mocha";

import { getTokenBalances } from "../src";

describe("getTokenBalances()", () => {
	const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
	const owner = "2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4";

	// Devnet test mints used in the original fixture. Categorised by what we
	// expect from the cluster so each test can assert against the right shape.
	const fundedMint = "De31sBPcDejCVpZZh1fq8SNs7AcuWcBKuU3k2jqnkmKc";
	const zeroBalanceMints = [
		"5qEhjfVc5C6bz1Vi7Uj5SiSeDvqsMtZwuVS9njoVPcRr",
		"8CSvK7xceqUeqRaPr91r5kgteXGcWmBL48aoUQCtdizq",
	];
	const unrelatedMint = "CxGWhBSj833PkjiJWhp3LiGMdQsqURkvCfigQ5Q4YNSK";

	it("should return one entry per requested mint", async () => {
		const tokenMints = [fundedMint, ...zeroBalanceMints];
		const balances = await getTokenBalances(
			connection,
			owner,
			tokenMints,
			true,
		);

		assert.strictEqual(Object.keys(balances).length, tokenMints.length);
		for (const mint of tokenMints) {
			assert.ok(mint in balances, `expected entry for mint ${mint}`);
		}
	});

	it("should return '0' for mints whose ATA does not exist", async () => {
		const balances = await getTokenBalances(
			connection,
			owner,
			zeroBalanceMints,
			true,
		);

		for (const mint of zeroBalanceMints) {
			assert.strictEqual(balances[mint], "0", `expected '0' for ${mint}`);
		}
	});

	it("should return a positive numeric string for a funded ATA", async () => {
		const balances = await getTokenBalances(
			connection,
			owner,
			[fundedMint],
			true,
		);

		const balance = balances[fundedMint];
		assert.ok(balance, "funded mint should be present in result");
		assert.strictEqual(typeof balance, "string");
		assert.ok(BigNumber(balance).isFinite(), "balance should be numeric");
		assert.ok(
			BigNumber(balance).gt(0),
			`funded mint should report > 0, got ${balance}`,
		);
		// formatToken uses plain decimal notation; no exponent characters.
		assert.ok(
			!balance.includes("e") && !balance.includes("E"),
			"balance should not be in scientific notation",
		);
	});

	it("should omit mints that were never requested", async () => {
		const balances = await getTokenBalances(
			connection,
			owner,
			[fundedMint],
			true,
		);
		assert.strictEqual(balances[unrelatedMint], undefined);
	});

	it("should return an empty record for an empty mints list", async () => {
		const balances = await getTokenBalances(connection, owner, [], true);
		assert.deepStrictEqual(balances, {});
	});

	it("should accept PublicKey inputs for owner and mints", async () => {
		const ownerKey = new web3.PublicKey(owner);
		const mintKeys = [new web3.PublicKey(fundedMint)];

		const fromString = await getTokenBalances(
			connection,
			owner,
			[fundedMint],
			true,
		);
		const fromPubkey = await getTokenBalances(
			connection,
			ownerKey,
			mintKeys,
			true,
		);

		assert.strictEqual(fromString[fundedMint], fromPubkey[fundedMint]);
	});

	it("should be idempotent when the same mint is requested twice", async () => {
		const balances = await getTokenBalances(
			connection,
			owner,
			[fundedMint, fundedMint],
			true,
		);

		// The record is keyed by mint string, so duplicates collapse to one
		// entry — but the value should still be defined and consistent.
		assert.ok(fundedMint in balances);
		assert.strictEqual(typeof balances[fundedMint], "string");
	});

	it("should accept a custom commitment via config", async () => {
		const balances = await getTokenBalances(
			connection,
			owner,
			[fundedMint],
			true,
			{ commitment: "finalized" },
		);
		assert.ok(fundedMint in balances);
		assert.strictEqual(typeof balances[fundedMint], "string");
	});

	it("should reject by default when owner is off-curve and allowOwnerOffCurve is false", async () => {
		// Derive a PDA — guaranteed off-curve.
		const [offCurveOwner] = web3.PublicKey.findProgramAddressSync(
			[Buffer.from("getTokenBalances-off-curve-seed")],
			new web3.PublicKey(fundedMint),
		);

		await assert.rejects(
			() => getTokenBalances(connection, offCurveOwner, [fundedMint], false),
			/Token owner is off curve/,
		);
	});

	it("should accept an off-curve owner when allowOwnerOffCurve is true", async () => {
		const [offCurveOwner] = web3.PublicKey.findProgramAddressSync(
			[Buffer.from("getTokenBalances-off-curve-seed")],
			new web3.PublicKey(fundedMint),
		);

		const balances = await getTokenBalances(
			connection,
			offCurveOwner,
			[fundedMint],
			true,
		);
		// PDA almost certainly has no ATA for this mint → "0", but we just
		// assert the request didn't throw and returned a defined entry.
		assert.ok(fundedMint in balances);
		assert.strictEqual(balances[fundedMint], "0");
	});
});
