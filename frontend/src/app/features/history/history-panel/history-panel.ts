import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output } from '@angular/core';

import { AuditService } from '../../../core/audit.service';
import { ProjectService } from '../../../core/project.service';
import { AuditEntry } from '../../../models/audit.model';

/** Entries grouped under the day they happened. */
interface DayGroup {
  label: string;
  entries: AuditEntry[];
}

@Component({
  selector: 'app-history-panel',
  templateUrl: './history-panel.html',
  styleUrl: './history-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryPanel implements OnInit {

  readonly audit = inject(AuditService);
  readonly projects = inject(ProjectService);

  readonly close = output<void>();

  /**
   * Grouped by day, newest first.
   *
   * A flat list of timestamps is hard to read at a glance and a change log is
   * almost always scanned rather than read — "what happened yesterday" is the
   * question, and a date heading answers it without arithmetic.
   */
  readonly days = computed<DayGroup[]>(() => {
    const groups: DayGroup[] = [];

    for (const entry of this.audit.entries()) {
      const label = this.dayLabel(entry.at);
      const current = groups[groups.length - 1];

      if (current && current.label === label) {
        current.entries.push(entry);
      } else {
        groups.push({ label, entries: [entry] });
      }
    }

    return groups;
  });

  ngOnInit(): void {
    void this.audit.load();
  }

  /** Time of day only — the date is already on the heading above. */
  timeOf(at: string): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  /**
   * Initials for the actor chip, matching the assignee on a task card.
   *
   * Falls back to the first two characters, which is the ordinary case for
   * somebody whose display name is still their email address.
   */
  initialsOf(name: string): string {
    const parts = name.trim().split(/[\s@._-]+/).filter(Boolean);
    return parts.length >= 2
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : name.trim().slice(0, 2).toUpperCase();
  }

  private dayLabel(at: string): string {
    const date = new Date(at);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

    if (sameDay(date, today)) return 'Today';
    if (sameDay(date, yesterday)) return 'Yesterday';

    return date.toLocaleDateString(undefined, {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }
}
