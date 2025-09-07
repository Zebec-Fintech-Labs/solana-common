import { BigNumber } from "bignumber.js";

import { translateError, utils, web3 } from "@coral-xyz/anchor";

import {
	BASE_FEE_LAMPORTS,
	DEFAULT_MAX_PRIORITY_FEE,
	DEFAULT_SEND_TRANSACTION_INTERVAL,
	LAMPORTS_PER_MICRO_LAMPORT,
	MAX_COMPUTE_UNIT,
} from "../constants";
import {
	getRecentPriorityFee,
	parseSolanaSendTransactionError,
	PriorityLevel,
	sleep,
} from "../utils";

/**
 * Enhanced transaction execution options
 */
export type TransactionExecutionOptions = web3.ConfirmOptions & {
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
export type SignTransactionFunction = <T extends web3.Transaction | web3.VersionedTransaction>(
	transaction: T,
) => Promise<T>;

/**
 * Enhanced transaction payload class with improved error handling and retry logic
 */
export class TransactionPayload {
	private static readonly ERROR_MESSAGES = {
		SIGN_FUNCTION_REQUIRED: "signTransaction is required to execute transaction payload.",
		BLOCK_HEIGHT_EXCEEDED: "Block height exceeded before confirmation",
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
	private async addPriorityFeeInstructions(
		computeUnit: number,
		options?: TransactionExecutionOptions,
	): Promise<void> {
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

		if (!hasComputeUnitLimitInstruction) {
			this.transactionData.instructions.unshift(
				web3.ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }),
			);
		}

		if (!hasComputeUnitPriceInstruction) {
			const priorityFeeInMicroLamports = await this.calculatePriorityFee(computeUnit, options);

			this.transactionData.instructions.unshift(
				web3.ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: priorityFeeInMicroLamports,
				}),
			);
		}
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

		return BigInt(priorityFeePerCU.toFixed(0, BigNumber.ROUND_DOWN));
	}

	/**
	 * Handles transaction sending with retry logic
	 */
	private async sendTransactionWithRetry(
		signedTransaction: web3.VersionedTransaction,
		signature: string,
		lastValidBlockHeight: number,
		options?: TransactionExecutionOptions,
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
			throw new Error(TransactionPayload.ERROR_MESSAGES.BLOCK_HEIGHT_EXCEEDED);
		}
	}

	/**
	 * Confirms transaction with timeout handling
	 */
	private async confirmTransactionWithTimeout(
		signature: string,
		blockhash: string,
		lastValidBlockHeight: number,
		options?: TransactionExecutionOptions,
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
	async execute(options?: TransactionExecutionOptions): Promise<web3.TransactionSignature> {
		if (!this._signTransaction) {
			throw new Error(TransactionPayload.ERROR_MESSAGES.SIGN_FUNCTION_REQUIRED);
		}

		try {
			const enablePriorityFee = options?.enablePriorityFee ?? true;

			if (enablePriorityFee) {
				const simulationResult = await this.simulate(options);
				const computeUnit = simulationResult.value.unitsConsumed
					? simulationResult.value.unitsConsumed + 300
					: MAX_COMPUTE_UNIT;

				await this.addPriorityFeeInstructions(computeUnit, options);
			}

			const { lastValidBlockHeight, blockhash } =
				await this._connection.getLatestBlockhash(options);

			const transaction = this.buildVersionTransaction(blockhash);

			const signedTransaction = await this._signTransaction(transaction);
			const signatureBuffer = signedTransaction.signatures[0]!;
			const signature = utils.bytes.bs58.encode(signatureBuffer);

			// Use Promise.all to send and confirm simultaneously
			await Promise.all([
				this.sendTransactionWithRetry(signedTransaction, signature, lastValidBlockHeight, options),
				this.confirmTransactionWithTimeout(signature, blockhash, lastValidBlockHeight, options),
			]);

			return signature;
		} catch (err: any) {
			throw parseSolanaSendTransactionError(err, this._errors);
		}
	}
}
