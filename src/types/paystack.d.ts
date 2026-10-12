declare module '@paystack/inline-js' {
  export interface PaystackTransaction {
    reference: string;
    transaction: string;
    trans_date: string;
    status: string;
    amount: number;
  }

  export interface PaystackOptions {
    key: string;
    email: string;
    amount: number;
    currency?: string;
    ref?: string;
    channels?: string[];
    metadata?: Record<string, unknown>;
    onSuccess: (transaction: PaystackTransaction) => void;
    onCancel?: () => void;
    onBeforeClose?: () => void;
  }

  export default class PaystackPop {
    id: string;
    static isLoaded(): boolean;
    isLoaded(): boolean;
    newTransaction(options: PaystackOptions): void;
    resumeTransaction(reference: string): void;
    cancelTransaction(): void;
  }
}