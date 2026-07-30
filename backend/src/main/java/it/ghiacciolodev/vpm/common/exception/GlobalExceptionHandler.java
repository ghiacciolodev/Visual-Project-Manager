package it.ghiacciolodev.vpm.common.exception;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.security.access.AccessDeniedException;
import java.util.HashMap;
import java.util.Map;

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
}
