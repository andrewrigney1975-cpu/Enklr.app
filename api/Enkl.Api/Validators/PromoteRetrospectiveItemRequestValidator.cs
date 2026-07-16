using Enkl.Api.Dtos;
using FluentValidation;

namespace Enkl.Api.Validators;

/// <summary>ARCHITECTURE-REVIEW.md finding 2.5. Message/behavior preserved exactly from
/// RetrospectiveService.PromoteItemAsync's prior manual check.</summary>
public class PromoteRetrospectiveItemRequestValidator : AbstractValidator<PromoteRetrospectiveItemRequest>
{
    public PromoteRetrospectiveItemRequestValidator()
    {
        RuleFor(x => x.Title).Must(t => !string.IsNullOrWhiteSpace(t)).WithMessage("Please enter a principle title.");
    }
}
