using Enkl.Api.Dtos;
using Enkl.Api.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Enkl.Api.Controllers;

[ApiController]
[Authorize(Policy = "ProjectMember")]
[Route("api/projects/{projectId:guid}/documents")]
public class DocumentsController : ControllerBase
{
    private readonly DocumentService _documents;

    public DocumentsController(DocumentService documents)
    {
        _documents = documents;
    }

    [HttpPost]
    public async Task<IActionResult> Create(Guid projectId, CreateDocumentRequest request)
    {
        var result = await _documents.CreateAsync(projectId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpPut("{documentId:guid}")]
    public async Task<IActionResult> Update(Guid projectId, Guid documentId, UpdateDocumentRequest request)
    {
        var result = await _documents.UpdateAsync(projectId, documentId, request);
        return result is null ? NotFound() : Ok(result);
    }

    [HttpDelete("{documentId:guid}")]
    public async Task<IActionResult> Delete(Guid projectId, Guid documentId)
    {
        return await _documents.DeleteAsync(projectId, documentId) ? NoContent() : NotFound();
    }
}
