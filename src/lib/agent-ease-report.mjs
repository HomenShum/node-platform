const WRITE_BLOCKAGE_PATTERNS = [
  /\bno repository files were changed\b/i,
  /\bplease restart with write access\b/i,
  /\b(?:the )?workspace is read-only\b/i,
  /\b(?:unable|failed) to (?:edit|modify|write)(?: to)? (?:the )?(?:repository|workspace|files?)\b/i,
  /\bblocked (?:from|by) (?:editing|writing|the sandbox|permissions?)\b/i,
];

export function reportsWriteBlockage(report) {
  const text = String(report ?? "");
  return WRITE_BLOCKAGE_PATTERNS.some((pattern) => pattern.test(text));
}
