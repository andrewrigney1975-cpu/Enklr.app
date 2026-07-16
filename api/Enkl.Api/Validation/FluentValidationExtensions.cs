using FluentValidation;

namespace Enkl.Api.Validation;

/// <summary>
/// ARCHITECTURE-REVIEW.md finding 2.5: the one call shape every FluentValidation adoption site uses —
/// runs the validator and throws the existing ApiValidationException (single message, matching every
/// other manual `if (...) throw new ApiValidationException(...)` check already in these services) on
/// the first failure, rather than surfacing FluentValidation's own ValidationException/multi-error
/// shape, which the global exception handler in Program.cs doesn't know about. Only the field-level
/// "is this request shape valid at all" checks moved to FluentValidation — cross-entity rules
/// (uniqueness, cycle detection, existence/ownership lookups) still live in the services themselves,
/// exactly as the review's own recommendation carves out.
/// </summary>
public static class FluentValidationExtensions
{
    public static async Task ValidateAndThrowApiExceptionAsync<T>(this IValidator<T> validator, T instance)
    {
        var result = await validator.ValidateAsync(instance);
        if (!result.IsValid)
        {
            throw new ApiValidationException(result.Errors[0].ErrorMessage);
        }
    }
}
