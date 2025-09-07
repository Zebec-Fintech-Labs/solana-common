import { BigNumber } from "bignumber.js";

import { translateError, utils, web3 } from "@coral-xyz/anchor";

import {
	BASE_FEE_LAMPORTS,
	DEFAULT_MAX_PRIORITY_FEE,
	DEFAULT_SEND_TRANSACTION_INTERVAL,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
import { MultiTransactionSimulationError } from "../error";
import {
	getRecentPriorityFee,
	parseSolanaSendTransactionError,
	PriorityLevel,
	sleep,
} from "../utils";

/**
 * Enhanced transaction execution options
 */
export type MultiTransactionExecutionOptions = web3.ConfirmOptions & {
	enablePriorityFee?: boolean;
	sendTransactionInterval?: number;
	maxSendTransactionRetries?: number;
	priorityLevel?: PriorityLevel;
	maxPriorityFeeSol?: number;
	exactPriorityFeeSol?: number;
	confirmationTimeout?: number;
	skipPreflight?: boolean;
};

/**
 * Transaction signing function type
 */
export type SignAllTransactionsFunction = <T extends web3.Transaction | web3.VersionedTransaction>(
	transactions: T[],
) => Promise<T[]>;

/**
 * Enhanced transaction payload class with improved error handling and retry logic
 */
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
		options?: MultiTransactionExecutionOptions,
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
		options?: MultiTransactionExecutionOptions,
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
	 * Handles transaction sending with retry logic
	 */
	private async sendTransactionWithRetry(
		signedTransaction: web3.VersionedTransaction,
		signature: string,
		lastValidBlockHeight: number,
		options?: MultiTransactionExecutionOptions,
	): Promise<void> {
		const sendTransactionInterval =
			options?.sendTransactionInterval ?? DEFAULT_SEND_TRANSACTION_INTERVAL;
		const maxRetries = options?.maxSendTransactionRetries ?? Number.MAX_SAFE_INTEGER;

		let retry = 0;
		let blockHeight = await this._connection.getBlockHeight(options);

		while (blockHeight < lastValidBlockHeight && retry < maxRetries) {
			try {
				await this._connection.sendRawTransaction(signedTransaction.serialize(), {
					...options,
					skipPreflight: options?.skipPreflight ?? false,
				});

				console.debug("Signature sent: %s at %o", signature, new Date());
				retry++;
				await sleep(sendTransactionInterval);
				blockHeight = await this._connection.getBlockHeight(options);
			} catch (err: any) {
				if (err.message?.includes("This transaction has already been processed")) {
					return;
				}

				if (err.message?.includes("Blockhash not found")) {
					console.debug("Expected error (will retry):", err.message);
					retry++;
					await sleep(sendTransactionInterval);
					blockHeight = await this._connection.getBlockHeight(options);
					continue;
				}

				throw err;
			}
		}

		if (blockHeight >= lastValidBlockHeight) {
			throw new Error(MultiTransactionPayload.ERROR_MESSAGES.BLOCK_HEIGHT_EXCEEDED);
		}
	}

	/**
	 * Confirms transaction with timeout handling
	 */
	private async confirmTransactionWithTimeout(
		signature: string,
		blockhash: string,
		lastValidBlockHeight: number,
		options?: MultiTransactionExecutionOptions,
	): Promise<void> {
		const startTime = Date.now();

		const response = await this._connection.confirmTransaction(
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
			throw new Error(`Failed to confirm transaction: ${errorMsg}`);
		}

		const endTime = Date.now();
		console.debug("Confirmed at: %o", new Date(endTime));
		console.debug("Time elapsed: %d ms", endTime - startTime);
	}

	/**
	 * Signs, sends, and confirms transaction with enhanced error handling
	 */
	async execute(
		options?: MultiTransactionExecutionOptions,
	): Promise<PromiseSettledResult<string>[]> {
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
						? simulationResult.value.unitsConsumed + 300
						: MAX_COMPUTE_UNIT;

					await this.addPriorityFeeInstructions(data.instructions, computeUnit, options);
				}),
			);
		}

		const { lastValidBlockHeight, blockhash } = await this._connection.getLatestBlockhash(options);

		const transaction = await this.buildVersionTransactions(blockhash);

		const signedTransactions = await this._signAllTransactions(transaction);

		const promises = signedTransactions.map(async (signedTransaction) => {
			try {
				const signatureBuffer = signedTransaction.signatures[0]!;
				const signature = utils.bytes.bs58.encode(signatureBuffer);

				await Promise.all([
					this.sendTransactionWithRetry(
						signedTransaction,
						signature,
						lastValidBlockHeight,
						options,
					),
					this.confirmTransactionWithTimeout(signature, blockhash, lastValidBlockHeight, options),
				]);
				return signature;
			} catch (err: any) {
				throw parseSolanaSendTransactionError(err, this._errors);
			}
		});

		const result = await Promise.allSettled(promises);
		return result;
	}
}
