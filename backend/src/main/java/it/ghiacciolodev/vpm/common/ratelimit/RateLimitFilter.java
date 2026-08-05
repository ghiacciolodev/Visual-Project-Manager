package it.ghiacciolodev.vpm.common.ratelimit;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import io.github.bucket4j.Refill;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * A token bucket per caller, spent by writes.
 *
 * Reads are not limited. They cost a query and are what a person does by
 * simply having the page open; a limit low enough to stop abusive reading
 * would be low enough to interrupt someone switching between the schedule and
 * the chart. Writes are the ones that grow the database and fan out into
 * dependency and critical-path recalculation, so they are what is metered.
 *
 * Keyed by the token's subject rather than by IP. The API is authenticated,
 * so the subject is both known and stable — an office behind one NAT address
 * would otherwise share a single allowance between everybody in it. Requests
 * with no subject fall back to the remote address, which covers the sign-in
 * paths and anything malformed.
 *
 * The filter sits after Spring Security's chain so that the authentication is
 * already resolved. Ordering it earlier would mean every bucket keyed by IP.
 */
@Component
@Order(Integer.MAX_VALUE)
public class RateLimitFilter extends OncePerRequestFilter {

    private final RateLimitProperties properties;

    /**
     * One bucket per caller, held in memory.
     *
     * Never evicted, which is a deliberate limit rather than an oversight: the
     * key space is the set of people who have signed in, and a bucket is a
     * handful of bytes. It is the same reason this is not durable — a restart
     * forgives everybody, which for a burst limit is an acceptable trade and
     * for a quota would not be.
     */
    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();

    public RateLimitFilter(RateLimitProperties properties) {
        this.properties = properties;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        if (!properties.enabled()) {
            return true;
        }
        // Preflight carries no credentials and changes nothing.
        if (HttpMethod.OPTIONS.matches(request.getMethod())) {
            return true;
        }
        return !isWrite(request.getMethod());
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {

        ConsumptionProbe probe = bucketFor(callerKey(request)).tryConsumeAndReturnRemaining(1);

        // Stated on every response, not only on the refusal: a client that can
        // see its allowance draining can slow down before being told to.
        response.setHeader("X-RateLimit-Limit", String.valueOf(properties.capacity()));
        response.setHeader("X-RateLimit-Remaining",
            String.valueOf(Math.max(0, probe.getRemainingTokens())));

        if (probe.isConsumed()) {
            chain.doFilter(request, response);
            return;
        }

        // Rounded up, and never below one: a Retry-After of 0 invites an
        // immediate retry that is certain to fail again.
        long seconds = Math.max(1,
            Duration.ofNanos(probe.getNanosToWaitForRefill()).toSeconds());

        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setHeader(HttpHeaders.RETRY_AFTER, String.valueOf(seconds));
        response.setContentType(MediaType.APPLICATION_PROBLEM_JSON_VALUE);

        // Written directly rather than thrown. The exception handler runs
        // inside the dispatcher, and a filter that rejects a request never
        // reaches it — so the Problem Details shape is reproduced here to keep
        // one error format across the whole API.
        response.getWriter().write("""
            {"type":"about:blank","title":"Too many requests",\
            "status":429,"detail":"You are making changes faster than this \
            project allows. Try again in %d seconds."}""".formatted(seconds));
    }

    private Bucket bucketFor(String key) {
        return buckets.computeIfAbsent(key, ignored -> Bucket.builder()
            .addLimit(Bandwidth.classic(
                properties.capacity(),
                // Greedy: the allowance trickles back continuously rather than
                // all at once at the end of the window. An interval refill
                // lets a caller spend the whole bucket, wait, and spend it
                // again — twice the intended rate across the boundary.
                Refill.greedy(properties.capacity(), properties.period())))
            .build());
    }

    /** The token's subject, or the remote address when there is no token. */
    private String callerKey(HttpServletRequest request) {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();

        if (authentication instanceof JwtAuthenticationToken token
            && token.getToken().getSubject() != null) {
            return "sub:" + token.getToken().getSubject();
        }
        return "ip:" + request.getRemoteAddr();
    }

    private boolean isWrite(String method) {
        return HttpMethod.POST.matches(method)
            || HttpMethod.PUT.matches(method)
            || HttpMethod.PATCH.matches(method)
            || HttpMethod.DELETE.matches(method);
    }
}
