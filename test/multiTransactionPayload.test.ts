import { utils, web3 } from "@coral-xyz/anchor";

import { MultiTransactionPayload } from "../src";
import { getConnection, getWallets } from "./shared";

const network = "devnet";
const connection = getConnection(network, "confirmed");
const wallets = getWallets(network);
const walletA = wallets[0];
const walletB = wallets[1];

describe("TransactionPayload", () => {
	it("should return 0x1 error upon 0 SOL balance", async () => {
		const fromKeypair = web3.Keypair.generate();
		const toKeypair = web3.Keypair.generate();

		const transferIxn = web3.SystemProgram.transfer({
			fromPubkey: fromKeypair.publicKey,
			toPubkey: toKeypair.publicKey,
			lamports: 0.05 * web3.LAMPORTS_PER_SOL,
		});
		const payload = new MultiTransactionPayload(
			connection,
			new Map(),
			[
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
				{
					instructions: [transferIxn],
					feePayer: fromKeypair.publicKey,
				},
			],
			async (transactions) => {
				return transactions.map((transaction) => {
					if (transaction instanceof web3.Transaction) {
						transaction.sign(fromKeypair);
					} else {
						transaction.sign([fromKeypair]);
					}
					return transaction;
				});
			},
		);

		const result = await payload.execute({ commitment: "confirmed" });
		console.log("Result:", result);
	});

	it.only("should execute transaction", async () => {
		const transactionData = Array.from({ length: 3 }).map((_) => {
			return {
				instructions: [
					web3.SystemProgram.transfer({
						fromPubkey: walletA.publicKey,
						toPubkey: walletB.publicKey,
						lamports: Math.floor(Math.random() * web3.LAMPORTS_PER_SOL),
					}),
				],
				feePayer: walletA.publicKey,
				signers: [],
				addressLookupTableAccounts: [],
			};
		});
		const payload = new MultiTransactionPayload(
			connection,
			new Map(),
			transactionData,
			async (transactions) => {
				return transactions.map((transaction) => {
					if (transaction instanceof web3.Transaction) {
						transaction.sign(walletA.payer);
					} else {
						transaction.sign([walletA.payer]);
					}

					return transaction;
				});
			},
		);

		const results = await payload.execute({ commitment: "confirmed" });
		console.log(
			"results:",
			JSON.stringify(
				results.map((result) => {
					return {
						...result,
						transaction: {
							...result.transaction,
							signatures: result.transaction.signatures.map((s) => utils.bytes.bs58.encode(s)),
						},
					};
				}),
				null,
				2,
			),
		);
	});
});
