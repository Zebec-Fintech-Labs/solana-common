export class MultiTransactionSimulationError extends Error {
	name: string = "MultiTransactionSimulationError";
	simulationErrors: { index: number; error: any }[];

	constructor(message: string, simulationErrors: { index: number; error: any }[]) {
		super(message);
		this.simulationErrors = simulationErrors;
	}
}
