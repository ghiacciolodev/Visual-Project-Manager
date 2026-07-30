package it.ghiacciolodev.vpm.common.exception;

import java.util.List;

/**
 * The request is well formed but conflicts with the current state of the
 * graph: a cycle, or a status transition the dependencies forbid.
 *
 * Deliberately not a 400. A 400 says "you sent something malformed"; this says
 * "what you sent is valid, but the world does not currently allow it". The
 * client's correct reaction is different in each case.
 */
public class ConflictException extends RuntimeException {

    /** Tasks responsible for the conflict, so the client can name them. */
    private final List<?> offenders;

    public ConflictException(String message) {
        this(message, List.of());
    }

    public ConflictException(String message, List<?> offenders) {
        super(message);
        this.offenders = offenders;
    }

    public List<?> getOffenders() {
        return offenders;
    }
}
