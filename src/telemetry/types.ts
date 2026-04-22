export interface QuotaData {
    model: string;
    percent: number;
    refreshTime: string;
}

export interface CreditInfo {
    balance: number;
    creditType: string;
}

export interface FullStatus {
    credits: CreditInfo | null;
    quotas: QuotaData[];
    /** The label of the model currently set as the active/primary model */
    activeModel: string | null;
}
