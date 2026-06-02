export type AccountFailureStatus = 'NO_VIP' | 'ERROR';
export type AccountFailureCategory = {
    status: AccountFailureStatus;
    type: 'account_permission_error' | 'account_login_error' | 'account_unavailable';
    code: string;
};
export declare const classifyAccountFailure: (message: unknown) => AccountFailureCategory | null;
export declare const accountStatusForFailure: (message: unknown) => AccountFailureStatus;
//# sourceMappingURL=accountFailure.d.ts.map