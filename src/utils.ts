import {
	type Address,
	AnchorError,
	ProgramError,
	translateAddress,
	translateError,
	utils,
	web3,
} from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";
import {
	ASSOCIATED_TOKEN_PROGRAM_ID,
	DEFAULT_SEND_TRANSACTION_INTERVAL,
	TEN_BIGNUM,
	TOKEN_PROGRAM_ID,
} from "./constants";

// Process-wide cache so repeated balance / amount lookups for the same mint
// don't issue a fresh `getTokenSupply` RPC every call. Mint decimals are
// immutable for SPL Token mints, so caching is safe for the lifetime of the
// process.
const mintToDecimalsMap = new Map<string, number>();

/**
 * Fetches the decimal precision for an SPL token mint.
 *
 * Results are memoized in `mintToDecimalsMap` — the first call hits the RPC,
 * subsequent calls for the same mint are O(1).
 *
 * @param connection Solana RPC connection used on cache miss.
 * @param mint       Token mint to look up.
 * @returns Decimal precision (e.g. 6 for USDC, 9 for SOL/WSOL).
 */
export async function getMintDecimals(
	connection: web3.Connection,
	mint: web3.PublicKey,
): Promise<number> {
	if (mintToDecimalsMap.has(mint.toString())) {
		// biome-ignore lint/style/noNonNullAssertion: there is a check for the presence of the key above
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
		{
			pubkey: web3.SystemProgram.programId,
			isSigner: false,
			isWritable: false,
		},
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
	return BigInt(
		BigNumber(amount)
			.times(TEN_BIGNUM.pow(decimals))
			.toFixed(0, BigNumber.ROUND_FLOOR),
	);
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

/**
 *
 * @param connection Solana Connection
 * @param address Wallet address
 * @param commitmentOrConfig Solana Commitment or GetBalanceConfig
 * @returns SOL Balance in ui amount
 */
export async function getSolBalance(
	connection: web3.Connection,
	address: Address,
	commitmentOrConfig: web3.Commitment | web3.GetBalanceConfig = "finalized",
): Promise<FormattedBalance> {
	const balance = await connection.getBalance(
		translateAddress(address),
		commitmentOrConfig,
	);

	return formatSol(balance);
}

/**
 *
 * @param connection Solana connection
 * @param address Wallet address
 * @param tokenMints Array of token mints
 * @param allowOwnerOffCurve boolean value whether to allow off curve wallet address
 * @param config Solana GetBalanceConfig
 * @returns Records of token mint key and ui token amount value
 */
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

	const accountsInfo = await connection.getMultipleParsedAccounts(
		associatedTokenAccounts,
		config,
	);

	const balances: Record<string, FormattedBalance> = {};
	accountsInfo.value.forEach((accountInfo, i) => {
		if (!accountInfo) {
			// biome-ignore lint/style/noNonNullAssertion: foreach tokenmint a accountinfo exists
			balances[tokenMints[i]!.toString()] = "0";
		} else {
			if (Buffer.isBuffer(accountInfo.data)) {
				throw new Error(
					"Account did not parsed. Account may not Associated Token Account.",
				);
			} else {
				// biome-ignore lint/style/noNonNullAssertion: foreach tokenmint a accountinfo exists
				balances[tokenMints[i]!.toString()] = formatToken(
					accountInfo.data.parsed.info.tokenAmount.amount,
					accountInfo.data.parsed.info.tokenAmount.decimals,
				);
			}
		}
	});

	return balances;
}

/**
 * Normalizes any error thrown while sending or confirming a Solana transaction
 * into a single `Error` with a human-readable message.
 *
 * Resolution order (first match wins):
 *   1. Known Jupiter aggregator program errors → friendly message.
 *   2. Insufficient-SOL detection → friendly message.
 *   3. Anchor `AnchorError` → formatted program + error-code + origin.
 *   4. Anchor `ProgramError`  → formatted program + code + msg.
 *   5. Fallback: the `transactionMessage` field if present, else the
 *      translated error as-is.
 *
 * The earlier checks are intentionally before Anchor's class-based ones
 * because Jupiter / insufficient-funds errors arrive as plain `Error`s with
 * meaningful substrings, and surfacing those is more actionable than the raw
 * "custom program error: 0x…" string.
 *
 * @param error     Raw error from `sendRawTransaction` / `confirmTransaction`.
 * @param idlErrors Map of program error codes → messages from a program's
 *                  IDL, forwarded to Anchor's `translateError`.
 * @returns A single `Error` ready to be thrown to callers.
 */
export function parseSolanaSendTransactionError(
	error: unknown,
	idlErrors: Map<number, string>,
) {
	console.debug("Raw error from transaction execution:", error);
	const translatedError = translateError(error, idlErrors);
	console.debug("Translated error:", translatedError);

	const jupError = parseJupErrors(translatedError);

	if (jupError) {
		return jupError;
	}

	const insufficientFundsError =
		parseInsufficientFundsErrorMessage(translatedError);

	if (insufficientFundsError) {
		return insufficientFundsError;
	}

	if (translatedError instanceof AnchorError) {
		return parseAnchorError(translatedError);
	} else if (translatedError instanceof ProgramError) {
		return parseProgramError(translatedError);
	} else {
		// `SendTransactionError` carries a richer `transactionMessage` than its
		// default `.message`; prefer it when available.
		return "transactionMessage" in translatedError
			? new Error(translatedError.transactionMessage)
			: translatedError;
	}
}

function parseProgramError(translatedError: ProgramError) {
	return new Error(
		`Program ` +
			`${translatedError.program ? `${translatedError.program.toString()} ` : ""}` +
			`failed: Code: ${translatedError.code} Message: ${translatedError.msg}`,
	);
}

function parseAnchorError(translatedError: AnchorError) {
	return new Error(
		`Program: ${translatedError.program.toString()} failed. Code: ${translatedError.error.errorCode.code} Number: ${translatedError.error.errorCode.number} Message: ${translatedError.error.errorMessage}` +
			`${translatedError.error.origin ? ` Origin: ${typeof translatedError.error.origin === "string" ? translatedError.error.origin : `${translatedError.error.origin.file}:${translatedError.error.origin.line}`}` : ""}` +
			`${translatedError.error.comparedValues ? ` Compared Values: Left ${translatedError.error.comparedValues[0]?.toString()} Right ${translatedError.error.comparedValues[1]?.toString()}` : ""}`,
	);
}

/**
 * Recognises common error codes thrown by Jupiter's aggregator program
 * (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`) and rewrites them into a
 * descriptive `Error`. Returns `null` when the error doesn't match a known
 * Jupiter failure mode, letting the caller fall through to other parsers.
 *
 * Codes recognised: 0x1771 (slippage), 0x1778 (not enough account keys),
 * 0x1781 (exact-out mismatch), 0x1788 (insufficient funds for swap/fees/rent),
 * 0x1789 (invalid / uninitialized token account).
 */
function parseJupErrors(translatedError: unknown) {
	if (
		!translatedError ||
		typeof translatedError !== "object" ||
		!("message" in translatedError) ||
		!translatedError.message ||
		typeof translatedError.message !== "string"
	) {
		return null;
	}

	const isJupSippageExceededError = translatedError.message.includes(
		"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1771",
	);

	if (isJupSippageExceededError) {
		return Error(
			"Jupiter aggregation error: transaction failed during token swap due to slippage exceed",
		);
	}

	const isJupNotEnoughAccountKeysError = translatedError.message.includes(
		"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1778",
	);

	if (isJupNotEnoughAccountKeysError) {
		return Error(
			"Jupiter aggregation error: transaction failed during swap due to insufficient account keys provided",
		);
	}

	const isJupExactOutAmountNotMatchedError = translatedError.message.includes(
		"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1781",
	);

	if (isJupExactOutAmountNotMatchedError) {
		return Error(
			"Jupiter aggregation error: transaction failed during swap as the exact output amount could not be matched",
		);
	}

	const isJupInsuficientFundsError = translatedError.message.includes(
		"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1788",
	);

	if (isJupInsuficientFundsError) {
		return Error(
			"Jupiter aggregation error: transaction failed during swap due to insufficient funds for either swap amount, transaction fees or rent fees",
		);
	}

	const isJupInvalidTokenAccountError = translatedError.message.includes(
		"Program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4 failed: custom program error: 0x1789",
	);

	if (isJupInvalidTokenAccountError) {
		return Error(
			"Jupiter aggregation error: transaction failed during swap due to invalid or uninitialized token account",
		);
	}

	return null;
}

/**
 * Detects the multiple wire-level shapes Solana can use to report an
 * insufficient-balance failure and collapses them into a single friendly
 * error. The detection looks for any of:
 *   - "Attempt to debit an account but found no record of a prior credit."
 *     (preflight before the account has ever received SOL)
 *   - "custom program error: 0x1" (System Program's NotEnoughAccountKeys /
 *     ResultWithNegativeLamports)
 *   - "insufficient funds" (RPC-level free-form message)
 *
 * @returns A normalized `Error` on match, `null` otherwise.
 */
function parseInsufficientFundsErrorMessage(
	translatedError: unknown,
): Error | null {
	if (
		!translatedError ||
		typeof translatedError !== "object" ||
		!("message" in translatedError) ||
		!translatedError.message ||
		typeof translatedError.message !== "string"
	) {
		return null;
	}

	const isInsufficientBalance =
		translatedError.message.includes(
			"Attempt to debit an account but found no record of a prior credit.",
		) ||
		translatedError.message.includes("custom program error: 0x1\n") ||
		translatedError.message.includes("insufficient funds");

	if (isInsufficientBalance) {
		return Error("An account does not have enough SOL for transaction");
	}

	return null;
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
		.filter(
			(fee) =>
				!Number.isNaN(fee.prioritizationFee) && fee.prioritizationFee > 0,
		)
		.sort((a, b) => {
			return (
				BigNumber(a.prioritizationFee).comparedTo(b.prioritizationFee) ?? 0
			);
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
					...ix.keys.map((key) => key.pubkey),
					ix.programId,
				]),
			),
		];

		const recentPrioritizationFees =
			await connection.getRecentPrioritizationFees({
				lockedWritableAccounts,
			});

		const sortedNonZeroList = replaceNonZeroAndSortPrioritizationFeesAsc(
			recentPrioritizationFees,
		);
		// console.debug("recent Priority fees:", sortedNonZeroList);

		let medianFee = BigNumber(0);

		if (sortedNonZeroList.length > 0) {
			const midIndex = Math.floor(sortedNonZeroList.length / 2);
			medianFee =
				sortedNonZeroList.length % 2 !== 0
					? BigNumber(
							// biome-ignore lint/style/noNonNullAssertion: mid index is calculated based on length
							sortedNonZeroList[midIndex]!.prioritizationFee,
						).decimalPlaces(0, BigNumber.ROUND_FLOOR)
					: // biome-ignore lint/style/noNonNullAssertion: mid index is calculated based on length
						BigNumber(sortedNonZeroList[midIndex - 1]!.prioritizationFee)
							// biome-ignore lint/style/noNonNullAssertion: mid index is calculated based on length
							.plus(sortedNonZeroList[midIndex]!.prioritizationFee)
							.div(2)
							.decimalPlaces(0, BigNumber.ROUND_FLOOR);
		}

		// console.debug(
		// 	"Median fee for priority level %s: %s",
		// 	priorityLevel,
		// 	medianFee.toFixed(),
		// );

		// Apply multiplier based on priority level
		const multipliers: Record<PriorityLevel, number> = {
			low: 0.8,
			medium: 1.2,
			high: 2.0,
		};

		const calculatedFee = medianFee
			.times(multipliers[priorityLevel])
			.decimalPlaces(0, BigNumber.ROUND_CEIL);

		// console.debug("Calculated fee:", calculatedFee.toFixed());

		return BigNumber.min(calculatedFee, maxFeeCap);
	} catch (error) {
		console.warn(
			"Failed to fetch recent priority fees, using fallback:",
			error,
		);
		// Fallback to a reasonable default based on priority level
		const fallbackFees: Record<PriorityLevel, number> = {
			low: 1000,
			medium: 5000,
			high: 25000,
		};
		return BigNumber.min(fallbackFees[priorityLevel], maxFeeCap);
	}
}

/**
 * Transaction execution options
 */
export type TransactionExecutionOptions = web3.ConfirmOptions & {
	enablePriorityFee?: boolean;
	sendTransactionInterval?: number;
	maxSendTransactionRetries?: number;
	priorityLevel?: PriorityLevel;
	maxPriorityFeeSol?: number;
	exactPriorityFeeSol?: number;
	confirmationTimeout?: number;
};

/**
 * Repeatedly broadcasts a signed transaction to the cluster until any of:
 *   - the cluster's current block height passes `lastValidBlockHeight`
 *     (blockhash has expired — caller must rebuild & resign),
 *   - `maxSendTransactionRetries` is reached,
 *   - the shared `abortSignal` fires (typically because confirmation
 *     succeeded or failed),
 *   - the RPC reports the transaction has already been processed
 *     (treated as success — confirmation will pick it up).
 *
 * "Blockhash not found" errors are treated as transient and retried, since
 * leaders sometimes lag behind the blockhash that was just fetched.
 *
 * This is the "send" half of {@link sendAndConfirm}; pair it with
 * {@link confirmTransactionWithTimeout} via a shared `AbortController` so
 * either side can stop the other once a terminal state is reached.
 *
 * @param connection           Solana RPC connection.
 * @param signedTransaction    Fully signed legacy or versioned transaction.
 * @param signature            bs58-encoded signature, used only for logging.
 * @param lastValidBlockHeight Upper-bound block height the signed blockhash
 *                             is valid for. Past this, the transaction is
 *                             guaranteed to be dropped.
 * @param abortSignal          Cooperative cancellation signal from the
 *                             confirmation half.
 * @param options              Retry tuning + standard `ConfirmOptions`.
 * @throws `Error("Block height exceeded before confirmation")` when the
 *         loop terminates because the blockhash expired.
 */
export async function sendTransactionWithRetry(
	connection: web3.Connection,
	signedTransaction: web3.VersionedTransaction | web3.Transaction,
	signature: string,
	lastValidBlockHeight: number,
	abortSignal: AbortSignal,
	options?: TransactionExecutionOptions,
): Promise<void> {
	const sendTransactionInterval =
		options?.sendTransactionInterval ?? DEFAULT_SEND_TRANSACTION_INTERVAL;
	const maxRetries =
		options?.maxSendTransactionRetries ?? Number.MAX_SAFE_INTEGER;

	let retry = 0;
	let blockHeight = await connection.getBlockHeight(options);
	const serializedTransaction = signedTransaction.serialize();

	while (
		blockHeight < lastValidBlockHeight &&
		retry < maxRetries &&
		!abortSignal.aborted
	) {
		try {
			console.debug("Send... Attempt #%d", retry + 1);
			await connection.sendRawTransaction(serializedTransaction, {
				...options,
				skipPreflight: options?.skipPreflight ?? false,
			});

			console.debug("Signature sent: %s at %o", signature, new Date());
			retry++;
			await sleep(sendTransactionInterval);
			blockHeight = await connection.getBlockHeight(options);
		} catch (err) {
			if (err instanceof Error) {
				if (
					err.message?.includes("This transaction has already been processed")
				) {
					console.debug(
						"Transaction already processed. Exiting send retry loop.",
					);
					return;
				}

				if (err.message?.includes("Blockhash not found")) {
					console.debug("Expected error (will retry):", err.message);
					retry++;
					await sleep(sendTransactionInterval);
					blockHeight = await connection.getBlockHeight(options);
					continue;
				}
			}

			throw err;
		}
	}

	if (blockHeight >= lastValidBlockHeight) {
		throw new Error("Block height exceeded before confirmation");
	}
}

/**
 * Awaits cluster confirmation for a transaction. Once confirmation resolves
 * (either as success or failure), this aborts the shared `AbortController`
 * so the paired sender loop can stop retrying.
 *
 * Confirmation itself is bounded by blockhash expiry — `confirmTransaction`
 * resolves with `value.err === null` on success, with a non-null `err` if
 * the transaction landed but failed, and rejects if the blockhash expires
 * before the transaction is observed.
 *
 * @param connection           Solana RPC connection.
 * @param signature            bs58-encoded signature to wait on.
 * @param blockhash            Blockhash used to sign the transaction.
 * @param lastValidBlockHeight Same value used in sending; bounds the wait.
 * @param abortController      Shared controller — aborted on completion so
 *                             the sender loop exits.
 * @param options              Forwarded for `commitment`.
 * @throws When the cluster reports a transaction-level error
 *         (`response.value.err !== null`).
 */
export async function confirmTransactionWithTimeout(
	connection: web3.Connection,
	signature: string,
	blockhash: string,
	lastValidBlockHeight: number,
	abortController: AbortController,
	options?: TransactionExecutionOptions,
): Promise<void> {
	const startTime = Date.now();

	const response = await connection.confirmTransaction(
		{
			signature,
			blockhash,
			lastValidBlockHeight,
		},
		options?.commitment,
	);

	if (response.value.err) {
		const errorMsg =
			typeof response.value.err === "string"
				? response.value.err
				: JSON.stringify(response.value.err, null, 2);
		abortController.abort();
		throw new Error(`Failed to confirm transaction: ${errorMsg}`);
	}

	const endTime = Date.now();
	console.debug("Confirmed at: %o", new Date(endTime));
	console.debug("Time elapsed: %d ms", endTime - startTime);
	abortController.abort();
}

/**
 * Parameters for {@link sendAndConfirm}.
 */
export interface SendAndConfirmParams {
	/** Solana RPC connection used for both sending and confirming. */
	connection: web3.Connection;
	/**
	 * Already-signed transaction. Must carry at least one non-zero signature;
	 * otherwise {@link sendAndConfirm} throws `TransactionNotSigned`.
	 */
	signedTransaction: web3.Transaction | web3.VersionedTransaction;
	/** Blockhash used to sign the transaction. */
	blockhash: string;
	/** Block height after which the blockhash is no longer valid. */
	lastValidBlockHeight: number;
	/** Retry / commitment / priority-fee tuning. */
	options?: TransactionExecutionOptions;
	/**
	 * Optional caller-supplied controller — useful when an outer flow needs
	 * to cancel send+confirm together (e.g. an orchestrator timing out). If
	 * omitted, a fresh controller is created internally.
	 */
	abortController?: AbortController;
}

/**
 * Sends a signed transaction and waits for confirmation, coordinating the
 * sender retry loop and the confirmation listener through a shared
 * `AbortController` so whichever side finishes first stops the other.
 *
 * Flow:
 *   1. Extract the first signature from the transaction (fail fast if
 *      missing — `addSignature` must have been called before getting here).
 *   2. Launch `sendTransactionWithRetry` and `confirmTransactionWithTimeout`
 *      in parallel via `Promise.all`. Both observe the same abort signal.
 *   3. Either branch's rejection aborts the controller and propagates out.
 *
 * @returns The bs58-encoded transaction signature on confirmation.
 * @throws `TransactionNotSigned` when no usable signature is present.
 * @throws Any error surfaced by the send loop or confirmation listener.
 */
export async function sendAndConfirm({
	blockhash,
	connection,
	lastValidBlockHeight,
	signedTransaction,
	abortController,
	options,
}: SendAndConfirmParams): Promise<string> {
	const signatureBuffer =
		signedTransaction instanceof web3.VersionedTransaction
			? signedTransaction.signatures[0]
			: signedTransaction.signature;
	if (!signatureBuffer || signatureBuffer.every((byte) => byte === 0)) {
		throw new Error("TransactionNotSigned: Signature is empty in transaction");
	}
	const signature = utils.bytes.bs58.encode(signatureBuffer);

	abortController = abortController ?? new AbortController();

	try {
		await Promise.all([
			sendTransactionWithRetry(
				connection,
				signedTransaction,
				signature,
				lastValidBlockHeight,
				abortController.signal,
				options,
			),
			confirmTransactionWithTimeout(
				connection,
				signature,
				blockhash,
				lastValidBlockHeight,
				abortController,
				options,
			).catch((err) => {
				abortController.abort();
				throw err;
			}),
		]);
	} catch (err) {
		abortController.abort();
		throw err;
	}
	return signature;
}
