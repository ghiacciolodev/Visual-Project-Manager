package it.ghiacciolodev.vpm.user;

import it.ghiacciolodev.vpm.security.CurrentUser;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Who am I, according to this application?
 *
 * The frontend calls this once after signing in. It is also the request that
 * triggers provisioning, so a fresh account exists locally before any other
 * endpoint needs it to.
 */
@RestController
@RequestMapping("/api/v1/me")
public class MeController {

    private final CurrentUser currentUser;

    public MeController(CurrentUser currentUser) {
        this.currentUser = currentUser;
    }

    public record MeResponse(Long id, String email, String displayName) {
    }

    @GetMapping
    public MeResponse me() {
        User user = currentUser.require();
        return new MeResponse(user.getId(), user.getEmail(), user.getDisplayName());
    }
}
