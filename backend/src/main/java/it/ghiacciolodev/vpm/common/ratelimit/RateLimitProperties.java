package it.ghiacciolodev.vpm.common.ratelimit;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * How many writes a caller may make, and how quickly the allowance returns.
 *
 * Configurable rather than hard-coded because the right number is a property
 * of the deployment, not of the code: a demo wants a limit low enough to be
 * demonstrable, and anything real wants one high enough never to be met by an
 * honest client.
 */
@ConfigurationProperties(prefix = "app.rate-limit")
public record RateLimitProperties(

    boolean enabled,

    /** Writes allowed in a burst, before the refill rate starts to bite. */
    int capacity,

    /** How long a fully spent bucket takes to refill. */
    Duration period
) {

    public RateLimitProperties {
        if (capacity <= 0) capacity = 60;
        if (period == null || period.isZero() || period.isNegative()) {
            period = Duration.ofMinutes(1);
        }
    }
}
