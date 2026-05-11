import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	createAssociatedTokenAccountInstruction,
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
	WSOL,
} from "../src";

describe("createAssociatedTokenAccountInstruction", () => {
	const payer = new web3.PublicKey(
		"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
	);
	const owner = new web3.PublicKey(
		"KjC2CMdFWrqULujEECU4W2fQhdZ36vXn3XA8u8DpHqD",
	);
	const ata = getAssociatedTokenAddressSync(WSOL, owner);

	it("should target the Associated Token program", () => {
		const ix = createAssociatedTokenAccountInstruction(payer, ata, owner, WSOL);
		assert.ok(ix instanceof web3.TransactionInstruction);
		assert.ok(ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
	});

	it("should produce an empty data buffer", () => {
		const ix = createAssociatedTokenAccountInstruction(payer, ata, owner, WSOL);
		assert.strictEqual(ix.data.length, 0);
	});

	it("should set the correct keys with expected signer/writable flags", () => {
		const ix = createAssociatedTokenAccountInstruction(payer, ata, owner, WSOL);

		assert.strictEqual(ix.keys.length, 6);

		const [
			payerKey,
			ataKey,
			ownerKey,
			mintKey,
			systemProgramKey,
			tokenProgramKey,
		] = ix.keys;

		assert.ok(payerKey?.pubkey.equals(payer));
		assert.strictEqual(payerKey?.isSigner, true);
		assert.strictEqual(payerKey?.isWritable, true);

		assert.ok(ataKey?.pubkey.equals(ata));
		assert.strictEqual(ataKey?.isSigner, false);
		assert.strictEqual(ataKey?.isWritable, true);

		assert.ok(ownerKey?.pubkey.equals(owner));
		assert.strictEqual(ownerKey?.isSigner, false);
		assert.strictEqual(ownerKey?.isWritable, false);

		assert.ok(mintKey?.pubkey.equals(WSOL));
		assert.strictEqual(mintKey?.isSigner, false);
		assert.strictEqual(mintKey?.isWritable, false);

		assert.ok(systemProgramKey?.pubkey.equals(web3.SystemProgram.programId));
		assert.strictEqual(systemProgramKey?.isSigner, false);
		assert.strictEqual(systemProgramKey?.isWritable, false);

		assert.ok(tokenProgramKey?.pubkey.equals(TOKEN_PROGRAM_ID));
		assert.strictEqual(tokenProgramKey?.isSigner, false);
		assert.strictEqual(tokenProgramKey?.isWritable, false);
	});

	it("should honor custom program ids", () => {
		const customTokenProgram = web3.Keypair.generate().publicKey;
		const customAssociatedProgram = web3.Keypair.generate().publicKey;

		const ix = createAssociatedTokenAccountInstruction(
			payer,
			ata,
			owner,
			WSOL,
			customTokenProgram,
			customAssociatedProgram,
		);

		assert.ok(ix.programId.equals(customAssociatedProgram));
		assert.ok(ix.keys[5]?.pubkey.equals(customTokenProgram));
	});
});
