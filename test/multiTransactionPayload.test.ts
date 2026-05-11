import assert from "node:assert";
import { utils, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";
import {
	MultiTransactionPayload,
	MultiTransactionSimulationError,
} from "../src";
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

function signAllWith(signer: web3.Keypair) {
	return async <T extends web3.Transaction | web3.VersionedTransaction>(
		transactions: T[],
	): Promise<T[]> => {
		return transactions.map((transaction) => {
			if (transaction instanceof web3.Transaction) {
				transaction.sign(signer);
			} else {
				transaction.sign([signer]);
			}
			return transaction;
		});
	};
}

describe("MultiTransactionPayload", () => {
	describe("constructor validation", () => {
		it("should throw when transactionsData is empty", () => {
			assert.throws(
				() =>
					new MultiTransactionPayload(
						connection,
						new Map(),
						[],
						signAllWith(walletA.payer),
					),
				/At least one transaction is required/,
			);
		});

		it("should throw when a transaction has no instructions", () => {
			assert.throws(
				() =>
					new MultiTransactionPayload(
						connection,
						new Map(),
						[{ instructions: [], feePayer: walletA.publicKey }],
						signAllWith(walletA.payer),
					),
				/No instructions provided/,
			);
		});

		it("should throw when feePayer is missing", () => {
			const ix = buildTransferIx(walletA.publicKey, walletB.publicKey, 1000);
			assert.throws(
				() =>
					new MultiTransactionPayload(
						connection,
						new Map(),
						[
							{
								instructions: [ix],
								// @ts-expect-error testing runtime validation
								feePayer: undefined,
							},
						],
						signAllWith(walletA.payer),
					),
				/Fee payer is required/,
			);
		});

		it("should construct successfully via static create()", () => {
			const ix = buildTransferIx(walletA.publicKey, walletB.publicKey, 1000);
			const payload = MultiTransactionPayload.create(
				connection,
				new Map(),
				[{ instructions: [ix], feePayer: walletA.publicKey }],
				signAllWith(walletA.payer),
			);

			assert.ok(payload instanceof MultiTransactionPayload);
			assert.strictEqual(payload.transactionsData.length, 1);
		});
	});

	describe("execute - error cases", () => {
		it("should throw SIGN_FUNCTION_REQUIRED when signAllTransactions is missing", async () => {
			const ix = buildTransferIx(walletA.publicKey, walletB.publicKey, 1000);
			const payload = new MultiTransactionPayload(connection, new Map(), [
				{ instructions: [ix], feePayer: walletA.publicKey },
			]);

			await assert.rejects(
				() => payload.execute({ commitment: "confirmed" }),
				/signTransaction is required/,
			);
		});

		it("should return per-transaction rejected results when priority fee is enabled with 0 SOL balance", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();
			const ix = buildTransferIx(
				fromKeypair.publicKey,
				toKeypair.publicKey,
				Math.floor(0.05 * web3.LAMPORTS_PER_SOL),
			);

			const transactionsData = [
				{ instructions: [ix], feePayer: fromKeypair.publicKey },
				{ instructions: [ix], feePayer: fromKeypair.publicKey },
			];

			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				transactionsData,
				signAllWith(fromKeypair),
			);

			const results = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: true,
			});

			assert.strictEqual(results.length, transactionsData.length);
			for (const result of results) {
				assert.strictEqual(result.status, "rejected");
				if (result.status === "rejected") {
					const message =
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason);
					assert.ok(
						/An account does not have enough SOL for transaction/.test(message),
						`Unexpected reason: ${message}`,
					);
				}
			}
		});

		it("should mark every result as rejected with insufficient funds when priority fee is disabled", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();
			const ix = buildTransferIx(
				fromKeypair.publicKey,
				toKeypair.publicKey,
				Math.floor(0.05 * web3.LAMPORTS_PER_SOL),
			);

			const transactionsData = Array.from({ length: 3 }).map(() => ({
				instructions: [ix],
				feePayer: fromKeypair.publicKey,
			}));

			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				transactionsData,
				signAllWith(fromKeypair),
			);

			const results = await payload.execute({
				commitment: "confirmed",
				enablePriorityFee: false,
				skipPreflight: false,
			});

			assert.strictEqual(results.length, transactionsData.length);
			for (const result of results) {
				assert.strictEqual(result.status, "rejected");
				assert.ok(result.transactionData);
				assert.ok(result.transaction instanceof web3.VersionedTransaction);
				if (result.status === "rejected") {
					const message =
						result.reason instanceof Error
							? result.reason.message
							: String(result.reason);
					assert.ok(
						/An account does not have enough SOL for transaction/.test(message),
						`Unexpected reason: ${message}`,
					);
				}
			}
		});
	});

	describe("execute - happy path", () => {
		it("should execute multiple transactions and return one result per input", async () => {
			const transactionData = Array.from({ length: 3 }).map(() => ({
				instructions: [
					buildTransferIx(
						walletA.publicKey,
						walletB.publicKey,
						Math.floor(Math.random() * 1000) + 1,
					),
				],
				feePayer: walletA.publicKey,
				signers: [],
				addressLookupTableAccounts: [],
			}));

			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				transactionData,
				signAllWith(walletA.payer),
			);

			const results = await payload.execute({
				commitment: "confirmed",
				skipPreflight: true,
			});

			assert.strictEqual(results.length, transactionData.length);

			const fulfilledSignatures: string[] = [];
			for (const [i, result] of results.entries()) {
				assert.ok(result.transactionData);
				assert.strictEqual(
					result.transactionData,
					transactionData[i],
					"transactionData should reference original input by index",
				);
				assert.ok(result.transaction instanceof web3.VersionedTransaction);

				if (result.status === "fulfilled") {
					assert.strictEqual(typeof result.value, "string");
					const decoded = utils.bytes.bs58.decode(result.value);
					assert.strictEqual(
						decoded.length,
						64,
						"signature should decode to 64 bytes",
					);
					fulfilledSignatures.push(result.value);
					console.log(`tx[${i}]:`, getTxUrl(result.value, network));
				} else {
					console.log(`tx[${i}] rejected:`, result.reason);
				}
			}

			assert.strictEqual(
				new Set(fulfilledSignatures).size,
				fulfilledSignatures.length,
				"each fulfilled signature should be unique",
			);
		});
	});

	describe("simulate", () => {
		it("should return a Map keyed by transaction index", async () => {
			const transactionData = Array.from({ length: 2 }).map(() => ({
				instructions: [
					buildTransferIx(walletA.publicKey, walletB.publicKey, 1000),
				],
				feePayer: walletA.publicKey,
			}));

			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				transactionData,
				signAllWith(walletA.payer),
			);

			const simulationResults = await payload.simulate({
				commitment: "confirmed",
			});

			assert.ok(simulationResults instanceof Map);
			assert.strictEqual(simulationResults.size, transactionData.length);
			for (let i = 0; i < transactionData.length; i++) {
				assert.ok(
					simulationResults.has(i),
					`missing simulation for index ${i}`,
				);
				const result = simulationResults.get(i);
				assert.ok(result?.value);
				assert.strictEqual(result.value.err, null);
			}
		});

		it("should surface simulation errors via value.err when transfer would fail", async () => {
			const fromKeypair = web3.Keypair.generate();
			const toKeypair = web3.Keypair.generate();
			const ix = buildTransferIx(
				fromKeypair.publicKey,
				toKeypair.publicKey,
				Math.floor(0.05 * web3.LAMPORTS_PER_SOL),
			);

			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				[{ instructions: [ix], feePayer: fromKeypair.publicKey }],
				signAllWith(fromKeypair),
			);

			const results = await payload.simulate({ commitment: "confirmed" });
			assert.strictEqual(results.size, 1);
			const sim = results.get(0);
			assert.ok(sim);
			assert.notStrictEqual(
				sim.value.err,
				null,
				"unfunded transfer should report a simulation err",
			);
		});

		it("MultiTransactionSimulationError should carry per-index error metadata", () => {
			const inner = new Error("boom");
			const err = new MultiTransactionSimulationError("aggregate failure", [
				{ index: 0, error: inner },
				{ index: 2, error: "string error" },
			]);

			assert.ok(err instanceof MultiTransactionSimulationError);
			assert.ok(err instanceof Error);
			assert.strictEqual(err.name, "MultiTransactionSimulationError");
			assert.strictEqual(err.message, "aggregate failure");
			assert.strictEqual(err.simulationErrors.length, 2);
			assert.deepStrictEqual(
				err.simulationErrors.map((e) => e.index),
				[0, 2],
			);
			assert.strictEqual(err.simulationErrors[0]?.error, inner);
		});
	});

	describe("buildVersionTransactions", () => {
		it("should build a VersionedTransaction per input", async () => {
			const ix = buildTransferIx(walletA.publicKey, walletB.publicKey, 1000);
			const payload = new MultiTransactionPayload(
				connection,
				new Map(),
				[
					{ instructions: [ix], feePayer: walletA.publicKey },
					{ instructions: [ix], feePayer: walletA.publicKey },
				],
				signAllWith(walletA.payer),
			);

			const { blockhash } = await connection.getLatestBlockhash("confirmed");
			const transactions = await payload.buildVersionTransactions(blockhash);

			assert.strictEqual(transactions.length, 2);
			for (const tx of transactions) {
				assert.ok(tx instanceof web3.VersionedTransaction);
			}
		});
	});
});
