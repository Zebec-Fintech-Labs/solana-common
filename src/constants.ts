import { BigNumber } from "bignumber.js";

import { utils, web3 } from "@coral-xyz/anchor";

// Transaction timing constants (in milliseconds)
export const DEFAULT_SEND_TRANSACTION_INTERVAL = 1000;

// Compute budget constants
export const MAX_COMPUTE_UNIT = 1_400_000;
export const BASE_FEE_LAMPORTS = 5000;
export const LAMPORTS_PER_MICRO_LAMPORT = 0.000001;
export const DEFAULT_MAX_PRIORITY_FEE = 0.001;

/** USDC Decimals = 6 */
export const USDC_DECIMALS = 6;

export const SOL_DECIMALS = 9;

/**
 * WSOL Mint Address
 */
export const WSOL = new web3.PublicKey("So11111111111111111111111111111111111111112");

export const ZBCN = new web3.PublicKey("ZBCNpuD7YMXzTHB2fhGkGi78MNsHGLRXUhRewNRm9RU");

/** BigNumber Object for 10 */
export const TEN_BIGNUM = BigNumber(10);

export const UNITS_PER_USDC = TEN_BIGNUM.pow(USDC_DECIMALS);

/** Token Program ID */
export const TOKEN_PROGRAM_ID = utils.token.TOKEN_PROGRAM_ID;

/** Associated Token Program ID */
export const ASSOCIATED_TOKEN_PROGRAM_ID = utils.token.ASSOCIATED_PROGRAM_ID;

/** Memo Program ID */
export const MEMO_PROGRAM_ID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

/** Compute units for the Compute Budget Program */
export const COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT = 400;
