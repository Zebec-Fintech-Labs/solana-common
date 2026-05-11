import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
	WSOL,
} from "../src";

describe("getAssociatedTokenAddressSync", () => {
	it("should derive a deterministic ATA for a given mint/owner", () => {
		const owner = new web3.PublicKey(
			"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
		);

		const ata1 = getAssociatedTokenAddressSync(WSOL, owner);
		const ata2 = getAssociatedTokenAddressSync(WSOL, owner);

		assert.ok(ata1 instanceof web3.PublicKey);
		assert.ok(ata1.equals(ata2), "same inputs should yield same address");
	});

	it("should produce different addresses for different mints", () => {
		const owner = new web3.PublicKey(
			"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
		);
		const otherMint = new web3.PublicKey(
			"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		);

		const ata1 = getAssociatedTokenAddressSync(WSOL, owner);
		const ata2 = getAssociatedTokenAddressSync(otherMint, owner);

		assert.ok(!ata1.equals(ata2));
	});

	it("should produce different addresses for different owners", () => {
		const ownerA = new web3.PublicKey(
			"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
		);
		const ownerB = new web3.PublicKey(
			"KjC2CMdFWrqULujEECU4W2fQhdZ36vXn3XA8u8DpHqD",
		);

		const ataA = getAssociatedTokenAddressSync(WSOL, ownerA);
		const ataB = getAssociatedTokenAddressSync(WSOL, ownerB);

		assert.ok(!ataA.equals(ataB));
	});

	it("should match SDK-derived address via findProgramAddressSync", () => {
		const owner = new web3.PublicKey(
			"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
		);

		const [expected] = web3.PublicKey.findProgramAddressSync(
			[owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), WSOL.toBuffer()],
			ASSOCIATED_TOKEN_PROGRAM_ID,
		);

		const actual = getAssociatedTokenAddressSync(WSOL, owner);
		assert.ok(expected.equals(actual));
	});

	it("should throw when owner is off-curve and allowOwnerOffCurve is false", () => {
		// A PDA-style key — derive one that is guaranteed off-curve.
		const [offCurveOwner] = web3.PublicKey.findProgramAddressSync(
			[Buffer.from("off-curve-seed")],
			ASSOCIATED_TOKEN_PROGRAM_ID,
		);

		assert.throws(
			() => getAssociatedTokenAddressSync(WSOL, offCurveOwner),
			/Token owner is off curve/,
		);
	});

	it("should accept an off-curve owner when allowOwnerOffCurve is true", () => {
		const [offCurveOwner] = web3.PublicKey.findProgramAddressSync(
			[Buffer.from("off-curve-seed")],
			ASSOCIATED_TOKEN_PROGRAM_ID,
		);

		const ata = getAssociatedTokenAddressSync(WSOL, offCurveOwner, true);
		assert.ok(ata instanceof web3.PublicKey);
	});
});
