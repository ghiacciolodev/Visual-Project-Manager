package it.ghiacciolodev.vpm.schedule;

import org.springframework.security.access.prepost.PreAuthorize;
import it.ghiacciolodev.vpm.common.exception.ConflictException;
import it.ghiacciolodev.vpm.schedule.dto.CriticalPathResponse;
import it.ghiacciolodev.vpm.schedule.dto.TaskSchedule;
import it.ghiacciolodev.vpm.task.DependencyGraphRepository;
import it.ghiacciolodev.vpm.task.Task;
import it.ghiacciolodev.vpm.task.TaskRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;

/**
 * Critical Path Method.
 *
 * Two passes over the dependency graph in topological order:
 *
 *   forward   — how early can each task start, given its prerequisites?
 *   backward  — how late can it start without delaying the project?
 *
 * The difference between those two answers is the task's total float. Tasks
 * with zero float form the critical path: every one of them delays the whole
 * project by exactly as much as it slips, which is the one thing a planner
 * most needs to know and the one thing a list of tasks cannot show.
 *
 * Everything here is arithmetic on in-memory maps. The graph is small enough
 * that fetching it once and walking it in Java beats asking the database for
 * each step, which is the opposite of the trade-off made for cycle detection.
 */
@Service
@Transactional(readOnly = true)
public class CriticalPathService {


    private final TaskRepository repository;
    private final DependencyGraphRepository graph;

    public CriticalPathService(TaskRepository repository, DependencyGraphRepository graph) {
        this.repository = repository;
        this.graph = graph;
    }

    @PreAuthorize("@access.canView(#projectId)")
    public CriticalPathResponse analyse(Long projectId) {

        List<Task> tasks =
            repository.findByProjectIdAndDeletedAtIsNullOrderByStartDateAsc(projectId);

        if (tasks.isEmpty()) {
            return CriticalPathResponse.empty();
        }

        Map<Long, Task> byId = new LinkedHashMap<>();
        for (Task task : tasks) {
            byId.put(task.getId(), task);
        }

        Map<Long, List<Long>> successors = new HashMap<>();
        Map<Long, List<Long>> predecessors = new HashMap<>();

        for (long[] edge : graph.findEdgesByProject(projectId)) {
            Long from = edge[0];
            Long to = edge[1];

            // An edge pointing at something outside this set is skipped rather
            // than trusted. Being defensive costs one line and keeps a stray
            // row from producing a nonsensical schedule.
            if (!byId.containsKey(from) || !byId.containsKey(to)) continue;

            successors.computeIfAbsent(from, key -> new ArrayList<>()).add(to);
            predecessors.computeIfAbsent(to, key -> new ArrayList<>()).add(from);
        }

        List<Long> order = topologicalOrder(byId.keySet(), successors, predecessors);

        /* --- forward pass: earliest possible ---------------------------- */

        Map<Long, Integer> earliestStart = new HashMap<>();
        Map<Long, Integer> earliestFinish = new HashMap<>();

        for (Long id : order) {
            int start = 0;
            for (Long predecessor : predecessors.getOrDefault(id, List.of())) {
                // max, not min: a task waits for its *last* prerequisite.
                start = Math.max(start, earliestFinish.get(predecessor));
            }
            earliestStart.put(id, start);
            earliestFinish.put(id, start + duration(byId.get(id)));
        }

        int criticalDuration = earliestFinish.values().stream()
            .mapToInt(Integer::intValue)
            .max()
            .orElse(0);

        /* --- backward pass: latest permissible -------------------------- */

        Map<Long, Integer> latestStart = new HashMap<>();
        Map<Long, Integer> latestFinish = new HashMap<>();

        // reversed() is Java 21's SequencedCollection. Walking the topological
        // order backwards guarantees every successor is solved before the task
        // that feeds it, which is what the backward pass requires.
        for (Long id : order.reversed()) {
            int finish = criticalDuration;
            for (Long successor : successors.getOrDefault(id, List.of())) {
                // min, not max: a task must finish before its *earliest*
                // successor has to start.
                finish = Math.min(finish, latestStart.get(successor));
            }
            latestFinish.put(id, finish);
            latestStart.put(id, finish - duration(byId.get(id)));
        }

        /* --- assemble --------------------------------------------------- */

        LocalDate projectStart = tasks.stream()
            .map(Task::getStartDate)
            .min(LocalDate::compareTo)
            .orElseThrow();

        LocalDate plannedFinish = tasks.stream()
            .map(Task::getEndDate)
            .max(LocalDate::compareTo)
            .orElseThrow();

        List<TaskSchedule> schedules = new ArrayList<>();

        for (Task task : tasks) {
            Long id = task.getId();
            int slack = latestStart.get(id) - earliestStart.get(id);

            boolean startsEarly = predecessors.getOrDefault(id, List.of()).stream()
                .map(byId::get)
                .anyMatch(p -> !task.getStartDate().isAfter(p.getEndDate()));

            schedules.add(new TaskSchedule(
                id,
                task.getTitle(),
                duration(task),
                earliestStart.get(id),
                earliestFinish.get(id),
                latestStart.get(id),
                latestFinish.get(id),
                slack,
                slack == 0,
                task.getStartDate(),
                task.getEndDate(),
                startsEarly
            ));
        }

        List<Long> criticalPath = schedules.stream()
            .filter(TaskSchedule::critical)
            .sorted(Comparator.comparingInt(TaskSchedule::earliestStart)
                .thenComparing(TaskSchedule::taskId))
            .map(TaskSchedule::taskId)
            .toList();

        // The anchor is day 0, so a project of N days ends on day N-1.
        LocalDate earliestFinishDate = projectStart.plusDays(criticalDuration - 1L);
        int plannedSpan = (int) ChronoUnit.DAYS.between(projectStart, plannedFinish) + 1;

        return new CriticalPathResponse(
            projectStart,
            criticalDuration,
            earliestFinishDate,
            plannedFinish,
            Math.max(0, plannedSpan - criticalDuration),
            criticalPath,
            schedules
        );
    }

    /**
     * Kahn's algorithm: repeatedly take a task whose prerequisites are all
     * already placed.
     *
     * If the queue empties before every task is placed, the remaining tasks
     * form a cycle. That should be impossible — edges are refused at insertion
     * time by the recursive reachability check — so reaching this branch means
     * the data was changed outside the API. Failing loudly is better than
     * returning a schedule computed from a graph that has no valid order.
     */
    private List<Long> topologicalOrder(Collection<Long> ids,
                                        Map<Long, List<Long>> successors,
                                        Map<Long, List<Long>> predecessors) {

        Map<Long, Integer> remaining = new HashMap<>();
        for (Long id : ids) {
            remaining.put(id, predecessors.getOrDefault(id, List.of()).size());
        }

        Deque<Long> ready = new ArrayDeque<>();
        for (Long id : ids) {
            if (remaining.get(id) == 0) ready.add(id);
        }

        List<Long> order = new ArrayList<>(ids.size());

        while (!ready.isEmpty()) {
            Long id = ready.poll();
            order.add(id);

            for (Long successor : successors.getOrDefault(id, List.of())) {
                if (remaining.merge(successor, -1, Integer::sum) == 0) {
                    ready.add(successor);
                }
            }
        }

        if (order.size() != ids.size()) {
            throw new ConflictException(
                "The dependency graph contains a cycle, so no schedule can be computed");
        }

        return order;
    }

    /** Inclusive: a task starting and ending on the same day lasts one day. */
    private int duration(Task task) {
        return (int) ChronoUnit.DAYS.between(task.getStartDate(), task.getEndDate()) + 1;
    }
}
