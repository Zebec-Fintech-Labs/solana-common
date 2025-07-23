import { web3 } from "@coral-xyz/anchor";

import { TransactionPayload } from "../src";
import { getConnection } from "./shared";

const network = "devnet";
const connection = getConnection(network, "confirmed");

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
			[transferIxn],
			fromKeypair.publicKey,
			[],
			[],
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
});
