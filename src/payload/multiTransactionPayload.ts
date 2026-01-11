import assert from "assert";
import { BigNumber } from "bignumber.js";

import { translateError, utils, web3 } from "@coral-xyz/anchor";

import {
	BASE_FEE_LAMPORTS,
	COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT,
	DEFAULT_MAX_PRIORITY_FEE,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
import { MultiTransactionSimulationError } from "../error";
import {
	confirmTransactionWithTimeout,
	getRecentPriorityFee,
	parseSolanaSendTransactionError,
	PriorityLevel,
	sendTransactionWithRetry,
	TransactionExecutionOptions,
} from "../utils";

/**
 * Transaction signing function type
 */
export type SignAllTransactionsFunction = <T extends web3.Transaction | web3.VersionedTransaction>(
	transactions: T[],
) => Promise<T[]>;

/**
 * Enhanced transaction payload class with improved error handling and retry logic
 */

export type MultiTransactionPayloadExecuteReturn = (PromiseSettledResult<string> & {
	transactionData: {
		readonly instructions: web3.TransactionInstruction[];
		readonly feePayer: web3.PublicKey;
		readonly signers?: web3.Signer[];
		readonly addressLookupTableAccounts?: web3.AddressLookupTableAccount[];
	};
	transaction: web3.VersionedTransaction;
})[];

export class MultiTransactionPayload {
	private static readonly ERROR_MESSAGES = {
		SIGN_FUNCTION_REQUIRED: "signTransaction is required to execute transaction payload.",
		BLOCK_HEIGHT_EXCEEDED: "Block height exceeded before confirmation",
		CONFIRMATION_TIMEOUT: "Transaction confirmation timed out",
	} as const;

	/**
	 *
	 * @param _connection Solana rpc connection
	 * @param _errors Program errors map for error translation
	 * @param transactionsData Array of transaction data objects
	 * @param _signAllTransactions Function that signs and returns signed transactions
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
		return new MultiTransactionPayload(connection, errors, transactionData, signAllTransactions);
	}

	/**
	 * Validates transaction data integrity
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
	 * Simulates the transactions to estimate compute units and detect errors
	 */
	async simulate(
		options?: web3.SimulateTransactionConfig,
	): Promise<Map<number, web3.RpcResponseAndContext<web3.SimulatedTransactionResponse>>> {
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
					throw new Error(MultiTransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
				}

				signedTransactions = await this._signAllTransactions(transactions);
			}

			const simulationErrors: { index: number; error: any }[] = [];

			let simulationResult = await Promise.all(
				signedTransactions.map(async (signedTransaction, i) => {
					try {
						const result = await this._connection.simulateTransaction(signedTransaction, options);

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
								error: e.error.message ?? JSON.stringify(e.error, null, 2),
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

	async buildVersionTransactions(blockhash: string): Promise<web3.VersionedTransaction[]> {
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
	 * Adds priority fee instructions if they don't already exist
	 */
	private async addPriorityFeeInstructions(
		instructions: web3.TransactionInstruction[],
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<web3.TransactionInstruction[]> {
		const hasComputeUnitLimitInstruction = instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitLimit",
		);

		const hasComputeUnitPriceInstruction = instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitPrice",
		);

		if (!hasComputeUnitLimitInstruction) {
			instructions.unshift(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }));
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
	 * Calculates priority fee in micro-lamports
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
		const maxPriorityFeeSol = options?.maxPriorityFeeSol ?? DEFAULT_MAX_PRIORITY_FEE;

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
	 * Signs, sends, and confirms transaction with enhanced error handling
	 */
	async execute(
		options?: TransactionExecutionOptions,
	): Promise<MultiTransactionPayloadExecuteReturn> {
		if (!this._signAllTransactions) {
			throw new Error(MultiTransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
		}

		const enablePriorityFee = options?.enablePriorityFee ?? true;

		if (enablePriorityFee) {
			const simulationResults = await this.simulate({
				...options,
				sigVerify: true,
			});
			await Promise.all(
				this.transactionsData.map(async (data, i) => {
					const simulationResult = simulationResults.get(i);
					const computeUnit = simulationResult?.value.unitsConsumed
						? Math.floor(
								(simulationResult.value.unitsConsumed + COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT) * 1.1,
							)
						: MAX_COMPUTE_UNIT;

					await this.addPriorityFeeInstructions(data.instructions, computeUnit, options);
				}),
			);
		}

		const { lastValidBlockHeight, blockhash } = await this._connection.getLatestBlockhash(options);

		const transactions = await this.buildVersionTransactions(blockhash);

		const signedTransactions = await this._signAllTransactions(transactions);

		const promises = signedTransactions.map(async (signedTransaction) => {
			try {
				const signatureBuffer = signedTransaction.signatures[0]!;
				const signature = utils.bytes.bs58.encode(signatureBuffer);
				const abortController = new AbortController();

				try {
					await Promise.all([
						sendTransactionWithRetry(
							this._connection,
							signedTransaction,
							signature,
							lastValidBlockHeight,
							abortController.signal,
							options,
						),
						confirmTransactionWithTimeout(
							this._connection,
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
				} catch (err: any) {
					abortController.abort();
					throw err;
				}
				return signature;
			} catch (err: any) {
				throw parseSolanaSendTransactionError(err, this._errors);
			}
		});

		const results = await Promise.allSettled(promises);

		assert(results.length === this.transactionsData.length, "Results length mismatch");
		assert(results.length === transactions.length, "Results length mismatch");

		const resultsWithAdditionalData = results.map((result, i) => {
			return {
				...result,
				transactionData: this.transactionsData[i]!,
				transaction: transactions[i]!,
			};
		});

		return resultsWithAdditionalData;
	}
}
