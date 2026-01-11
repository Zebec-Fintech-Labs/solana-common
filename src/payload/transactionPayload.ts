import { BigNumber } from "bignumber.js";

import { translateError, utils, web3 } from "@coral-xyz/anchor";

import {
	BASE_FEE_LAMPORTS,
	DEFAULT_MAX_PRIORITY_FEE,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
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
export type SignTransactionFunction = <T extends web3.Transaction | web3.VersionedTransaction>(
	transaction: T,
) => Promise<T>;

/**
 * Enhanced transaction payload class with improved error handling and retry logic
 */
export class TransactionPayload {
	private static readonly ERROR_MESSAGES = {
		SIGN_FUNCTION_REQUIRED: "signTransaction is required to execute transaction payload.",
		CONFIRMATION_TIMEOUT: "Transaction confirmation timed out",
	} as const;

	/**
	 *
	 * @param _connection Solana rpc connection
	 * @param _errors
	 * @param transactionData
	 * @param _signTransaction
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
	 * Simulates the transaction to estimate compute units and detect errors
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
					throw new Error(TransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
				}
				signedTransaction = await this._signTransaction(transaction);
			}

			return await this._connection.simulateTransaction(signedTransaction, options);
		} catch (err: any) {
			const translatedError = translateError(err, this._errors);
			console.debug("Simulation error:", translatedError);
			throw translatedError;
		}
	}

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
	 * Adds priority fee instructions if they don't already exist
	 */
	private async getPriorityFeeInstructions(
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<web3.TransactionInstruction[]> {
		const hasComputeUnitLimitInstruction = this.transactionData.instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitLimit",
		);

		const hasComputeUnitPriceInstruction = this.transactionData.instructions.some(
			(instruction) =>
				instruction.programId.equals(web3.ComputeBudgetProgram.programId) &&
				web3.ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitPrice",
		);

		const newInstructions: web3.TransactionInstruction[] = [];

		if (!hasComputeUnitLimitInstruction) {
			newInstructions.push(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }));
		}

		if (!hasComputeUnitPriceInstruction) {
			const priorityFeeInMicroLamports = await this.calculatePriorityFee(computeUnit, options);

			newInstructions.push(
				web3.ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: priorityFeeInMicroLamports,
				}),
			);
		}

		return newInstructions;
	}

	/**
	 * Calculates priority fee in micro-lamports
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
		const maxPriorityFeeSol = options?.maxPriorityFeeSol ?? DEFAULT_MAX_PRIORITY_FEE;

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
	 * Signs, sends, and confirms transaction with enhanced error handling
	 */
	async execute(options?: TransactionExecutionOptions): Promise<web3.TransactionSignature> {
		if (!this._signTransaction) {
			throw new Error(TransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
		}

		try {
			const enablePriorityFee = options?.enablePriorityFee ?? true;
			let priorityFeeInstructions: web3.TransactionInstruction[] = [];

			if (enablePriorityFee) {
				// Simulate WITHOUT priority fee instructions first
				const simulationResult = await this.simulate(options);
				const computeUnit = simulationResult.value.unitsConsumed
					? Math.floor(simulationResult.value.unitsConsumed * 1.2)
					: MAX_COMPUTE_UNIT;

				// Get priority fee instructions but don't modify transactionData
				priorityFeeInstructions = await this.getPriorityFeeInstructions(computeUnit, options);
			}

			const { lastValidBlockHeight, blockhash } =
				await this._connection.getLatestBlockhash(options);
			console.debug("Compute Budget instructions:", JSON.stringify(priorityFeeInstructions));

			// Build transaction with priority fee instructions prepended
			const allInstructions = [...priorityFeeInstructions, ...this.transactionData.instructions];
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
			const signatureBuffer = signedTransaction.signatures[0]!;
			const signature = utils.bytes.bs58.encode(signatureBuffer);

			const abortController = new AbortController();

			try {
				// Use Promise.all to send and confirm simultaneously
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
	}
}
