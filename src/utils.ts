import { BigNumber } from "bignumber.js";

import { Address, translateAddress, translateError, web3 } from "@coral-xyz/anchor";

import { ASSOCIATED_TOKEN_PROGRAM_ID, TEN_BIGNUM, TOKEN_PROGRAM_ID } from "./constants";

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

/**
 * Utility function for delays
 */
export function sleep(durationInMs: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, durationInMs));
}

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
	commitmentOrConfig: web3.Commitment | web3.GetBalanceConfig = "finalized",
): Promise<FormattedBalance> {
	const balance = await connection.getBalance(translateAddress(address), commitmentOrConfig);

	return formatSol(balance);
}

export async function getTokenBalances(
	connection: web3.Connection,
	address: Address,
	tokenMints: Address[],
	allowOwnerOffCurve = false,
	config: web3.GetBalanceConfig = { commitment: "confirmed" },
): Promise<Record<PublicKeyString, FormattedBalance>> {
	const associatedTokenAccounts = tokenMints.map((mint) =>
		getAssociatedTokenAddressSync(
			translateAddress(mint),
			translateAddress(address),
			allowOwnerOffCurve,
		),
	);

	const accountsInfo = await connection.getMultipleParsedAccounts(associatedTokenAccounts, config);

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

export function parseSolanaSendTransactionError(error: unknown, idlErrors: Map<number, string>) {
	const translatedError = translateError(error, idlErrors);
	console.debug("Transaction execution error:", translatedError);

	// Enhanced insufficient balance detection
	const isInsufficientBalance =
		translatedError.message.includes(
			"Attempt to debit an account but found no record of a prior credit.",
		) ||
		translatedError.message.includes("custom program error: 0x1") ||
		translatedError.message.includes("insufficient funds");

	if (isInsufficientBalance) {
		return Error("An account does not have enough SOL for transaction");
	}

	return translatedError;
}

/**
 * Filters and sorts prioritization fees in ascending order
 * @param recentPrioritizationFees Recent fee data from Solana RPC
 * @returns Sorted array of non-zero fees
 */
export function replaceNonZeroAndSortPrioritizationFeesAsc(
	recentPrioritizationFees: web3.RecentPrioritizationFees[],
): web3.RecentPrioritizationFees[] {
	return recentPrioritizationFees
		.filter((fee) => !Number.isNaN(fee.prioritizationFee) && fee.prioritizationFee > 0)
		.sort((a, b) => {
			return BigNumber(a.prioritizationFee).comparedTo(b.prioritizationFee) ?? 0;
		});
}

/**
 * Priority fee calculation levels
 */
export type PriorityLevel = "low" | "medium" | "high";

/**
 * Calculates optimal priority fee based on recent network activity
 * @param connection Solana RPC connection
 * @param instructions Transaction instructions to analyze
 * @param priorityLevel Fee calculation strategy
 * @param maxFeeCap Maximum fee cap to prevent overpaying
 * @returns Calculated priority fee in micro-lamports
 */
export async function getRecentPriorityFee(
	connection: web3.Connection,
	instructions: web3.TransactionInstruction[],
	priorityLevel: PriorityLevel,
	maxFeeCap: BigNumber,
): Promise<BigNumber> {
	try {
		const lockedWritableAccounts = [
			...new Set(
				instructions.flatMap((ix) => [
					...ix.keys.filter((key) => key.isSigner || key.isWritable).map((key) => key.pubkey),
					ix.programId,
				]),
			),
		];

		const recentPrioritizationFees = await connection.getRecentPrioritizationFees({
			lockedWritableAccounts,
		});

		const sortedNonZeroList = replaceNonZeroAndSortPrioritizationFeesAsc(recentPrioritizationFees);

		let medianFee = BigNumber(0);

		if (sortedNonZeroList.length > 0) {
			const midIndex = Math.floor(sortedNonZeroList.length / 2);
			medianFee =
				sortedNonZeroList.length % 2 !== 0
					? BigNumber(sortedNonZeroList[midIndex]!.prioritizationFee).decimalPlaces(
							0,
							BigNumber.ROUND_DOWN,
						)
					: BigNumber(sortedNonZeroList[midIndex - 1]!.prioritizationFee)
							.plus(sortedNonZeroList[midIndex]!.prioritizationFee)
							.div(2)
							.decimalPlaces(0, BigNumber.ROUND_DOWN);
		}

		console.debug("Median fee for priority level %s: %s", priorityLevel, medianFee.toFixed());

		// Apply multiplier based on priority level
		const multipliers: Record<PriorityLevel, number> = {
			low: 0.8,
			medium: 1.2,
			high: 2.0,
		};

		const calculatedFee = medianFee
			.times(multipliers[priorityLevel])
			.decimalPlaces(0, BigNumber.ROUND_CEIL);

		console.debug("Calculated fee:", calculatedFee.toFixed());

		return BigNumber.min(calculatedFee, maxFeeCap);
	} catch (error) {
		console.warn("Failed to fetch recent priority fees, using fallback:", error);
		// Fallback to a reasonable default based on priority level
		const fallbackFees: Record<PriorityLevel, number> = {
			low: 1000,
			medium: 5000,
			high: 25000,
		};
		return BigNumber.min(fallbackFees[priorityLevel], maxFeeCap);
	}
}
