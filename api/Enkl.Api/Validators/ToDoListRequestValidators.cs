using Enkl.Api.Dtos;
using FluentValidation;

namespace Enkl.Api.Validators;

/// <summary>ARCHITECTURE-REVIEW.md finding 2.5. Messages/behavior preserved exactly from
/// ToDoService.CreateListAsync/RenameListAsync's prior manual checks. Two DTOs, same rule and
/// message — kept in one file since both are this trivial and belong to the same feature.</summary>
public class CreateToDoListRequestValidator : AbstractValidator<CreateToDoListRequest>
{
    public CreateToDoListRequestValidator()
    {
        RuleFor(x => x.Title).Must(t => !string.IsNullOrWhiteSpace(t)).WithMessage("Please enter a list title.");
    }
}

public class UpdateToDoListRequestValidator : AbstractValidator<UpdateToDoListRequest>
{
    public UpdateToDoListRequestValidator()
    {
        RuleFor(x => x.Title).Must(t => !string.IsNullOrWhiteSpace(t)).WithMessage("Please enter a list title.");
    }
}
