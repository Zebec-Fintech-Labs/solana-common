# Zebec Solana Common

Shared TypeScript utilities used across Zebec's Solana SDKs. Provides
higher-level building blocks on top of `@solana/web3.js` and
`@coral-xyz/anchor` so application code doesn't have to re-implement common
patterns like priority-fee sizing, retry-aware sending, balance formatting,
or batch transaction execution.

## Features

- **`TransactionPayload`** — single-transaction pipeline: simulate, size
  compute units, attach priority fees, sign, send with retry, and confirm.
- **`MultiTransactionPayload`** — same pipeline applied to a batch of
  independent transactions, with per-transaction failure isolation
  (`Promise.allSettled` semantics).
- **`sendAndConfirm`** — coordinated send-retry + confirmation loop sharing
  a single `AbortController` so either side stops the other when done.
- **Error translation** — `parseSolanaSendTransactionError` normalises
  Anchor / program / Jupiter / insufficient-funds errors into a single
  human-readable `Error`.
- **Balance helpers** — `getSolBalance`, `getTokenBalances`,
  `getMintDecimals` (with process-wide caching).
- **Amount conversion** — `parseSol`/`formatSol`, `parseToken`/`formatToken`
  built on `BigNumber.js` for safe decimal handling.
- **Associated Token Account helpers** — `getAssociatedTokenAddressSync`,
  `createAssociatedTokenAccountInstruction`.
- **Priority fee calculation** — `getRecentPriorityFee` derives a per-CU
  fee from recent cluster activity with a low/medium/high multiplier and a
  hard cap.

## Installation

```bash
npm install @zebec-network/solana-common
```

## Quick start

### Send a single transaction

```ts
import { web3 } from "@coral-xyz/anchor";
import { TransactionPayload } from "@zebec-network/solana-common";

const connection = new web3.Connection(web3.clusterApiUrl("devnet"), "confirmed");
const wallet = web3.Keypair.generate(); // replace with your funded wallet

const transferIx = web3.SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: new web3.PublicKey("KjC2CMdFWrqULujEECU4W2fQhdZ36vXn3XA8u8DpHqD"),
    lamports: 0.001 * web3.LAMPORTS_PER_SOL,
});

const payload = new TransactionPayload(
    connection,
    new Map(),                            // IDL error map (empty for non-Anchor txs)
    {
        instructions: [transferIx],
        feePayer: wallet.publicKey,
    },
    async (tx) => {                       // signing callback
        if (tx instanceof web3.VersionedTransaction) {
            tx.sign([wallet]);
        } else {
            tx.sign(wallet);
        }
        return tx;
    },
);

const signature = await payload.execute({
    commitment: "confirmed",
    enablePriorityFee: true,
    priorityLevel: "medium",
});
console.log("https://solscan.io/tx/" + signature);
```

### Send a batch of independent transactions

```ts
import { MultiTransactionPayload } from "@zebec-network/solana-common";

const payload = new MultiTransactionPayload(
    connection,
    new Map(),
    transactionsData,   // array of { instructions, feePayer, signers?, addressLookupTableAccounts? }
    async (txs) => txs.map((tx) => { tx.sign([wallet]); return tx; }),
);

const results = await payload.execute({ commitment: "confirmed" });

for (const result of results) {
    if (result.status === "fulfilled") {
        console.log("ok:", result.value);
    } else {
        console.warn("failed:", result.reason);
        // result.transactionData and result.transaction are available for retry.
    }
}
```

## Usage

### Amount conversion

```ts
import { parseSol, formatSol, parseToken, formatToken } from "@zebec-network/solana-common";

parseSol("1.5");          // 1_500_000_000n
formatSol(1_500_000_000); // "1.5"

parseToken("1876.190996", 6); // 1_876_190_996n  (USDC has 6 decimals)
formatToken(1_876_190_996, 6); // "1876.190996"
```

All conversions are backed by `BigNumber.js`, so they don't lose precision
on values that would round-trip badly through JavaScript `number`.

### Balances

```ts
import { getSolBalance, getTokenBalances } from "@zebec-network/solana-common";

await getSolBalance(connection, wallet.publicKey);
// "1.234567890" (string in SOL, not lamports)

await getTokenBalances(connection, wallet.publicKey, [usdcMint, wsolMint]);
// { "<usdcMint>": "100.5", "<wsolMint>": "0" }
```

`getTokenBalances` returns `"0"` for mints whose Associated Token Account
doesn't exist yet — no thrown error.

### Associated Token Account helpers

```ts
import {
    getAssociatedTokenAddressSync,
    createAssociatedTokenAccountInstruction,
} from "@zebec-network/solana-common";

const ata = getAssociatedTokenAddressSync(mint, owner);
const ix  = createAssociatedTokenAccountInstruction(payer, ata, owner, mint);
```

### Priority fees

```ts
import BigNumber from "bignumber.js";
import { getRecentPriorityFee } from "@zebec-network/solana-common";

const feePerCU = await getRecentPriorityFee(
    connection,
    instructions,
    "medium",                  // "low" | "medium" | "high"
    BigNumber(50_000),         // cap (micro-lamports per CU)
);
```

`TransactionPayload` and `MultiTransactionPayload` call this internally
when `enablePriorityFee` is left at its default (`true`); use it directly
only if you need raw access to the calculation.

### Send-and-confirm protocol

```ts
import { sendAndConfirm } from "@zebec-network/solana-common";

const signature = await sendAndConfirm({
    connection,
    signedTransaction,       // already signed
    blockhash,
    lastValidBlockHeight,
    options: { commitment: "confirmed", skipPreflight: true },
});
```

Internally this races `sendTransactionWithRetry` and
`confirmTransactionWithTimeout` through a shared `AbortController` — when
confirmation resolves (success or failure) the send loop stops; when the
blockhash expires, both halves unwind together.

### Error translation

```ts
import { parseSolanaSendTransactionError } from "@zebec-network/solana-common";

try {
    await payload.execute({ commitment: "confirmed" });
} catch (err) {
    const friendly = parseSolanaSendTransactionError(err, idlErrors);
    console.error(friendly.message);
}
```

Recognises (in order):

1. Jupiter aggregator program errors
   (`JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4`) including slippage,
   exact-out mismatch, and insufficient funds.
2. Insufficient-SOL errors across the several wire-level shapes Solana
   uses.
3. Anchor `AnchorError` — formatted with program, code, origin.
4. Anchor `ProgramError` — formatted with program, code, message.
5. Fallback: `transactionMessage` if present, otherwise the translated
   error as-is.

Both `TransactionPayload.execute` and `MultiTransactionPayload.execute`
apply this translation automatically.

## API reference

### Payload classes

| Symbol | Description |
| --- | --- |
| `TransactionPayload` | Build / simulate / sign / send / confirm a single transaction. |
| `MultiTransactionPayload` | Same pipeline for a batch; isolates per-tx failures. |
| `SignTransactionFunction` | Async callback signature used by `TransactionPayload`. |
| `SignAllTransactionsFunction` | Bulk-sign callback used by `MultiTransactionPayload`. |
| `MultiTransactionPayloadExecuteReturn` | `PromiseSettledResult<string>` extended with the original input and built transaction. |

### Sending utilities

| Symbol | Description |
| --- | --- |
| `sendAndConfirm` | Race send + confirm via a shared `AbortController`. |
| `sendTransactionWithRetry` | Retry-aware `sendRawTransaction` loop. |
| `confirmTransactionWithTimeout` | Confirmation listener that aborts the paired sender on completion. |
| `TransactionExecutionOptions` | Union of `ConfirmOptions` and the priority-fee / retry knobs. |

### Balances and amounts

| Symbol | Description |
| --- | --- |
| `getSolBalance(connection, address, commitmentOrConfig?)` | SOL balance as a `string`. |
| `getTokenBalances(connection, address, tokenMints, allowOwnerOffCurve?, config?)` | `Record<mint, string>`; `"0"` for missing ATAs. |
| `getMintDecimals(connection, mint)` | Cached mint decimals. |
| `parseSol` / `formatSol` | SOL ↔ lamports. |
| `parseToken` / `formatToken` | Token ui amount ↔ base units. |

### Token helpers

| Symbol | Description |
| --- | --- |
| `getAssociatedTokenAddressSync` | Deterministic ATA derivation. |
| `createAssociatedTokenAccountInstruction` | Build the ATA-creation instruction. |

### Priority fee utilities

| Symbol | Description |
| --- | --- |
| `getRecentPriorityFee(connection, instructions, level, maxFeeCap)` | Sample recent fees, apply a level multiplier, cap. |
| `replaceNonZeroAndSortPrioritizationFeesAsc(fees)` | Filter NaN/zero fees and sort ascending. |
| `PriorityLevel` | `"low" \| "medium" \| "high"`. |

### Errors

| Symbol | Description |
| --- | --- |
| `parseSolanaSendTransactionError(err, idlErrors)` | Normalise a send/confirm error into a single `Error`. |
| `MultiTransactionSimulationError` | Aggregate error thrown by `MultiTransactionPayload.simulate`; carries per-index `simulationErrors`. |

### Constants

| Symbol | Value | Meaning |
| --- | --- | --- |
| `MAX_COMPUTE_UNIT` | `1_400_000` | Solana runtime CU ceiling. |
| `BASE_FEE_LAMPORTS` | `5000` | Per-signature base fee. |
| `DEFAULT_SEND_TRANSACTION_INTERVAL` | `1000` | Ms between `sendRawTransaction` retries. |
| `DEFAULT_MAX_PRIORITY_FEE` | `0.001` | Default cap (SOL) on priority-fee spend. |
| `COMPUTE_BUDGET_PROGRAM_COMPUTE_UNIT` | `400` | CU overhead of ComputeBudget itself. |
| `LAMPORTS_PER_MICRO_LAMPORT` | `0.000001` | Unit conversion. |
| `SOL_DECIMALS` / `USDC_DECIMALS` | `9` / `6` | Common mint decimals. |
| `WSOL`, `ZBCN` | `web3.PublicKey` | Well-known mint addresses. |
| `TOKEN_PROGRAM_ID`, `ASSOCIATED_TOKEN_PROGRAM_ID`, `MEMO_PROGRAM_ID` | `web3.PublicKey` | Program IDs. |

## Transaction execution options

`TransactionExecutionOptions` extends `web3.ConfirmOptions` with:

| Option | Type | Default | Effect |
| --- | --- | --- | --- |
| `enablePriorityFee` | `boolean` | `true` | Inject `SetComputeUnitLimit` + `SetComputeUnitPrice` (skipping either if already present in the instructions). |
| `priorityLevel` | `"low" \| "medium" \| "high"` | `"medium"` | Multiplier applied to the sampled median fee. |
| `maxPriorityFeeSol` | `number` | `0.001` | Cap on the priority fee, expressed in SOL. |
| `exactPriorityFeeSol` | `number` | — | Pay exactly this much SOL as priority fee. Overrides `priorityLevel` / `maxPriorityFeeSol`. |
| `sendTransactionInterval` | `number` | `1000` | Ms between `sendRawTransaction` retries. |
| `maxSendTransactionRetries` | `number` | `Number.MAX_SAFE_INTEGER` | Stop the retry loop after N attempts. |
| `confirmationTimeout` | `number` | — | Reserved for future use. |

## Testing

```bash
npm run test:single -- test/<file>.test.ts
```

Pure / unit-style tests run offline. Integration tests require environment
variables and run online:

| Var | Used by |
| --- | --- |
| `RPC_URL` | Mainnet integration tests. |
| `DEVNET_RPC_URL` | Devnet integration tests (most of the suite). |
| `MAINNET_SECRET_KEYS` / `DEVNET_SECRET_KEYS` | JSON array of bs58-encoded secret keys for the test wallets. The first two entries are used as funded sender / receiver. |

The devnet wallets need a small SOL balance for the transaction-sending
tests; the off-curve / validation tests don't.

## Building

```bash
npm run build       # rimraf ./dist && tsc
npm run format      # biome
```

The published artefact contains only the `dist/` directory; `main` is
`dist/index.js` and `types` is `dist/index.d.ts`.

## Repository

- [Issues](https://github.com/Zebec-Fintech-Labs/solana-common/issues)
- [Source](https://github.com/Zebec-Fintech-Labs/solana-common)

## License

[MIT](./LICENSE).
