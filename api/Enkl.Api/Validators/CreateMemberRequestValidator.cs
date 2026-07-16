using Enkl.Api.Dtos;
using FluentValidation;

namespace Enkl.Api.Validators;

/// <summary>ARCHITECTURE-REVIEW.md finding 2.5. Message/behavior preserved exactly from
/// MemberService.CreateAsync's prior manual check — trimming/truncation still happen in the service
/// itself (this only rejects genuinely blank input, it doesn't sanitize).</summary>
public class CreateMemberRequestValidator : AbstractValidator<CreateMemberRequest>
{
    public CreateMemberRequestValidator()
    {
        RuleFor(x => x.Name).Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Please enter a name.");
    }
}
