import assert from "assert";
import { describe } from "mocha";

import { web3 } from "@coral-xyz/anchor";

import { getSolBalance } from "../src";

describe("getSolBalance()", () => {
	it("should fetch sol balance", async () => {
		const connection = new web3.Connection(web3.clusterApiUrl("devnet"));

		const balanceA = await getSolBalance(
			connection,
			"2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4",
		);

		assert(balanceA);
		assert.strictEqual(balanceA, "4.946163556");

		const balanceB = await getSolBalance(connection, "KjC2CMdFWrqULujEECU4W2fQhdZ36vXn3XA8u8DpHqD");

		assert(balanceB);
		assert.strictEqual(balanceB, "0");
	});
});
