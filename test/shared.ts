import assert from "assert";
import dotenv from "dotenv";

import { utils, Wallet } from "@coral-xyz/anchor";
import { Cluster, Connection, Keypair } from "@solana/web3.js";

dotenv.config();

export function getConnection(
	cluster?: "mainnet-beta" | "devnet",
	commitment: "confirmed" | "finalized" = "finalized",
) {
	const network = cluster ? cluster : "mainnet-beta";
	const RPC_URL = network === "devnet" ? process.env.DEVNET_RPC_URL : process.env.RPC_URL;
	assert(
		RPC_URL && RPC_URL !== "",
		`missing env var: ${network === "devnet" ? "DEVNET_RPC_URL" : "RPC_URL"}`,
	);

	return new Connection(RPC_URL, commitment);
}

export function getWallets(cluster?: "mainnet-beta" | "devnet") {
	const SECRET_KEYS =
		cluster && cluster === "mainnet-beta"
			? process.env.MAINNET_SECRET_KEYS
			: process.env.DEVNET_SECRET_KEYS;

	assert(
		SECRET_KEYS && SECRET_KEYS != "",
		`missing env var: ${cluster === "mainnet-beta" ? "MAINNET_SECRET_KEYS" : "DEVNET_SECRET_KEYS"}`,
	);
	const keypairs: Keypair[] = [];
	try {
		const secretKeys = JSON.parse(SECRET_KEYS);

		assert(Array.isArray(secretKeys), "Invalid format for SECRET_KEYS");

		for (const keys of secretKeys) {
			// console.log("secret key", keys);
			assert(keys && typeof keys === "string" && keys != "", "Invalid secret key");

			const keypair = Keypair.fromSecretKey(utils.bytes.bs58.decode(keys));
			// console.log(Buffer.from(keypair.secretKey).toJSON());

			keypairs.push(keypair);
		}
	} catch (err: any) {
		throw new Error("Some error occured parsing secret key: " + err.message);
	}

	const wallets: Wallet[] = [];

	for (const keypair of keypairs) {
		wallets.push(new Wallet(keypair));
	}

	return wallets;
}

export function getTxUrl(tx: string, cluster: Cluster = "mainnet-beta") {
	if (!cluster || cluster === "mainnet-beta") {
		return "https://solscan.io/tx/" + tx;
	}

	return "https://solscan.io/tx/" + tx + "?cluster=" + cluster;
}

export async function getBlockTime(connection: Connection) {
	const time = await connection.getBlockTime(await connection.getSlot());
	return time!;
}
