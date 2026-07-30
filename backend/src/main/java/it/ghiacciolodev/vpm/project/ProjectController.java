package it.ghiacciolodev.vpm.project;

import it.ghiacciolodev.vpm.project.dto.*;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/projects")
public class ProjectController {

    private final ProjectService service;

    public ProjectController(ProjectService service) {
        this.service = service;
    }

    @GetMapping
    public List<ProjectResponse> list() {
        return service.findMine();
    }

    @PostMapping
    public ProjectResponse create(@Valid @RequestBody CreateProjectRequest request) {
        return service.create(request);
    }

    @GetMapping("/{projectId}")
    public ProjectResponse get(@PathVariable Long projectId) {
        return service.findOne(projectId);
    }

    @DeleteMapping("/{projectId}")
    public ResponseEntity<Void> delete(@PathVariable Long projectId) {
        service.delete(projectId);
        return ResponseEntity.noContent().build();
    }

    /* --- membership ----------------------------------------------------- */

    @GetMapping("/{projectId}/members")
    public List<MemberResponse> members(@PathVariable Long projectId) {
        return service.listMembers(projectId);
    }

    @PostMapping("/{projectId}/members")
    public MemberResponse invite(@PathVariable Long projectId,
                                 @Valid @RequestBody InviteRequest request) {
        return service.invite(projectId, request);
    }

    @PatchMapping("/{projectId}/members/{userId}")
    public MemberResponse changeRole(@PathVariable Long projectId,
                                     @PathVariable Long userId,
                                     @Valid @RequestBody ChangeRoleRequest request) {
        return service.changeRole(projectId, userId, request);
    }

    @DeleteMapping("/{projectId}/members/{userId}")
    public ResponseEntity<Void> removeMember(@PathVariable Long projectId,
                                             @PathVariable Long userId) {
        service.removeMember(projectId, userId);
        return ResponseEntity.noContent().build();
    }
}
