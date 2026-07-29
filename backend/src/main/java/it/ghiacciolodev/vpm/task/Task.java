package it.ghiacciolodev.vpm.task;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.Instant;
import java.time.LocalDate;

/**
 * Maps the "tasks" table from V1__init.sql.
 *
 * Note on foreign keys: project_id and assignee_id are mapped as plain Long
 * columns rather than @ManyToOne associations. There is no Project or User
 * entity yet — they arrive in phase 5 with authentication — and a bare id is
 * all the code needs until then. Promoting them to associations later is a
 * local change to this class, not a rewrite.
 */
@Entity
@Table(name = "tasks")
@Getter
@Setter
@NoArgsConstructor
public class Task {

    @Id
    // IDENTITY matches "BIGINT GENERATED ALWAYS AS IDENTITY" in the schema.
    // Do not use AUTO here: on PostgreSQL it would pick a sequence generator
    // and Hibernate would look for a sequence the schema does not define.
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "project_id", nullable = false)
    private Long projectId;

    @Column(nullable = false, length = 120)
    private String title;

    @Column(columnDefinition = "text")
    private String description;

    // STRING, never the ORDINAL default. ORDINAL persists the position of the
    // constant, so reordering the enum silently reinterprets every existing
    // row. It fails without an error, which is the worst kind of failure.
    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TaskStatus status = TaskStatus.TODO;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private TaskPriority priority = TaskPriority.MEDIUM;

    @Column(name = "start_date", nullable = false)
    private LocalDate startDate;

    @Column(name = "end_date", nullable = false)
    private LocalDate endDate;

    @Column(nullable = false, length = 7)
    private String color;

    @Column(name = "assignee_id")
    private Long assigneeId;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    // Soft delete marker. Rows are never physically removed: dependency rows
    // keep pointing at valid tasks, and a history view stays possible.
    @Column(name = "deleted_at")
    private Instant deletedAt;

    // equals/hashCode on the id only, and hashCode is a constant.
    //
    // This looks wrong and is deliberate. A JPA entity changes identity during
    // its life: before persist the id is null, after persist it is set. If
    // hashCode depended on the id, an entity added to a HashSet before saving
    // would land in the wrong bucket afterwards and become unfindable. Lombok's
    // @Data or @EqualsAndHashCode would generate exactly that bug.
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof Task other)) return false;
        return id != null && id.equals(other.getId());
    }

    @Override
    public int hashCode() {
        return getClass().hashCode();
    }
}
