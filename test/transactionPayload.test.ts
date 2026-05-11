import assert from "node:assert";
import { utils, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";
import { TransactionPayload } from "../src";
import { getConnection, getTxUrl, getWallets } from "./shared";

const network = "devnet";
const connection = getConnection(network, "confirmed");
const wallets = getWallets(network);
const walletA = wallets[0];
const walletB = wallets[1];
console.log("walletA:", walletA.publicKey.toString());
console.log("walletB:", walletB.publicKey.toString());

function buildTransferIx(
	from: web3.PublicKey,
	to: web3.PublicKey,
	lamports: number,
) {
	return web3.SystemProgram.transfer({
		fromPubkey: from,
		toPubkey: to,
		lamports,
	});
}

function signWith(signer: web3.Keypair) {
	return async <T extends web3.Transaction | web3.VersionedTransaction>(
		transaction: T,
	): Promise<T> => {
		if (transaction instanceof web3.Transaction) {
			transaction.sign(signer);
		} else {
			transaction.sign([signer]);
		}
		return transaction;
	};
}

describe("TransactionPayload", () => {
	describe("execute - error cases", () => {
		it("should reject with translated insufficient funds error when balance is 0", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();

			const transferIxn = buildTransferIx(
				fromKeypair.publicKey,
				toKeypair.publicKey,
				1 * web3.LAMPORTS_PER_SOL,
			);

			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
					signers: [],
					addressLookupTableAccounts: [],
				},
				signWith(fromKeypair),
			);

			await assert.rejects(
				() => payload.execute({ commitment: "confirmed" }),
				(err: Error) => {
					assert.ok(err instanceof Error);
					assert.ok(
						/An account does not have enough SOL for transaction/.test(
							err.message,
						),
						`Unexpected message: ${err.message}`,
					);
					return true;
				},
			);
		});

		it("should reject when signTransaction function is not provided", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				1000,
			);
			const payload = new TransactionPayload(connection, new Map(), {
				instructions: [transferIxn],
				feePayer: walletA.publicKey,
				signers: [],
				addressLookupTableAccounts: [],
			});

			await assert.rejects(
				() => payload.execute({ commitment: "confirmed" }),
				/signTransaction is required/,
			);
		});

		it("should reject with insufficient funds without simulation when priority fee is disabled", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();

			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [
						buildTransferIx(
							fromKeypair.publicKey,
							toKeypair.publicKey,
							Math.floor(0.05 * web3.LAMPORTS_PER_SOL),
						),
					],
					feePayer: fromKeypair.publicKey,
				},
				signWith(fromKeypair),
			);

			await assert.rejects(
				() =>
					payload.execute({
						commitment: "confirmed",
						enablePriorityFee: false,
					}),
				(err: Error) =>
					/An account does not have enough SOL for transaction/.test(
						err.message,
					),
			);
		});
	});

	describe("execute - happy path", () => {
		it("should send a transaction with priority fee and return a valid bs58 signature", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				Math.floor(0.0001 * web3.LAMPORTS_PER_SOL),
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: walletA.publicKey,
					signers: [],
					addressLookupTableAccounts: [],
				},
				signWith(walletA.payer),
			);

			const signature = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: true,
				skipPreflight: true,
			});

			console.log("signature:", getTxUrl(signature, network));
			assert.strictEqual(typeof signature, "string");
			const decoded = utils.bytes.bs58.decode(signature);
			assert.strictEqual(
				decoded.length,
				64,
				"signature should decode to 64 bytes",
			);
		});

		it("should send a transaction with priority fee disabled", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				Math.floor(0.0001 * web3.LAMPORTS_PER_SOL),
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: walletA.publicKey,
				},
				signWith(walletA.payer),
			);

			const signature = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: false,
				skipPreflight: true,
			});

			console.log("signature (no priority):", getTxUrl(signature, network));
			assert.strictEqual(typeof signature, "string");
			const decoded = utils.bytes.bs58.decode(signature);
			assert.strictEqual(decoded.length, 64);
		});

		it("should honor exactPriorityFeeSol by injecting matching compute budget instructions", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				Math.floor(0.0001 * web3.LAMPORTS_PER_SOL),
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: walletA.publicKey,
				},
				async (transaction) => {
					if (transaction instanceof web3.VersionedTransaction) {
						const decompiled = web3.TransactionMessage.decompile(
							transaction.message,
						);
						const computeBudgetIxs = decompiled.instructions.filter((ix) =>
							ix.programId.equals(web3.ComputeBudgetProgram.programId),
						);
						assert.strictEqual(
							computeBudgetIxs.length,
							2,
							"expected SetComputeUnitLimit + SetComputeUnitPrice",
						);
						const types = computeBudgetIxs.map((ix) =>
							web3.ComputeBudgetInstruction.decodeInstructionType(ix),
						);
						assert.ok(types.includes("SetComputeUnitLimit"));
						assert.ok(types.includes("SetComputeUnitPrice"));
						transaction.sign([walletA.payer]);
					}
					return transaction;
				},
			);

			const signature = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: true,
				exactPriorityFeeSol: 0.00001,
				skipPreflight: true,
			});

			assert.strictEqual(typeof signature, "string");
			console.log(
				"signature (exactPriorityFee):",
				getTxUrl(signature, network),
			);
		});

		it("should not duplicate compute budget instructions when caller already provided them", async () => {
			const cuLimitIx = web3.ComputeBudgetProgram.setComputeUnitLimit({
				units: 200_000,
			});
			const cuPriceIx = web3.ComputeBudgetProgram.setComputeUnitPrice({
				microLamports: 1n,
			});
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				Math.floor(0.0001 * web3.LAMPORTS_PER_SOL),
			);

			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [cuLimitIx, cuPriceIx, transferIxn],
					feePayer: walletA.publicKey,
				},
				async (transaction) => {
					if (transaction instanceof web3.VersionedTransaction) {
						const decompiled = web3.TransactionMessage.decompile(
							transaction.message,
						);
						const computeBudgetIxs = decompiled.instructions.filter((ix) =>
							ix.programId.equals(web3.ComputeBudgetProgram.programId),
						);
						assert.strictEqual(
							computeBudgetIxs.length,
							2,
							"existing compute budget instructions should not be duplicated",
						);
						transaction.sign([walletA.payer]);
					}
					return transaction;
				},
			);

			const signature = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: true,
				skipPreflight: true,
			});

			assert.strictEqual(typeof signature, "string");
		});
	});

	describe("simulate", () => {
		it("should return a successful simulation result with unitsConsumed", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				1000,
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: walletA.publicKey,
				},
				signWith(walletA.payer),
			);

			const result = await payload.simulate({ commitment: "confirmed" });

			assert.ok(result);
			assert.ok(result.value);
			assert.strictEqual(result.value.err, null);
			assert.ok(
				result.value.unitsConsumed !== undefined &&
					result.value.unitsConsumed > 0,
				"unitsConsumed should be a positive number",
			);
		});

		it("should report value.err for an underfunded transfer (no throw)", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();
			const transferIxn = buildTransferIx(
				fromKeypair.publicKey,
				toKeypair.publicKey,
				1 * web3.LAMPORTS_PER_SOL,
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
				signWith(fromKeypair),
			);

			const result = await payload.simulate({ commitment: "confirmed" });
			assert.notStrictEqual(result.value.err, null);
		});

		it("should reject when sigVerify is true but no signTransaction is provided", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				1000,
			);
			const payload = new TransactionPayload(connection, new Map(), {
				instructions: [transferIxn],
				feePayer: walletA.publicKey,
			});

			await assert.rejects(
				() => payload.simulate({ commitment: "confirmed", sigVerify: true }),
				/signTransaction is required/,
			);
		});

		it("should simulate successfully with sigVerify and a provided signer", async () => {
			const transferIxn = buildTransferIx(
				walletA.publicKey,
				walletB.publicKey,
				1000,
			);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [transferIxn],
					feePayer: walletA.publicKey,
				},
				signWith(walletA.payer),
			);

			const result = await payload.simulate({
				commitment: "confirmed",
				sigVerify: true,
			});
			assert.strictEqual(result.value.err, null);
		});
	});

	describe("buildVersionTransaction", () => {
		it("should return a VersionedTransaction with the provided blockhash", async () => {
			const ix = buildTransferIx(walletA.publicKey, walletB.publicKey, 1000);
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{ instructions: [ix], feePayer: walletA.publicKey },
				signWith(walletA.payer),
			);

			const { blockhash } = await connection.getLatestBlockhash("confirmed");
			const tx = payload.buildVersionTransaction(blockhash);

			assert.ok(tx instanceof web3.VersionedTransaction);
			assert.strictEqual(tx.message.recentBlockhash, blockhash);
		});

		it("should apply provided signers to the built transaction", async () => {
			const ephemeralSigner = web3.Keypair.generate();
			const ix = web3.SystemProgram.transfer({
				fromPubkey: ephemeralSigner.publicKey,
				toPubkey: walletB.publicKey,
				lamports: 1000,
			});
			const payload = new TransactionPayload(
				connection,
				new Map(),
				{
					instructions: [ix],
					feePayer: ephemeralSigner.publicKey,
					signers: [ephemeralSigner],
				},
				signWith(ephemeralSigner),
			);

			const { blockhash } = await connection.getLatestBlockhash("confirmed");
			const tx = payload.buildVersionTransaction(blockhash);

			assert.ok(tx.signatures.length >= 1);
			const firstSig = tx.signatures[0];
			assert.ok(firstSig, "expected at least one signature slot");
			const allZero = firstSig.every((b) => b === 0);
			assert.strictEqual(
				allZero,
				false,
				"signer in transactionData should produce a non-empty signature",
			);
		});
	});
});
