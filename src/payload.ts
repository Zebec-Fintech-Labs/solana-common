import { BigNumber } from "bignumber.js";

import { translateError, utils, web3 } from "@coral-xyz/anchor";
import {
	AddressLookupTableAccount,
	ComputeBudgetInstruction,
	ComputeBudgetProgram,
	ConfirmOptions,
	Connection,
	LAMPORTS_PER_SOL,
	PublicKey,
	Signer,
	SimulateTransactionConfig,
	TransactionError,
	TransactionInstruction,
	TransactionMessage,
	TransactionSignature,
	VersionedTransaction,
} from "@solana/web3.js";

/**
 * In millisecond
 */
const DEFAULT_SEND_TRANSACTION_INTERVAL = 1000;

/**
 * Max compute budget unit
 */
export const MAX_COMPUTE_UNIT = 1_400_000;

export const BASE_FEE_LAMPORTS = 5000;

export const LAMPORTS_PER_MICRO_LAMPORT = 0.000001;

export const DEFAULT_MAX_PRIORITY_FEE = 0.001;

export type PriorityLevel = "low" | "medium" | "high";

export async function getRecentPriorityFee(
	connection: web3.Connection,
	instructions: web3.TransactionInstruction[],
	priorityLevel: PriorityLevel,
	maxFeeCap: BigNumber,
) {
	const lockedWritableAccounts = [
		...new Set(instructions.flatMap((ix) => [...ix.keys.map((key) => key.pubkey), ix.programId])),
	];

	const recentPrioritizationFees = await connection.getRecentPrioritizationFees({
		lockedWritableAccounts,
	});

	// console.log("recent fees", recentPrioritizationFees);
	const sortedNonZeroList = recentPrioritizationFees
		.filter((b) => b.prioritizationFee > 0)
		.sort((a, b) => {
			const result = BigNumber(a.prioritizationFee).comparedTo(b.prioritizationFee);
			if (!result) {
				throw new Error("Unexpected Error: Result is not supposed to be null.");
			}

			return result;
		});

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
	// console.log("median fee:", medianFee.toFixed());

	// Apply multiplier based on priority level
	const multipliers: Record<PriorityLevel, number> = {
		low: 1,
		medium: 1.5,
		high: 2,
	};

	// Calculate fee
	const calculatedFee = medianFee
		.times(multipliers[priorityLevel]!)
		.decimalPlaces(0, BigNumber.ROUND_FLOOR);
	// console.log("calculated fee:", calculatedFee.toFixed());

	const fee = BigNumber.min(calculatedFee, maxFeeCap);

	return fee;
}

function sleep(durationInMs: number) {
	return new Promise((r) => setTimeout(r, durationInMs));
}

export type SignTransactionFunction = <T extends web3.Transaction | web3.VersionedTransaction>(
	transaction: T,
) => Promise<T>;

/**
 * A executable payload that holds transaction
 */
export class TransactionPayload {
	/**
	 *
	 * @param _connection Solana web3 connnection
	 * @param _errors Program errors map
	 * @param instructions Transaction instructions
	 * @param feePayer Transaction fee payer
	 * @param signers Partial signers required to instruction
	 * @param addressLookupTableAccounts Address lookup table accounts for transaction
	 * @param _signTransaction function that signs and return signed transaction. Transaction build from the instructions is passed to this function
	 */
	constructor(
		private readonly _connection: Connection,
		private readonly _errors: Map<number, string>,
		readonly instructions: TransactionInstruction[],
		readonly feePayer: PublicKey,
		readonly signers?: Signer[],
		readonly addressLookupTableAccounts?: AddressLookupTableAccount[],
		private readonly _signTransaction?: SignTransactionFunction,
	) {}

	async simulate(options?: SimulateTransactionConfig) {
		if (!this._signTransaction) {
			throw new Error("signTransaction is required to execute transaction payload.");
		}

		const { blockhash } = await this._connection.getLatestBlockhash(options);

		const message = new TransactionMessage({
			instructions: this.instructions,
			payerKey: this.feePayer,
			recentBlockhash: blockhash, // Note: this blockhash will be replaced at the time of sign and send
		}).compileToV0Message(this.addressLookupTableAccounts);

		const transaction = new VersionedTransaction(message);

		let signedTransaction = transaction;
		if (options?.sigVerify) {
			// sign transaction
			if (this.signers && this.signers.length > 0) {
				transaction.sign(this.signers);
			}

			signedTransaction = await this._signTransaction(transaction);
		}

		try {
			return this._connection.simulateTransaction(signedTransaction, options);
		} catch (err: any) {
			// console.debug("error:", err);
			const translatedError = translateError(err, this._errors);
			// console.debug("translated error:", translatedError);

			throw translatedError;
		}
	}

	/**
	 * Signs, send and confim transaction
	 *
	 * `Note`: requires signTransaction while creating instance of this object.
	 * @param options solana confirm options
	 * @returns
	 */
	async execute(
		options?: ConfirmOptions & {
			sendTransactionInterval?: number;
			maxSendTransactionRetries?: number;
			priorityLevel?: PriorityLevel;
			maxPriorityFeeSol?: number;
			exactPriorityFeeSol?: number;
		},
	): Promise<TransactionSignature> {
		if (!this._signTransaction) {
			throw new Error("signTransaction is required to execute transaction payload.");
		}

		const simulationResult = await this.simulate(options);

		// 300 added for Compute Budget Instructions
		const computeUnit = simulationResult.value.unitsConsumed
			? simulationResult.value.unitsConsumed + 300
			: MAX_COMPUTE_UNIT;
		// console.log("compute unit:", computeUnit);
		// console.log("compute unit:", computeUnit);

		const hasComputeUnitLimitInstruction = this.instructions.some(
			(instruction) =>
				instruction.programId.equals(ComputeBudgetProgram.programId) &&
				ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitLimit",
		);

		const hasComputerUnitPriceInstruction = this.instructions.some(
			(instruction) =>
				instruction.programId.equals(ComputeBudgetProgram.programId) &&
				ComputeBudgetInstruction.decodeInstructionType(instruction) === "SetComputeUnitPrice",
		);

		if (!hasComputeUnitLimitInstruction) {
			this.instructions.unshift(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnit }));
		}

		if (!hasComputerUnitPriceInstruction) {
			const exactPriorityFeeSol = options?.exactPriorityFeeSol
				? BigNumber(options.exactPriorityFeeSol)
				: undefined;

			let priorityFeeInMicroLamports = BigInt(0);

			if (!exactPriorityFeeSol) {
				const priorityLevel: PriorityLevel = options?.priorityLevel
					? options.priorityLevel
					: "medium";

				const maxPriorityFeeSol = options?.maxPriorityFeeSol
					? options?.maxPriorityFeeSol
					: DEFAULT_MAX_PRIORITY_FEE;

				const maxPriorityFeePerCU = BigNumber(maxPriorityFeeSol)
					.times(LAMPORTS_PER_SOL)
					.minus(BASE_FEE_LAMPORTS)
					.div(computeUnit)
					.div(LAMPORTS_PER_MICRO_LAMPORT);
				// console.log("max priority fee per cu:", maxPriorityFeePerCU.toFixed());

				const priorityFeePerCU = await getRecentPriorityFee(
					this._connection,
					this.instructions,
					priorityLevel,
					maxPriorityFeePerCU,
				);
				// console.log("priority fee per cu:", priorityFeePerCU.toFixed());

				priorityFeeInMicroLamports = BigInt(priorityFeePerCU.toFixed(0, BigNumber.ROUND_DOWN));
			} else {
				priorityFeeInMicroLamports = BigInt(
					exactPriorityFeeSol
						.times(LAMPORTS_PER_SOL)
						.minus(BASE_FEE_LAMPORTS)
						.div(computeUnit)
						.div(LAMPORTS_PER_MICRO_LAMPORT)
						.toFixed(0, BigNumber.ROUND_DOWN),
				);
			}

			this.instructions.unshift(
				ComputeBudgetProgram.setComputeUnitPrice({
					microLamports: priorityFeeInMicroLamports,
				}),
			);
		}

		const { lastValidBlockHeight, blockhash } = await this._connection.getLatestBlockhash(options);

		const message = new TransactionMessage({
			instructions: this.instructions,
			payerKey: this.feePayer,
			recentBlockhash: blockhash, // Note: this blockhash will be replaced at the time of sign and send
		}).compileToV0Message(this.addressLookupTableAccounts);

		const transaction = new VersionedTransaction(message);

		if (this.signers && this.signers.length > 0) {
			transaction.sign(this.signers);
		}

		// sign transaction
		const signedTransaction = await this._signTransaction(transaction);

		try {
			const signatureBuffer = signedTransaction.signatures[0]!; // there must be at least one signature
			const signature = utils.bytes.bs58.encode(signatureBuffer);

			let confirmed = false;

			const sendTxMultiple = async () => {
				let blockheight = await this._connection.getBlockHeight(options);
				let retry = 0;

				const sendTransactionInterval = options?.sendTransactionInterval
					? options.sendTransactionInterval
					: DEFAULT_SEND_TRANSACTION_INTERVAL;

				const sendTransactionRetry = options?.maxSendTransactionRetries
					? options.maxSendTransactionRetries
					: Number.MAX_SAFE_INTEGER;

				while (!confirmed && blockheight < lastValidBlockHeight && retry < sendTransactionRetry) {
					try {
						await this._connection.sendRawTransaction(signedTransaction.serialize(), options);
						console.debug("Signatue sent: %s at %d", signature, Date.now());
						retry += 1;
						await sleep(sendTransactionInterval);
						blockheight = await this._connection.getBlockHeight(options);
					} catch (err: any) {
						if (err.message) {
							if (err.message.includes("This transaction has already been processed")) {
								return;
							} else if (err.message.includes("Blockhash not found")) {
								console.debug("Expected error: ", err.message);
								retry += 1;
								await sleep(sendTransactionInterval);
								blockheight = await this._connection.getBlockHeight(options);
								continue;
							} else {
								throw err;
							}
						}

						throw err;
					}
				}

				// Execution may not reach here
				if (!confirmed) {
					if (blockheight >= lastValidBlockHeight) {
						throw new Error("Blockheght exceeded.");
					}
				}
			};

			let startTime = Date.now();

			const confirmTransaction = async () => {
				let err: TransactionError | null = null;

				try {
					const response = await this._connection.confirmTransaction(
						{
							signature: signature,
							blockhash: blockhash,
							lastValidBlockHeight: lastValidBlockHeight,
						},
						options?.commitment,
					);

					err = response.value.err;

					if (!err) {
						const endTime = Date.now();
						console.debug("Confirmed at: %d", endTime);
						console.debug("Time elapsed: %d", endTime - startTime);
						confirmed = true;

						return;
					}

					if (err) {
						if (typeof err === "string") {
							console.debug("confirm transaction err: " + err);
							throw new Error("Failed to confirm transaction: " + err);
						} else {
							console.debug("confirm transaction err: " + JSON.stringify(err));
							throw new Error("Failed to confirm transaction");
						}
					}
				} catch (err: any) {
					throw err;
				}
			};

			await Promise.all([sendTxMultiple(), confirmTransaction()]);

			return signature;
		} catch (err: any) {
			// console.debug("error:", err);
			const translatedError = translateError(err, this._errors);
			console.debug("translated error:", translatedError);

			throw translatedError;
		}
	}
}
