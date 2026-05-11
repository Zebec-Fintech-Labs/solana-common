import assert from "node:assert";
import { web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import { getMintDecimals, SOL_DECIMALS, USDC_DECIMALS, WSOL } from "../src";

describe("getMintDecimals", () => {
	const connection = new web3.Connection(web3.clusterApiUrl("mainnet-beta"));

	it("should return 9 decimals for WSOL", async () => {
		const decimals = await getMintDecimals(connection, WSOL);
		assert.strictEqual(decimals, SOL_DECIMALS);
	});

	it("should return 6 decimals for USDC", async () => {
		// USDC mint on mainnet-beta
		const usdc = new web3.PublicKey(
			"EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
		);
		const decimals = await getMintDecimals(connection, usdc);
		assert.strictEqual(decimals, USDC_DECIMALS);
	});

	it("should serve subsequent lookups from cache without hitting the RPC", async () => {
		// Patch the connection to detect a second `getTokenSupply` call. We
		// reassign the instance method (not the prototype) so other tests
		// using fresh Connections are unaffected.
		const patchedConnection = new web3.Connection(
			web3.clusterApiUrl("mainnet-beta"),
		);
		let calls = 0;
		const original = patchedConnection.getTokenSupply.bind(patchedConnection);
		// biome-ignore lint/suspicious/noExplicitAny: patching for test instrumentation
		(patchedConnection as any).getTokenSupply = async (...args: any[]) => {
			calls++;
			// biome-ignore lint/suspicious/noExplicitAny: forwarding through bound original
			return (original as any)(...args);
		};

		// Use a mint we haven't queried in any earlier test in this describe block
		// (USDT mainnet) to ensure first call is uncached.
		const usdt = new web3.PublicKey(
			"Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
		);

		await getMintDecimals(patchedConnection, usdt);
		await getMintDecimals(patchedConnection, usdt);
		await getMintDecimals(patchedConnection, usdt);

		assert.strictEqual(calls, 1, "should only call RPC once for the same mint");
	});
});
