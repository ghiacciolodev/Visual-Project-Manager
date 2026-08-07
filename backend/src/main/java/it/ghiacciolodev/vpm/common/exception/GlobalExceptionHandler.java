package it.ghiacciolodev.vpm.common.exception;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.security.access.AccessDeniedException;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/**
 * Turns exceptions into RFC 9457 Problem Details.
 *
 * Two reasons this exists rather than letting Spring's defaults run:
 * consistency (every error has the same shape, so the Angular client parses
 * one format), and containment (no stack trace, no SQL fragment, no internal
 * class name reaches the client).
 */
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(NotFoundException.class)
    public ProblemDetail handleNotFound(NotFoundException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.NOT_FOUND);
        problem.setTitle("Resource not found");
        problem.setDetail(ex.getMessage());
        return problem;
    }

    @ExceptionHandler(ConflictException.class)
    public ProblemDetail handleConflict(ConflictException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Conflicting request");
        problem.setDetail(ex.getMessage());

        // The offending tasks travel with the error so the UI can say
        // "Blocked by: Database Setup" instead of a generic refusal.
        if (!ex.getOffenders().isEmpty()) {
            problem.setProperty("offenders", ex.getOffenders());
        }

        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidation(MethodArgumentNotValidException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.BAD_REQUEST);
        problem.setTitle("Validation failed");
        problem.setDetail("One or more fields are invalid");

        // Field-keyed map so the client can attach each message to its input
        // instead of dumping a single blob of text above the form.
        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors()
            .forEach(error -> errors.put(error.getField(), error.getDefaultMessage()));
        problem.setProperty("errors", errors);

        return problem;
    }

    /**
     * A member with insufficient rights. Distinct from the 404 a non-member
     * gets: this person can see the project, so telling them plainly that the
     * action needs a higher role is more useful than pretending nothing is
     * there.
     */
    @ExceptionHandler(AccessDeniedException.class)
    public ProblemDetail handleAccessDenied(AccessDeniedException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.FORBIDDEN);
        problem.setTitle("Not allowed");
        problem.setDetail("Your role in this project does not allow that.");
        return problem;
    }

    /**
     * Two writers reached the same row and the second lost.
     *
     * TaskService checks the version itself and refuses with a readable
     * sentence, so most stale writes never get this far. This catches the ones
     * that do: a genuine race, where both requests read the same version and
     * @Version stopped the second at the UPDATE. Same status and shape as the
     * checked refusal, because to the person at the keyboard it is the same
     * event.
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ProblemDetail handleOptimisticLock(ObjectOptimisticLockingFailureException ex) {
        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.CONFLICT);
        problem.setTitle("Conflicting request");
        problem.setDetail("Somebody else changed this while you were editing it. "
            + "Reload to see their version before saving yours.");
        return problem;
    }

    /**
     * Everything else.
     *
     * Without this, an unhandled exception leaves through Spring's default
     * error handling, which is the one path in the application that does not
     * produce Problem Details. A client written to parse one format then meets
     * a second one at precisely the moment things are going wrong.
     *
     * The message is deliberately empty of detail. The stack trace goes to the
     * log with an id, and the id goes to the client: enough to match the two
     * up, and nothing about what broke. `server.error.include-message: never`
     * exists for the same reason and would be undone by being helpful here.
     */
    @ExceptionHandler(Exception.class)
    public ProblemDetail handleAnythingElse(Exception ex) {
        // Spring's own MVC exceptions already know their status and already
        // carry a Problem Details body: a wrong method is a 405, an unreadable
        // body is a 400. Catching Exception without this line turns every one
        // of them into a 500, which is how a handler meant to make errors
        // consistent makes them wrong instead. Caught by the audit suite,
        // which asks a DELETE on a read-only endpoint for its 405.
        if (ex instanceof ErrorResponse response) {
            return response.getBody();
        }

        String reference = UUID.randomUUID().toString().substring(0, 8);

        log.error("Unhandled exception [{}]", reference, ex);

        ProblemDetail problem = ProblemDetail.forStatus(HttpStatus.INTERNAL_SERVER_ERROR);
        problem.setTitle("Unexpected error");
        problem.setDetail("Something went wrong on the server. "
            + "Quote reference " + reference + " if you report it.");
        problem.setProperty("reference", reference);
        return problem;
    }
}
