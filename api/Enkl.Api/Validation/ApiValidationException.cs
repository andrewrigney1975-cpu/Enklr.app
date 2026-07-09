namespace Enkl.Api.Validation;

/// <summary>Thrown for data-quality/business-rule problems in a request (cycles, etc.) — mapped to
/// 400 by the relevant controller, distinct from infrastructure/DB errors which fall through to the
/// generic exception-handler middleware in Program.cs.</summary>
public class ApiValidationException : Exception
{
    public ApiValidationException(string message) : base(message) { }
}
