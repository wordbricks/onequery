import { AUDIT_FAMILIES } from "@onequery/audit-contracts/audit";
import type { AuditFamily } from "@onequery/audit-contracts/audit";

type AuditCursor = {
  family: AuditFamily;
  familyActionId: string;
  startedAt: Date;
};

export function buildAuditFeedId(family: AuditFamily, familyActionId: string) {
  return `${family}:${familyActionId}`;
}
export function decodeAuditCursor(cursor: string): AuditCursor | null {
  const parts = cursor.split("|");
  if (parts.length !== 3) {
    return null;
  }

  const startedAtText = parts[0];
  const family = parts[1];
  const familyActionId = parts[2];
  if (!startedAtText || !family || !familyActionId) {
    return null;
  }

  const startedAt = new Date(startedAtText);

  if (
    Number.isNaN(startedAt.getTime()) ||
    !AUDIT_FAMILIES.includes(family as AuditFamily) ||
    familyActionId.length === 0
  ) {
    return null;
  }

  return {
    family: family as AuditFamily,
    familyActionId,
    startedAt,
  };
}

export function encodeAuditCursor(cursor: AuditCursor) {
  return `${cursor.startedAt.toISOString()}|${cursor.family}|${cursor.familyActionId}`;
}
