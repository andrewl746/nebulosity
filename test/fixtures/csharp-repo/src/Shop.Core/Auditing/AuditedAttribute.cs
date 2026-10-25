using System;

namespace Shop.Core.Auditing;

/// <summary>Marks a page or an action whose use is written to the audit log.</summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method)]
public sealed class AuditedAttribute : Attribute
{
    public string? Reason { get; init; }
}
