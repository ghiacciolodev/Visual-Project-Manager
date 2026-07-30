package it.ghiacciolodev.vpm.project;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;

/**
 * Membership of a project, with a role.
 *
 * Roles are per project, not global: the same person can own one project and
 * only read another. This is what makes authorisation here worth writing —
 * a global "admin or not" flag would be a boolean, and Keycloak could have
 * carried it in the token.
 */
@Entity
@Table(name = "project_members")
@IdClass(ProjectMember.Key.class)
@Getter
@Setter
@NoArgsConstructor
public class ProjectMember {

    @Id
    @Column(name = "project_id")
    private Long projectId;

    @Id
    @Column(name = "user_id")
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ProjectRole role;

    @Column(name = "joined_at", nullable = false, insertable = false, updatable = false)
    private Instant joinedAt;

    /** Composite key: a person appears at most once per project. */
    public static class Key implements Serializable {
        private Long projectId;
        private Long userId;

        public Key() {
        }

        public Key(Long projectId, Long userId) {
            this.projectId = projectId;
            this.userId = userId;
        }

        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (!(o instanceof Key key)) return false;
            return Objects.equals(projectId, key.projectId)
                && Objects.equals(userId, key.userId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(projectId, userId);
        }
    }
}
