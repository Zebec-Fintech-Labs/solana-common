import assert from "node:assert";
import { describe, it } from "mocha";

import { sleep } from "../src";

describe("sleep", () => {
	it("should resolve after at least the given duration", async () => {
		const start = Date.now();
		await sleep(100);
		const elapsed = Date.now() - start;
		assert.ok(
			elapsed >= 95,
			`expected at least ~100ms, got ${elapsed}ms (some tolerance for timer jitter)`,
		);
	});

	it("should return a Promise that resolves to undefined", async () => {
		const result = await sleep(10);
		assert.strictEqual(result, undefined);
	});

	it("should not block the event loop", async () => {
		let immediateRan = false;
		const sleepPromise = sleep(50);
		setImmediate(() => {
			immediateRan = true;
		});
		await sleepPromise;
		assert.strictEqual(
			immediateRan,
			true,
			"setImmediate callback should fire while sleep is pending",
		);
	});
});
