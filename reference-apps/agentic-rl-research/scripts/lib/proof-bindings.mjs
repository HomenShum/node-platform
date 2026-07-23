import { createHash } from "node:crypto";

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sealReceipt(receipt) {
  return { ...receipt, receiptDigest: digest(receipt) };
}

export function verifyReceiptSeal(receipt, identity) {
  const { receiptDigest, ...unsigned } = receipt ?? {};
  return Boolean(receiptDigest)
    && receiptDigest === digest(unsigned)
    && receipt.applicationHash === identity.applicationHash
    && receipt.configHash === identity.configHash;
}
