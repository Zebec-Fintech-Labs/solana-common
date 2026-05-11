import { translateError, web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";

import {
	BASE_FEE_LAMPORTS,
	COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT,
	DEFAULT_MAX_PRIORITY_FEE,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
import {
	getRecentPriorityFee,
	type PriorityLevel,
	parseSolanaSendTransactionError,
	sendAndConfirm,
	type TransactionExecutionOptions,
} from "../utils";

/**
 * Async callback that accepts a built transaction, signs it with the
 * caller's wallet (in-place is fine), and returns the same transaction.
 *
 * Generic over both legacy and versioned transactions so the same function
 * signature can be used regardless of which {@link TransactionPayload}
 * produces internally. Callers typically branch on `instanceof web3.Transaction`
 * vs `instanceof web3.VersionedTransaction` to pick the right signing API.
 */
export type SignTransactionFunction = <
	T extends web3.Transaction | web3.VersionedTransaction,
>(
	transaction: T,
) => Promise<T>;

/**
 * High-level builder for a single Solana transaction.
 *
 * Wraps the standard "build → (optionally simulate for priority fee) →
 * sign → send → confirm" pipeline with:
 *   - automatic compute-budget / priority-fee instruction injection,
 *   - retry on transient send errors,
 *   - error translation via {@link parseSolanaSendTransactionError}.
 *
 * For sending multiple independent transactions in one call, see
 * `MultiTransactionPayload`.
 */
export class TransactionPayload {
	private static readonly ERROR_MESSAGES = {
		SIGN_FUNCTION_REQUIRED:
			"signTransaction is required to execute transaction payload.",
		CONFIRMATION_TIMEOUT: "Transaction confirmation timed out",
	} as const;

	/**
	 * @param _connection      Solana RPC connection used for blockhash fetch,
	 *                         simulation, send, and confirm.
	 * @param _errors          Map of program error codes → messages from the
	 *                         program's IDL. Forwarded to
	 *                         {@link parseSolanaSendTransactionError}.
	 * @param transactionData  Instructions + fee payer + (optional) signers
	 *                         and address-lookup tables that make up the
	 *                         single transaction.
	 * @param _signTransaction Wallet-supplied signing callback. Required by
	 *                         {@link execute}; optional only when the caller
	 *                         is going to use {@link buildVersionTransaction}
	 *                         or {@link simulate} without `sigVerify`.
	 */
	constructor(
		private readonly _connection: web3.Connection,
		private readonly _errors: Map<number, string>,
		readonly transactionData: {
			readonly instructions: web3.TransactionInstruction[];
			readonly feePayer: web3.PublicKey;
			readonly signers?: web3.Signer[];
			readonly addressLookupTableAccounts?: web3.AddressLookupTableAccount[];
		},
		private readonly _signTransaction?: SignTransactionFunction,
	) {}

	/**
	 * Simulates the transaction against the cluster.
	 *
	 * Used in two modes:
	 *   - `sigVerify: false` (default) — cheap dry-run that returns
	 *     `unitsConsumed` and any execution `err`, used by {@link execute}
	 *     to size the compute-unit limit before sending.
	 *   - `sigVerify: true` — performs full signature verification; requires
	 *     a `_signTransaction` callback because the transaction needs real
	 *     signatures for the RPC to accept it.
	 *
	 * Note: this resolves successfully with `result.value.err !== null` when
	 * the transaction would fail at runtime (e.g. insufficient funds). It
	 * only throws on RPC-level errors (bad blockhash, sigVerify mismatch),
	 * which are then routed through Anchor's `translateError`.
	 */
	async simulate(
		options?: web3.SimulateTransactionConfig,
	): Promise<web3.RpcResponseAndContext<web3.SimulatedTransactionResponse>> {
		try {
			const { blockhash } = await this._connection.getLatestBlockhash(options);

			const message = new web3.TransactionMessage({
				instructions: this.transactionData.instructions,
				payerKey: this.transactionData.feePayer,
				recentBlockhash: blockhash,
			}).compileToV0Message(this.transactionData.addressLookupTableAccounts);

			const transaction = new web3.VersionedTransaction(message);

			let signedTransaction = transaction;
			if (options?.sigVerify) {
				if (this.transactionData.signers?.length) {
					transaction.sign(this.transactionData.signers);
				}
				if (!this._signTransaction) {
					throw new Error(
						TransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED,
					);
				}
				signedTransaction = await this._signTransaction(transaction);
			}

			return await this._connection.simulateTransaction(
				signedTransaction,
				options,
			);
		} catch (err: unknown) {
			const translatedError = translateError(err, this._errors);
			console.debug("Simulation error:", translatedError);
			throw translatedError;
		}
	}

	/**
	 * Builds — but does **not** broadcast — a `VersionedTransaction` from the
	 * configured `transactionData`. Useful when the caller wants full control
	 * over signing or wants to inspect the compiled message before sending.
	 *
	 * If `transactionData.signers` is non-empty, they are applied here so the
	 * returned transaction has its non-fee-payer signatures already populated.
	 * The fee-payer signature still has to be supplied externally.
	 */
	buildVersionTransaction(blockhash: string): web3.VersionedTransaction {
		const message = new web3.TransactionMessage({
			instructions: this.transactionData.instructions,
			payerKey: this.transactionData.feePayer,
			recentBlockhash: blockhash,
		}).compileToV0Message(this.transactionData.addressLookupTableAccounts);

		const transaction = new web3.VersionedTransaction(message);

		if (this.transactionData.signers?.length) {
			transaction.sign(this.transactionData.signers);
		}

		return transaction;
	}
	/**
	 * Returns the compute-budget instructions that need to be prepended to the
	 * transaction. Skips either instruction kind (`SetComputeUnitLimit` /
	 * `SetComputeUnitPrice`) when the caller already supplied one in
	 * `transactionData.instructions`, so user-provided budget settings always
	 * win.
	 */
	private async getPriorityFeeInstructions(
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<web3.TransactionInstruction[]> {
		const hasComputeUnitLimitInstruction =
			this.transactionData.instructions.some(
				(instruction) =>
					instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
					web3.ComputeBudgetInstruction.decodeInstructionType(instruction) ===
						"SetComputeUnitLimit",
			);

		const hasComputeUnitPriceInstruction =
			this.transactionData.instructions.some(
				(instruction) =>
					instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
					web3.ComputeBudgetInstruction.decodeInstructionType(instruction) ===
						"SetComputeUnitPrice",
			);

		const newInstructions: web3.TransactionInstruction[] = [];

		if (!hasComputeUnitLimitInstruction) {
			newInstructions.push(
				web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }),
			);
		}

		if (!hasComputeUnitPriceInstruction) {
			const priorityFeeInMicroLamports = await this.calculatePriorityFee(
				computeUnit,
				options,
			);

			newInstructions.push(
				web3.ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: priorityFeeInMicroLamports,
				}),
			);
		}

		return newInstructions;
	}

	/**
	 * Resolves the per-CU priority fee to attach.
	 *
	 *   - If `exactPriorityFeeSol` is set: pay exactly that much (in SOL)
	 *     above the base fee, distributed across the compute budget. Useful
	 *     when the caller wants deterministic spend.
	 *   - Otherwise: derive a fee from recent cluster activity via
	 *     `getRecentPriorityFee`, capped by `maxPriorityFeeSol` so a bursty
	 *     network can't accidentally drain wallets.
	 */
	private async calculatePriorityFee(
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
			this.transactionData.instructions,
			priorityLevel,
			maxPriorityFeePerCU,
		);

		return BigInt(priorityFeePerCU.toFixed(0, BigNumber.ROUND_FLOOR));
	}

	/**
	 * End-to-end happy path: simulate (for compute units) → attach priority
	 * fee → fetch blockhash → build VersionedTransaction → sign → send +
	 * confirm.
	 *
	 * Any error from any step is funneled through
	 * {@link parseSolanaSendTransactionError} so callers always see a
	 * normalized `Error` (Anchor error / insufficient-funds / etc).
	 *
	 * @param options Standard `ConfirmOptions` plus retry / priority-fee
	 *                tuning. `enablePriorityFee` defaults to `true`.
	 * @returns bs58-encoded transaction signature.
	 */
	async execute(
		options?: TransactionExecutionOptions,
	): Promise<web3.TransactionSignature> {
		if (!this._signTransaction) {
			throw new Error(TransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
		}

		try {
			const enablePriorityFee = options?.enablePriorityFee ?? true;
			let priorityFeeInstructions: web3.TransactionInstruction[] = [];

			if (enablePriorityFee) {
				// Simulate before injecting compute-budget instructions so the
				// reported `unitsConsumed` reflects the caller's real workload.
				const simulationResult = await this.simulate(options);
				// Sizing rationale: take the simulated CU spend, add the
				// constant overhead the ComputeBudget program itself charges,
				// then double it as a safety margin — under-provisioning the
				// limit causes the whole transaction to fail at runtime, which
				// is far worse than slightly over-paying. Fall back to
				// `MAX_COMPUTE_UNIT` if the simulator didn't report a number
				// (e.g. simulation errored out).
				const computeUnit = simulationResult.value.unitsConsumed
					? Math.floor(
							(simulationResult.value.unitsConsumed +
								COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT) *
								2,
						)
					: MAX_COMPUTE_UNIT;

				// Get priority fee instructions but don't modify transactionData
				priorityFeeInstructions = await this.getPriorityFeeInstructions(
					computeUnit,
					options,
				);
			}

			const { lastValidBlockHeight, blockhash } =
				await this._connection.getLatestBlockhash(options);
			// console.debug(
			// 	"Compute Budget instructions:",
			// 	JSON.stringify(priorityFeeInstructions),
			// );

			// Priority-fee instructions must come first; the runtime ignores
			// `SetComputeUnitLimit` / `SetComputeUnitPrice` instructions that
			// appear after the first non-budget instruction.
			const allInstructions = [
				...priorityFeeInstructions,
				...this.transactionData.instructions,
			];
			const message = new web3.TransactionMessage({
				instructions: allInstructions,
				payerKey: this.transactionData.feePayer,
				recentBlockhash: blockhash,
			}).compileToV0Message(this.transactionData.addressLookupTableAccounts);

			const transaction = new web3.VersionedTransaction(message);

			if (this.transactionData.signers?.length) {
				transaction.sign(this.transactionData.signers);
			}

			const signedTransaction = await this._signTransaction(transaction);

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
		} catch (err) {
			throw parseSolanaSendTransactionError(err, this._errors);
		}
	}
}
