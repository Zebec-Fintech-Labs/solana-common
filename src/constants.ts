import { utils, web3 } from "@coral-xyz/anchor";
import BigNumber from "bignumber.js";

// Transaction timing constants (in milliseconds)
/**
 * Default delay between consecutive `sendRawTransaction` retries inside
 * {@link sendTransactionWithRetry}. 1s balances responsiveness against RPC
 * load — most clusters can absorb a 1Hz rebroadcast comfortably.
 */
export const DEFAULT_SEND_TRANSACTION_INTERVAL = 1000;

// Compute budget constants
/** Hard ceiling on compute units per transaction (Solana runtime limit). */
export const MAX_COMPUTE_UNIT = 1_400_000;
/** Per-signature base fee paid in lamports, independent of priority fee. */
export const BASE_FEE_LAMPORTS = 5000;
/** Conversion factor: 1 lamport = 1_000_000 micro-lamports. */
export const LAMPORTS_PER_MICRO_LAMPORT = 0.000001;
/**
 * Safety cap (SOL) on the total priority fee any single transaction is
 * allowed to budget when the caller doesn't specify `maxPriorityFeeSol`.
 * Prevents bursty network conditions from draining wallets.
 */
export const DEFAULT_MAX_PRIORITY_FEE = 0.001;

/** USDC Decimals = 6 */
export const USDC_DECIMALS = 6;

export const SOL_DECIMALS = 9;

/**
 * WSOL Mint Address
 */
export const WSOL = new web3.PublicKey(
	"So11111111111111111111111111111111111111112",
);

export const ZBCN = new web3.PublicKey(
	"ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU",
);

/** BigNumber Object for 10 */
export const TEN_BIGNUM = BigNumber(10);

export const UNITS_PER_USDC = TEN_BIGNUM.pow(USDC_DECIMALS);

/** Token Program ID */
export const TOKEN_PROGRAM_ID = utils.token.TOKEN_PROGRAM_ID;

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = utils.token.ASSOCIATED_PROGRAM_ID;

/** Memo Program ID */
export const MEMO_PROGRAM_ID = new web3.PublicKey(
	"MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);

/**
 * Approximate CU overhead the ComputeBudget program itself charges per
 * transaction. Added on top of the simulated `unitsConsumed` when sizing
 * the CU limit so the transaction doesn't run out of budget executing the
 * budget instructions.
 */
export const COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT = 400;
