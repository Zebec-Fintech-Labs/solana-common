export class MultiTransactionSimulationError extends Error {
	name: string = "MultiTransactionSimulationError";
	simulationErrors: { index: number; error: unknown }[];

	constructor(
		message: string,
		simulationErrors: { index: number; error: unknown }[],
	) {
		super(message);
		this.simulationErrors = simulationErrors;
	}
}
