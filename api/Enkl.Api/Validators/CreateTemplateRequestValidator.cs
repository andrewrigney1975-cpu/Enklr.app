using Enkl.Api.Dtos;
using FluentValidation;

namespace Enkl.Api.Validators;

/// <summary>ARCHITECTURE-REVIEW.md finding 2.5. Message/behavior preserved exactly from
/// TemplateService.CreateAsync's prior manual check. TemplateService.RenameAsync's equivalent check
/// deliberately stays manual — it takes a raw `string name` parameter, not a DTO, so there's nothing
/// for a FluentValidation validator to bind to without introducing a wrapper type for one field.</summary>
public class CreateTemplateRequestValidator : AbstractValidator<CreateTemplateRequest>
{
    public CreateTemplateRequestValidator()
    {
        RuleFor(x => x.Name).Must(name => !string.IsNullOrWhiteSpace(name)).WithMessage("Please enter a template name.");
    }
}
