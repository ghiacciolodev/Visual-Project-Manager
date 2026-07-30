/** Mirrors the backend's CriticalPathResponse. */

export interface TaskSchedule {
  taskId: number;
  title: string;
  duration: number;

  /** Day offsets from the project anchor, not dates. */
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;

  /** Days this task can slip before the project finishes later. */
  totalFloat: number;
  critical: boolean;

  plannedStart: string;
  plannedEnd: string;
  startsBeforePrerequisites: boolean;
}

export interface CriticalPath {
  projectStart: string | null;
  criticalDuration: number;
  earliestFinish: string | null;
  plannedFinish: string | null;
  slackInPlan: number;
  criticalPath: number[];
  tasks: TaskSchedule[];
}