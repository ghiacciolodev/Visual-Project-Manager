package it.ghiacciolodev.vpm.common.validation;

import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class DateRangeValidator implements ConstraintValidator<ValidDateRange, DateRange> {

    @Override
    public boolean isValid(DateRange value, ConstraintValidatorContext context) {
        // Null dates are @NotNull's problem, not ours. Reporting them here too
        // would produce two error messages for one mistake.
        if (value == null || value.startDate() == null || value.endDate() == null) {
            return true;
        }

        boolean valid = !value.endDate().isBefore(value.startDate());

        if (!valid) {
            // Attach the violation to the endDate field so the frontend can
            // highlight the right input instead of showing a form-wide error.
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(
                    context.getDefaultConstraintMessageTemplate())
                .addPropertyNode("endDate")
                .addConstraintViolation();
        }

        return valid;
    }
}
