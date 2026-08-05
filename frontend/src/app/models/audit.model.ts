export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type AuditEntityType = 'PROJECT' | 'TASK' | 'MEMBER' | 'DEPENDENCY';

/**
 * One line of history. Mirrors AuditEntryResponse.
 *
 * No actor id: the screen names people, and the API deliberately does not
 * hand out account ids on a read every member can make.
 */
export interface AuditEntry {
  id: number;
  actorName: string;
  entityType: AuditEntityType;
  entityId: number | null;
  action: AuditAction;
  summary: string;
  /** ISO instant, not a date. */
  at: string;
}
