export type ProjectRole = 'OWNER' | 'EDITOR' | 'VIEWER';

/**
 * A project as this member sees it — hence myRole, which is a property of the
 * pairing rather than of the project. Used to decide which controls to show;
 * the server keeps its own copy to decide what to allow.
 */
export interface Project {
  id: number;
  name: string;
  description: string | null;
  myRole: ProjectRole;
}

export interface Member {
  userId: number;
  email: string;
  displayName: string;
  role: ProjectRole;
  /** False for someone invited by email who has never signed in. */
  signedUp: boolean;
}