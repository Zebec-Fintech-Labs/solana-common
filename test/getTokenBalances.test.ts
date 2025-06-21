import assert from "assert";
import { describe } from "mocha";

import { web3 } from "@coral-xyz/anchor";

import { getTokenBalances } from "../src";

describe("getTokenBalances()", () => {
	it("should fetch token balance", async () => {
		const connection = new web3.Connection(web3.clusterApiUrl("devnet"));
		const address = "2amZiVsTuVuJfG3PwKkPwVBNWHsfRoLxEW2wkadPT6D4";
		// "CxGWhBSj833PkjiJWhp3LiGMdQsqURkvCfigQ5Q4YNSK";
		const tokenMints = [
			"5qEhjfVc5C6bz1Vi7Uj5SiSeDvqsMtZwuVS9njoVPcRr",
			"De31sBPcDejCVpZZh1fq8SNs7AcuWcBKuU3k2jqnkmKc",
			"8CSvK7xceqUeqRaPr91r5kgteXGcWmBL48aoUQCtdizq",
		];

		const balances = await getTokenBalances(connection, address, tokenMints, true);
		console.log("balancees", balances);

		assert.strictEqual(balances["5qEhjfVc5C6bz1Vi7Uj5SiSeDvqsMtZwuVS9njoVPcRr"], "0");
		assert.strictEqual(balances["De31sBPcDejCVpZZh1fq8SNs7AcuWcBKuU3k2jqnkmKc"], "10328.73275");
		assert.strictEqual(balances["8CSvK7xceqUeqRaPr91r5kgteXGcWmBL48aoUQCtdizq"], "0");
		assert(!balances["CxGWhBSj833PkjiJWhp3LiGMdQsqURkvCfigQ5Q4YNSK"]);
	});
});
