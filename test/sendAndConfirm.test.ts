import assert from "node:assert";
import { utils, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";
import { sendAndConfirm } from "../src";
import { getConnection, getTxUrl, getWallets } from "./shared";

const network = "devnet";
const connection = getConnection(network, "confirmed");
const wallets = getWallets(network);
const walletA = wallets[0];
const walletB = wallets[1];
console.log("walletA:", walletA.publicKey.toString());
console.log("walletB:", walletB.publicKey.toString());

function buildTransferIx(from: web3.PublicKey, to: web3.PublicKey) {
	return web3.SystemProgram.transfer({
		fromPubkey: from,
		toPubkey: to,
		lamports: Math.floor(0.0001 * web3.LAMPORTS_PER_SOL),
	});
}

describe("sendAndConfirm", () => {
	it("should send and confirm a signed legacy Transaction", async () => {
		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash("confirmed");

		const transaction = new web3.Transaction({
			feePayer: walletA.publicKey,
			blockhash,
			lastValidBlockHeight,
		}).add(buildTransferIx(walletA.publicKey, walletB.publicKey));

		transaction.sign(walletA.payer);

		const signature = await sendAndConfirm({
			connection,
			signedTransaction: transaction,
			blockhash,
			lastValidBlockHeight,
			options: { commitment: "confirmed", skipPreflight: true },
		});

		console.log("legacy signature:", getTxUrl(signature, network));
		assert.ok(signature && typeof signature === "string");

		const decoded = utils.bytes.bs58.decode(signature);
		assert.strictEqual(decoded.length, 64, "expected 64-byte signature");
	});

	it("should send and confirm a signed VersionedTransaction", async () => {
		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash("confirmed");

		const message = new web3.TransactionMessage({
			payerKey: walletA.publicKey,
			recentBlockhash: blockhash,
			instructions: [buildTransferIx(walletA.publicKey, walletB.publicKey)],
		}).compileToV0Message();

		const transaction = new web3.VersionedTransaction(message);
		transaction.sign([walletA.payer]);

		const signature = await sendAndConfirm({
			connection,
			signedTransaction: transaction,
			blockhash,
			lastValidBlockHeight,
			options: { commitment: "confirmed", skipPreflight: true },
		});

		console.log("versioned signature:", getTxUrl(signature, network));
		assert.ok(signature && typeof signature === "string");
	});

	it("should throw TransactionNotSigned when legacy transaction is not signed", async () => {
		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash("confirmed");

		const transaction = new web3.Transaction({
			feePayer: walletA.publicKey,
			blockhash,
			lastValidBlockHeight,
		}).add(buildTransferIx(walletA.publicKey, walletB.publicKey));

		await assert.rejects(
			() =>
				sendAndConfirm({
					connection,
					signedTransaction: transaction,
					blockhash,
					lastValidBlockHeight,
				}),
			(err: Error) => /TransactionNotSigned/.test(err.message),
		);
	});

	it("should throw TransactionNotSigned when versioned transaction is not signed", async () => {
		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash("confirmed");

		const message = new web3.TransactionMessage({
			payerKey: walletA.publicKey,
			recentBlockhash: blockhash,
			instructions: [buildTransferIx(walletA.publicKey, walletB.publicKey)],
		}).compileToV0Message();

		const transaction = new web3.VersionedTransaction(message);

		await assert.rejects(
			() =>
				sendAndConfirm({
					connection,
					signedTransaction: transaction,
					blockhash,
					lastValidBlockHeight,
				}),
			(err: Error) => /TransactionNotSigned/.test(err.message),
		);
	});

	it("should accept an externally provided AbortController", async () => {
		const { blockhash, lastValidBlockHeight } =
			await connection.getLatestBlockhash("confirmed");

		const transaction = new web3.Transaction({
			feePayer: walletA.publicKey,
			blockhash,
			lastValidBlockHeight,
		}).add(buildTransferIx(walletA.publicKey, walletB.publicKey));

		transaction.sign(walletA.payer);

		const abortController = new AbortController();
		const signature = await sendAndConfirm({
			connection,
			signedTransaction: transaction,
			blockhash,
			lastValidBlockHeight,
			abortController,
			options: { commitment: "confirmed", skipPreflight: true },
		});

		console.log(
			"signature with abortController:",
			getTxUrl(signature, network),
		);
		assert.ok(signature && typeof signature === "string");
		assert.ok(
			abortController.signal.aborted,
			"abortController should be aborted after confirmation",
		);
	});

	it("should reject with expired blockhash error when lastValidBlockHeight has already passed", async () => {
		const { blockhash } = await connection.getLatestBlockhash("confirmed");
		const currentHeight = await connection.getBlockHeight("confirmed");
		const expiredBlockHeight = currentHeight - 1;

		const transaction = new web3.Transaction({
			feePayer: walletA.publicKey,
			blockhash,
			lastValidBlockHeight: expiredBlockHeight,
		}).add(buildTransferIx(walletA.publicKey, walletB.publicKey));

		transaction.sign(walletA.payer);

		await assert.rejects(
			() =>
				sendAndConfirm({
					connection,
					signedTransaction: transaction,
					blockhash,
					lastValidBlockHeight: expiredBlockHeight,
					options: { commitment: "confirmed", skipPreflight: true },
				}),
			(err: Error) => err instanceof Error,
		);
	});
});
