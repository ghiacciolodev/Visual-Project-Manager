package it.ghiacciolodev.vpm.common.validation;

import java.time.LocalDate;

/**
 * Implemented by any DTO carrying a date range. Java records satisfy this for
 * free: the accessors generated for components named startDate/endDate have
 * exactly these signatures.
 */
public interface DateRange {
    LocalDate startDate();
    LocalDate endDate();
}
