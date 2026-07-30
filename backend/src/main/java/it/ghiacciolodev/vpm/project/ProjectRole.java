package it.ghiacciolodev.vpm.project;

/**
 * Mirrored by a CHECK constraint in V1__init.sql. Ordered from most to least
 * capable, so `compareTo` can express "at least an editor".
 */
public enum ProjectRole {
    OWNER,
    EDITOR,
    VIEWER;

    /** True when this role is at least as capable as the one required. */
    public boolean satisfies(ProjectRole required) {
        return this.ordinal() <= required.ordinal();
    }
}
