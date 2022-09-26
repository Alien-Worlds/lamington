import { rawListeners } from 'process';
const SortedMap = require('collections/sorted-map');

class StatsClass {
	private static instance: StatsClass;
	private stats: Map<string, number[]> = new SortedMap();
	private exitHandlerRegistered: boolean = false;

	private constructor() {}

	public static get Instance() {
		if (!this.instance) {
			this.instance = new this();
		}
		return this.instance;
	}
	private registerExitHandler() {
		process.on('exit', () => {
			console.log(this.summaryString);
		});
		process.on('SIGINT', () => {
			process.exit();
		});
		this.exitHandlerRegistered = true;
	}

	public logAction(action: string, duration: number) {
		if (!this.exitHandlerRegistered) {
			this.registerExitHandler();
		}
		if (!this.stats.has(action)) {
			// console.log(`stats does not have ${action}`);
			this.stats.set(action, [duration]);
		} else {
			// console.log(`stats already has ${action}, pushing ${duration}`);
			this.stats.get(action)!.push(duration);
		}
		// console.log(`Stats: ${this._stats.get(action)} median: ${this.median(action)}`);
	}

	public median(action: string) {
		if (!this.stats.has(action)) {
			return 0;
		}

		const times = this.stats.get(action)!;

		if (times.length === 1) {
			return times[0];
		}
		const sorted = times.sort((a, b) => a - b);
		const middle = Math.floor(sorted.length / 2);

		if (sorted.length % 2 == 0) {
			return (sorted[middle - 1] + sorted[middle]) / 2;
		} else {
			return sorted[middle];
		}
	}

	public average(action: string) {
		if (!this.stats.has(action)) {
			return 0;
		}
		const times = this.stats.get(action)!;
		return times.reduce((a, b) => a + b, 0) / times.length;
	}

	public get summary() {
		return Array.from(this.stats.entries()).map(([action, times]) => {
			return {
				action,
				median: this.median(action),
				average: this.average(action),
			};
		});
	}

	public get summaryString() {
		return (
			'\n\nStats:\n' +
			this.summary
				.map(
					({ action, median, average }) =>
						`${action.padEnd(26, ' ')} median: ${median} µs avergage: ${average} µs`
				)
				.join('\n')
		);
	}
}

export const Stats = StatsClass.Instance;
