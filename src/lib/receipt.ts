export function isFailedReceipt(receipt: any): boolean {
  const result = String(receipt?.txExecutionResultName ?? receipt?.txExecutionResult ?? "").toLowerCase();
  return result.includes("error") || result.includes("rollback") || result.includes("failed");
}
export function getReceiptFailureMessage(receipt: any): string | null {
  const result = receipt?.txExecutionResultName ?? receipt?.txExecutionResult;
  return result ? `GenLayer finalized the transaction, but contract execution returned ${String(result)}.` : null;
}
