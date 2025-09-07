import { web3 } from "@coral-xyz/anchor";

import { TransactionPayload } from "../src";
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
			lamports: 1 * web3.LAMPORTS_PER_SOL,
		});
		const payload = new TransactionPayload(
			connection,
			new Map(),
			{
				instructions: [transferIxn],
				feePayer: fromKeypair.publicKey,
				signers: [],
				addressLookupTableAccounts: [],
			},
			async (transaction) => {
				if (transaction instanceof web3.Transaction) {
					transaction.sign(fromKeypair);
				} else {
					transaction.sign([fromKeypair]);
				}

				return transaction;
			},
		);

		const signature = await payload.execute({ commitment: "confirmed" });
	});

	it.only("should make transaction without priority fee", async () => {
		const transferIxn = web3.SystemProgram.transfer({
			fromPubkey: walletA.publicKey,
			toPubkey: walletB.publicKey,
			lamports: 1 * web3.LAMPORTS_PER_SOL,
		});
		const payload = new TransactionPayload(
			connection,
			new Map(),
			{
				instructions: [transferIxn],
				feePayer: walletA.publicKey,
				signers: [],
				addressLookupTableAccounts: [],
			},
			async (transaction) => {
				if (transaction instanceof web3.Transaction) {
					transaction.sign(walletA.payer);
				} else {
					transaction.sign([walletA.payer]);
				}

				return transaction;
			},
		);

		const signature = await payload.execute({ commitment: "confirmed" });
		console.log("signature:", signature);
	});
});
