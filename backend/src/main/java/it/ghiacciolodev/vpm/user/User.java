package it.ghiacciolodev.vpm.user;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.Instant;

/**
 * The application's record of a person. Maps the "users" table from V1.
 *
 * Deliberately thin: Keycloak owns identity — credentials, sessions, email
 * verification — and this row exists only so that project membership and
 * authorship have something local to point at. Duplicating profile fields here
 * would create two sources of truth for the same facts.
 */
@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Keycloak's `sub` claim: a UUID that never changes for the life of the
     * account. The link is made on this rather than on email or username,
     * both of which a person is free to change.
     */
    @Column(name = "keycloak_sub", unique = true, length = 64)
    private String keycloakSub;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof User other)) return false;
        return id != null && id.equals(other.getId());
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
