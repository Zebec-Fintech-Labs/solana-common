import { BigNumber } from "bignumber.js";

import { Address, translateAddress, utils, web3 } from "@coral-xyz/anchor";

const mintToDecimalsMap = new Map<string, number>();

/**
 * Gets decimals for given mint
 * @param connection
 * @param mint
 * @returns
 */
export async function getMintDecimals(
	connection: web3.Connection,
	mint: web3.PublicKey,
): Promise<number> {
	if (mintToDecimalsMap.has(mint.toString())) {
		return mintToDecimalsMap.get(mint.toString())!;
	} else {
		const info = await connection.getTokenSupply(mint);
		mintToDecimalsMap.set(mint.toString(), info.value.decimals);
		return info.value.decimals;
	}
}

/** USDC Decimals = 6 */
export const USDC_DECIMALS = 6;

export const SOL_DECIMALS = 9;

/**
 * WSOL Mint Address
 */
export const WSOL = new web3.PublicKey("So11111111111111111111111111111111111111112");

export const ZBCN = new web3.PublicKey("ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU");

/** BigNumber Object for 10 */
export const TEN_BIGNUM = BigNumber(10);

export const UNITS_PER_USDC = TEN_BIGNUM.pow(USDC_DECIMALS);

/** Token Program ID */
export const TOKEN_PROGRAM_ID = utils.token.TOKEN_PROGRAM_ID;

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = utils.token.ASSOCIATED_PROGRAM_ID;

/** Memo Program ID */
export const MEMO_PROGRAM_ID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/**
 * Construct a CreateAssociatedTokenAccount instruction
 *
 * @param payer                    Payer of the initialization fees
 * @param associatedToken          New associated token account
 * @param owner                    Owner of the new account
 * @param mint                     Token mint account
 * @param programId                SPL Token program account
 * @param associatedTokenProgramId SPL Associated Token program account
 *
 * @return Instruction to add to a transaction
 */
export function createAssociatedTokenAccountInstruction(
	payer: web3.PublicKey,
	associatedToken: web3.PublicKey,
	owner: web3.PublicKey,
	mint: web3.PublicKey,
	programId = TOKEN_PROGRAM_ID,
	associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): web3.TransactionInstruction {
	const keys = [
		{ pubkey: payer, isSigner: true, isWritable: true },
		{ pubkey: associatedToken, isSigner: false, isWritable: true },
		{ pubkey: owner, isSigner: false, isWritable: false },
		{ pubkey: mint, isSigner: false, isWritable: false },
		{ pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
		{ pubkey: programId, isSigner: false, isWritable: false },
	];

	return new web3.TransactionInstruction({
		keys,
		programId: associatedTokenProgramId,
		data: Buffer.alloc(0),
	});
}

/**
 * Get the address of the associated token account for a given mint and owner
 *
 * @param mint                     Token mint account
 * @param owner                    Owner of the new account
 * @param allowOwnerOffCurve       Allow the owner account to be a PDA (Program Derived Address)
 * @param programId                SPL Token program account
 * @param associatedTokenProgramId SPL Associated Token program account
 *
 * @return Address of the associated token account
 */
export function getAssociatedTokenAddressSync(
	mint: web3.PublicKey,
	owner: web3.PublicKey,
	allowOwnerOffCurve = false,
	programId = TOKEN_PROGRAM_ID,
	associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID,
): web3.PublicKey {
	if (!allowOwnerOffCurve && !web3.PublicKey.isOnCurve(owner.toBuffer()))
		throw new Error("Token owner is off curve.");

	const [address] = web3.PublicKey.findProgramAddressSync(
		[owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
		associatedTokenProgramId,
	);

	return address;
}

/**
 * Converts a given amount in SOL to lamports (the smallest unit of SOL)
 * @param amount Amount in SOL to be converted
 * @returns
 */
export function parseSol(amount: BigNumber.Value): bigint {
	return BigInt(BigNumber(amount).times(web3.LAMPORTS_PER_SOL).toFixed(0));
}

/**
 * Converts a given amount in lamports to SOL
 * @param amount Amount in lamports to be converted
 * @returns
 */
export function formatSol(amount: BigNumber.Value): string {
	return BigNumber(amount).dividedBy(web3.LAMPORTS_PER_SOL).toFixed();
}

/**
 * Converts a given token amount in decimals to the smallest unit of that token
 * @param amount Amount of token in decimals (e.g., 1876.190996)
 * @param decimals decimals of the token (e.g., 6 for USDC)
 * @returns
 */
export function parseToken(amount: BigNumber.Value, decimals: number): bigint {
	return BigInt(BigNumber(amount).times(TEN_BIGNUM.pow(decimals)).toFixed(0));
}

/**
 * Converts a given token amount in smallest unit to a human-readable format with decimals
 * @param amount Amount of token in smallest unit without decimals (e.g., 1876190996)
 * @param decimals Decimals of the token (e.g., 6 for USDC)
 * @returns
 */
export function formatToken(amount: BigNumber.Value, decimals: number): string {
	return BigNumber(amount).dividedBy(TEN_BIGNUM.pow(decimals)).toFixed();
}

export type FormattedBalance = string;
export type PublicKeyString = string;

export async function getSolBalance(
	connection: web3.Connection,
	address: Address,
): Promise<FormattedBalance> {
	const balance = await connection.getBalance(translateAddress(address), "finalized");

	return formatSol(balance);
}

export async function getTokenBalances(
	connection: web3.Connection,
	address: Address,
	tokenMints: Address[],
	allowOwnerOffCurve = false,
): Promise<Record<PublicKeyString, FormattedBalance>> {
	const associatedTokenAccounts = tokenMints.map((mint) =>
		getAssociatedTokenAddressSync(
			translateAddress(mint),
			translateAddress(address),
			allowOwnerOffCurve,
		),
	);

	const accountsInfo = await connection.getMultipleParsedAccounts(associatedTokenAccounts, {
		commitment: "finalized",
	});

	let balances: Record<string, FormattedBalance> = {};
	accountsInfo.value.map((accountInfo, i) => {
		if (!accountInfo) {
			balances[tokenMints[i]!.toString()] = "0";
		} else {
			if (Buffer.isBuffer(accountInfo.data)) {
				throw new Error("Account did not parsed. Account may not Associated Token Account.");
			} else {
				balances[tokenMints[i]!.toString()] = formatToken(
					accountInfo.data.parsed.info.tokenAmount.amount,
					accountInfo.data.parsed.info.tokenAmount.decimals,
				);
			}
		}
	});

	return balances;
}
