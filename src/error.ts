/**
 * Aggregate error thrown when one or more transactions fail simulation inside
 * `MultiTransactionPayload.simulate`. Carries the individual simulation
 * failures so callers can map them back to the original input transactions by
 * index.
 */
export class MultiTransactionSimulationError extends Error {
	name: string = "MultiTransactionSimulationError";
	/**
	 * Per-transaction simulation failures.
	 *
	 * - `index`: position of the failed transaction in the original
	 *   `transactionsData` array passed to `MultiTransactionPayload`.
	 * - `error`: the underlying error raised while simulating that transaction
	 *   (typed as `unknown` because it may be an `Error`, an Anchor/Program
	 *   error, or any other value thrown by the RPC client).
	 */
	simulationErrors: { index: number; error: unknown }[];

	/**
	 * @param message Human-readable summary of the aggregate failure. Used as
	 *   the underlying `Error.message`.
	 * @param simulationErrors List of per-transaction failures, each tagged
	 *   with the source transaction's index in the original input array.
	 */
	constructor(
		message: string,
		simulationErrors: { index: number; error: unknown }[],
	) {
		super(message);
		this.simulationErrors = simulationErrors;
	}
}
