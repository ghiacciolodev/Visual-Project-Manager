package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.task.DependencyGraphRepository;
import it.ghiacciolodev.vpm.task.Task;
import it.ghiacciolodev.vpm.task.TaskPriority;
import it.ghiacciolodev.vpm.task.TaskRepository;
import it.ghiacciolodev.vpm.task.TaskStatus;
import it.ghiacciolodev.vpm.user.User;
import org.springframework.stereotype.Component;

import java.time.LocalDate;

/**
 * Builds a starter project for a new account.
 *
 * This replaces the Flyway seed, which planted a project owned by a user with
 * no Keycloak account: nobody could sign in to it, so every real user landed
 * on an empty application while the demo data sat there unreachable.
 *
 * Sample content belongs in provisioning rather than in a migration for a
 * simpler reason too — a migration cannot know who is signing in, and "give
 * this person something to look at" is a question only the sign-in path can
 * answer.
 */
@Component
public class SampleProjectFactory {

    private final ProjectRepository projects;
    private final ProjectMemberRepository members;
    private final TaskRepository tasks;
    private final DependencyGraphRepository graph;

    public SampleProjectFactory(ProjectRepository projects,
                                ProjectMemberRepository members,
                                TaskRepository tasks,
                                DependencyGraphRepository graph) {
        this.projects = projects;
        this.members = members;
        this.tasks = tasks;
        this.graph = graph;
    }

    public Project createFor(User user) {
        Project project = new Project();
        project.setName("My Project");
        project.setDescription("A sample plan to get started");
        project.setCreatedBy(user.getId());

        Project saved = projects.save(project);

        ProjectMember membership = new ProjectMember();
        membership.setProjectId(saved.getId());
        membership.setUserId(user.getId());
        membership.setRole(ProjectRole.OWNER);
        members.save(membership);

        seedTasks(saved.getId());

        return saved;
    }

    /**
     * Four tasks, three of them in a chain and one standing alone.
     *
     * The shape is deliberate rather than decorative. The chain gives the
     * critical path something to find; the fourth task has no prerequisites
     * and a short duration, so it carries float and demonstrates the one thing
     * a task list cannot show — that some work can slip and some cannot.
     *
     * Dates are relative to today so the chart is always populated around the
     * present, whenever the account is created.
     */
    private void seedTasks(Long projectId) {
        LocalDate today = LocalDate.now();

        Task setup = create(projectId, "Set up the database",
            TaskStatus.DONE, TaskPriority.HIGH,
            today.minusDays(2), today.plusDays(2), "#C2410C");

        Task api = create(projectId, "Build the API",
            TaskStatus.DOING, TaskPriority.HIGH,
            today.plusDays(3), today.plusDays(11), "#1D4ED8");

        Task ui = create(projectId, "Build the interface",
            TaskStatus.TODO, TaskPriority.MEDIUM,
            today.plusDays(12), today.plusDays(22), "#15803D");

        create(projectId, "Write the documentation",
            TaskStatus.TODO, TaskPriority.LOW,
            today.plusDays(5), today.plusDays(6), "#7E22CE");

        graph.link(setup.getId(), api.getId());
        graph.link(api.getId(), ui.getId());
    }

    private Task create(Long projectId, String title,
                        TaskStatus status, TaskPriority priority,
                        LocalDate start, LocalDate end, String color) {

        Task task = new Task();
        task.setProjectId(projectId);
        task.setTitle(title);
        task.setStatus(status);
        task.setPriority(priority);
        task.setStartDate(start);
        task.setEndDate(end);
        task.setColor(color);

        return tasks.save(task);
    }
}
