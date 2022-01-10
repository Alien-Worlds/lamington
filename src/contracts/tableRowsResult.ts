export interface TableRowsResult<T> {
	rows: Array<T>;
	more: boolean;
	next_key: string;
	next_key_bytes?: string;
}

export enum TransactionStatus {
	executed = 'executed',
}

export interface TransactionResponse {
	transaction_id: string;
	processed: {
		id: string;
		block_num: number;
		block_time: Date;
		receipt: { status: TransactionStatus; cpu_usage_us: number; net_usage_words: number };
		elapsed: number;
		net_usage: number;
		scheduled: boolean;
		action_traces: any[];
		failed_dtrx_trace: any;
	};
}
