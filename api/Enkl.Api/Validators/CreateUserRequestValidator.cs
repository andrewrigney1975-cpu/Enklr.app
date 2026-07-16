using Enkl.Api.Domain;
using Enkl.Api.Dtos;
using FluentValidation;

namespace Enkl.Api.Validators;

/// <summary>ARCHITECTURE-REVIEW.md finding 2.5. Messages/behavior preserved exactly from
/// OrganisationService.CreateUserAsync's prior manual checks. The uniqueness check ("Username ...
/// already taken") stays in the service — it needs a live DB query, a cross-entity rule the review
/// explicitly carves out of this migration.</summary>
public class CreateUserRequestValidator : AbstractValidator<CreateUserRequest>
{
    public CreateUserRequestValidator()
    {
        RuleFor(x => x.DisplayName).Must(n => !string.IsNullOrWhiteSpace(n)).WithMessage("Please enter a display name.");
        RuleFor(x => x.Password).Must(p => !string.IsNullOrEmpty(p) && p.Length >= 8).WithMessage("Password must be at least 8 characters.");
        RuleFor(x => x.Username).Must(u => UsernameNormalizer.Normalize(u ?? "").Length > 0).WithMessage("Please enter a username.");
    }
}
