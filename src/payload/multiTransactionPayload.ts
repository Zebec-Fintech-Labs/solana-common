import { translateError, web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";

import {
	BASE_FEE_LAMPORTS,
	COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT,
	DEFAULT_MAX_PRIORITY_FEE,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
import { MultiTransactionSimulationError } from "../error";
import {
	getRecentPriorityFee,
	type PriorityLevel,
	parseSolanaSendTransactionError,
	sendAndConfirm,
	type TransactionExecutionOptions,
} from "../utils";

/**
 * Async callback that receives the full batch of built transactions, signs
 * them all (typically via a single wallet prompt), and returns the signed
 * batch in the same order.
 *
 * Returning the array in the original order is required — downstream code
 * pairs the result with `transactionsData[i]` by index.
 */
export type SignAllTransactionsFunction = <
	T extends web3.Transaction | web3.VersionedTransaction,
>(
	transactions: T[],
) => Promise<T[]>;

/**
 * Return shape of {@link MultiTransactionPayload.execute}.
 *
 * One entry per input transaction, preserving order, combining:
 *   - the standard `PromiseSettledResult<string>` (signature on success,
 *     reason on failure — failures do **not** abort siblings),
 *   - `transactionData`: a reference back to the input that produced this
 *     result, useful for retrying just the failures,
 *   - `transaction`: the built+signed `VersionedTransaction`, in case the
 *     caller wants to re-broadcast it or inspect the wire payload.
 */
export type MultiTransactionPayloadExecuteReturn =
	(PromiseSettledResult<string> & {
		transactionData: {
			readonly instructions: web3.TransactionInstruction[];
			readonly feePayer: web3.PublicKey;
			readonly signers?: web3.Signer[];
			readonly addressLookupTableAccounts?: web3.AddressLookupTableAccount[];
		};
		transaction: web3.VersionedTransaction;
	})[];

/**
 * Builder for sending a batch of independent Solana transactions in one
 * call. Unlike {@link TransactionPayload}, failures are surfaced
 * per-transaction via `Promise.allSettled` semantics — one bad transaction
 * doesn't block the others from being sent or confirmed.
 */
export class MultiTransactionPayload {
	private static readonly ERROR_MESSAGES = {
		SIGN_FUNCTION_REQUIRED:
			"signTransaction is required to execute transaction payload.",
		BLOCK_HEIGHT_EXCEEDED: "Block height exceeded before confirmation",
		CONFIRMATION_TIMEOUT: "Transaction confirmation timed out",
	} as const;

	/**
	 * @param _connection           Solana RPC connection shared across all
	 *                              transactions in the batch.
	 * @param _errors               Program error code → message map from the
	 *                              IDL (forwarded to error translation).
	 * @param transactionsData      Ordered batch of transaction descriptors.
	 *                              At least one is required; each entry must
	 *                              have non-empty `instructions` and a
	 *                              `feePayer`. Validated eagerly in the
	 *                              constructor — see
	 *                              {@link validateTransactionData}.
	 * @param _signAllTransactions  Bulk-signing callback. Required by
	 *                              {@link execute}; for `simulate` it's only
	 *                              required when `sigVerify: true`.
	 */
	constructor(
		private readonly _connection: web3.Connection,
		private readonly _errors: Map<number, string>,
		readonly transactionsData: {
			readonly instructions: web3.TransactionInstruction[];
			readonly feePayer: web3.PublicKey;
			readonly signers?: web3.Signer[];
			readonly addressLookupTableAccounts?: web3.AddressLookupTableAccount[];
		}[],
		private readonly _signAllTransactions?: SignAllTransactionsFunction,
	) {
		this.validateTransactionData();
	}

	/**
	 * Convenience factory — same as calling `new MultiTransactionPayload(...)`.
	 * Exists so callers can use a single named entry point and skip the `new`
	 * keyword, which reads better in builder-style chains.
	 */
	static create(
		connection: web3.Connection,
		errors: Map<number, string>,
		transactionData: {
			readonly instructions: web3.TransactionInstruction[];
			readonly feePayer: web3.PublicKey;
			readonly signers?: web3.Signer[];
			readonly addressLookupTableAccounts?: web3.AddressLookupTableAccount[];
		}[],
		signAllTransactions?: SignAllTransactionsFunction,
	) {
		return new MultiTransactionPayload(
			connection,
			errors,
			transactionData,
			signAllTransactions,
		);
	}

	/**
	 * Validates the input batch up front so callers get a synchronous error
	 * for malformed input instead of a confusing failure deep in `execute`.
	 *
	 * Invariants enforced:
	 *   - at least one transaction,
	 *   - every transaction has at least one instruction,
	 *   - every transaction has a fee payer.
	 */
	private validateTransactionData(): void {
		if (!this.transactionsData.length) {
			throw new Error("At least one transaction is required");
		}

		for (const [index, data] of this.transactionsData.entries()) {
			if (!data.instructions.length) {
				throw new Error(`Transaction ${index}: No instructions provided`);
			}
			if (!data.feePayer) {
				throw new Error(`Transaction ${index}: Fee payer is required`);
			}
		}
	}

	/**
	 * Simulates every transaction in the batch in parallel and returns a
	 * `Map` keyed by the original input index.
	 *
	 * All transactions share the same freshly fetched blockhash so the
	 * simulation snapshot is internally consistent. With `sigVerify: true`,
	 * the bulk-sign callback runs once for the whole batch (matching the
	 * UX of a single wallet prompt).
	 *
	 * If any individual `simulateTransaction` call **throws**
	 * (e.g. RPC-level error, sigVerify failure), this method rejects with a
	 * {@link MultiTransactionSimulationError} carrying per-index details for
	 * every failure. Simulations that resolve with `value.err !== null` are
	 * *not* treated as errors here — they're returned in the map for the
	 * caller to inspect.
	 */
	async simulate(
		options?: web3.SimulateTransactionConfig,
	): Promise<
		Map<number, web3.RpcResponseAndContext<web3.SimulatedTransactionResponse>>
	> {
		const { blockhash } = await this._connection.getLatestBlockhash(options);

		const transactions = this.transactionsData.map((data) => {
			const message = new web3.TransactionMessage({
				instructions: data.instructions,
				payerKey: data.feePayer,
				recentBlockhash: blockhash,
			}).compileToV0Message(data.addressLookupTableAccounts);

			const transaction = new web3.VersionedTransaction(message);

			if (options?.sigVerify && data.signers?.length) {
				transaction.sign(data.signers);
			}

			return transaction;
		});
		try {
			let signedTransactions = transactions;

			if (options?.sigVerify) {
				if (!this._signAllTransactions) {
					throw new Error(
						MultiTransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED,
					);
				}

				signedTransactions = await this._signAllTransactions(transactions);
			}

			const simulationErrors: { index: number; error: unknown }[] = [];

			const simulationResult = await Promise.all(
				signedTransactions.map(async (signedTransaction, i) => {
					try {
						const result = await this._connection.simulateTransaction(
							signedTransaction,
							options,
						);

						return [i, result];
					} catch (error) {
						const translatedError = translateError(error, this._errors);
						// console.debug("Simulation error:", translatedError);

						simulationErrors.push({ index: i, error: translatedError });
						return null;
					}
				}),
			);

			if (simulationErrors.length) {
				throw new MultiTransactionSimulationError(
					"One or more simulation failed:\n" +
						JSON.stringify(
							simulationErrors.map((e) => ({
								index: e.index,
								error:
									e.error instanceof Error
										? e.error.message
										: JSON.stringify(e.error, null, 2),
							})),
							null,
							2,
						),
					simulationErrors,
				);
			}

			const simulationResultMap = new Map(
				simulationResult.filter(Boolean) as [
					number,
					web3.RpcResponseAndContext<web3.SimulatedTransactionResponse>,
				][],
			);

			return simulationResultMap;
		} catch (error) {
			console.log("Error");
			throw error;
		}
	}

	/**
	 * Builds (but does not send) one `VersionedTransaction` per
	 * `transactionsData` entry, sharing the supplied `blockhash`. Any
	 * per-transaction `signers` are applied here so the returned transactions
	 * already have their non-fee-payer signatures populated.
	 */
	async buildVersionTransactions(
		blockhash: string,
	): Promise<web3.VersionedTransaction[]> {
		return await Promise.all(
			this.transactionsData.map(async (data) => {
				const message = new web3.TransactionMessage({
					instructions: data.instructions,
					payerKey: data.feePayer,
					recentBlockhash: blockhash,
				}).compileToV0Message(data.addressLookupTableAccounts);

				const transaction = new web3.VersionedTransaction(message);

				if (data.signers?.length) {
					transaction.sign(data.signers);
				}

				return transaction;
			}),
		);
	}
	/**
	 * Prepends compute-budget instructions to a single transaction's
	 * instruction list (in-place via `unshift`). Each kind
	 * (`SetComputeUnitLimit` / `SetComputeUnitPrice`) is only added when the
	 * caller hasn't already supplied one, so user-provided budget settings
	 * always win.
	 *
	 * `unshift` is used because the Solana runtime only honors compute-budget
	 * instructions that appear at the start of the instruction array.
	 */
	private async addPriorityFeeInstructions(
		instructions: web3.TransactionInstruction[],
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<web3.TransactionInstruction[]> {
		const hasComputeUnitLimitInstruction = instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) ===
					"SetComputeUnitLimit",
		);

		const hasComputeUnitPriceInstruction = instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) ===
					"SetComputeUnitPrice",
		);

		if (!hasComputeUnitLimitInstruction) {
			instructions.unshift(
				web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }),
			);
		}

		if (!hasComputeUnitPriceInstruction) {
			const priorityFeeInMicroLamports = await this.calculatePriorityFee(
				instructions,
				computeUnit,
				options,
			);

			instructions.unshift(
				web3.ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: priorityFeeInMicroLamports,
				}),
			);
		}

		return instructions;
	}

	/**
	 * Returns the per-CU priority fee in micro-lamports for a single
	 * transaction in the batch.
	 *
	 *   - If `exactPriorityFeeSol` is set: budget exactly that SOL amount as
	 *     priority fee, distributed across `computeUnit`. Caller takes
	 *     responsibility for the spend.
	 *   - Otherwise: sample recent network activity via
	 *     {@link getRecentPriorityFee} and cap by `maxPriorityFeeSol` so
	 *     bursty congestion can't drain wallets.
	 */
	private async calculatePriorityFee(
		instructions: web3.TransactionInstruction[],
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<bigint> {
		const exactPriorityFeeSol = options?.exactPriorityFeeSol
			? BigNumber(options.exactPriorityFeeSol)
			: undefined;

		if (exactPriorityFeeSol) {
			return BigInt(
				exactPriorityFeeSol
					.times(web3.LAMPORTS_PER_SOL)
					.minus(BASE_FEE_LAMPORTS)
					.div(computeUnit)
					.div(LAMPORTS_PER_MICRO_LAMPORT)
					.toFixed(0, BigNumber.ROUND_DOWN),
			);
		}

		const priorityLevel: PriorityLevel = options?.priorityLevel ?? "medium";
		const maxPriorityFeeSol =
			options?.maxPriorityFeeSol ?? DEFAULT_MAX_PRIORITY_FEE;

		const maxPriorityFeePerCU = BigNumber(maxPriorityFeeSol)
			.times(web3.LAMPORTS_PER_SOL)
			.minus(BASE_FEE_LAMPORTS)
			.div(computeUnit)
			.div(LAMPORTS_PER_MICRO_LAMPORT);

		const priorityFeePerCU = await getRecentPriorityFee(
			this._connection,
			instructions,
			priorityLevel,
			maxPriorityFeePerCU,
		);

		return BigInt(priorityFeePerCU.toFixed(0, BigNumber.ROUND_DOWN));
	}

	/**
	 * End-to-end batch send: (optionally) simulate → attach priority fees →
	 * build → bulk-sign → send & confirm each transaction in parallel.
	 *
	 * Failure semantics: each transaction is wrapped in its own try/catch
	 * and surfaced as a `PromiseSettledResult`, so one bad transaction
	 * doesn't cancel its siblings. Use the returned `transactionData` /
	 * `transaction` fields to retry just the failures.
	 *
	 * @returns One result per input transaction, in the original order.
	 * @throws  Only for pre-flight failures that affect the whole batch
	 *          (missing sign function, batch-level simulation throw,
	 *          blockhash fetch failure). Individual transaction failures
	 *          surface as `status: "rejected"` entries.
	 */
	async execute(
		options?: TransactionExecutionOptions,
	): Promise<MultiTransactionPayloadExecuteReturn> {
		if (!this._signAllTransactions) {
			throw new Error(
				MultiTransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED,
			);
		}

		const enablePriorityFee = options?.enablePriorityFee ?? true;

		if (enablePriorityFee) {
			// Simulation runs with `sigVerify: true` so the cluster rejects
			// the batch early if any signature is bad — cheaper than learning
			// that at send time.
			const simulationResults = await this.simulate({
				...options,
				sigVerify: true,
			});
			await Promise.all(
				this.transactionsData.map(async (data, i) => {
					const simulationResult = simulationResults.get(i);
					// CU sizing: simulated spend + ComputeBudget overhead, x2
					// safety margin. Under-provisioning kills the whole tx.
					const computeUnit = simulationResult?.value.unitsConsumed
						? Math.floor(
								(simulationResult.value.unitsConsumed +
									COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT) *
									2,
							)
						: MAX_COMPUTE_UNIT;

					await this.addPriorityFeeInstructions(
						data.instructions,
						computeUnit,
						options,
					);
				}),
			);
		}

		const { lastValidBlockHeight, blockhash } =
			await this._connection.getLatestBlockhash(options);

		const transactions = await this.buildVersionTransactions(blockhash);

		const signedTransactions = await this._signAllTransactions(transactions);

		// Each transaction gets its own AbortController so one failing
		// confirmation can stop its own send loop without affecting the rest
		// of the batch. The outer `Promise.allSettled` keeps siblings running
		// to completion even if some reject.
		const promises = signedTransactions.map(async (signedTransaction) => {
			try {
				const abortController = new AbortController();
				const signature = await sendAndConfirm({
					blockhash,
					connection: this._connection,
					lastValidBlockHeight,
					signedTransaction,
					options,
					abortController,
				});

				return signature;
			} catch (err: unknown) {
				throw parseSolanaSendTransactionError(err, this._errors);
			}
		});

		const results = await Promise.allSettled(promises);

		if (results.length !== this.transactionsData.length) {
			throw new Error("Results length mismatch");
		}
		if (results.length !== transactions.length) {
			throw new Error("Results length mismatch");
		}

		const resultsWithAdditionalData = results.map((result, i) => {
			return {
				...result,
				// biome-ignore lint/style/noNonNullAssertion: length checks ensure these are not null
				transactionData: this.transactionsData[i]!,
				// biome-ignore lint/style/noNonNullAssertion: length checks ensure these are not null
				transaction: transactions[i]!,
			};
		});

		return resultsWithAdditionalData;
	}
}
