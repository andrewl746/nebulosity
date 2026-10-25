namespace Shop.Shared;

internal static class Guard
{
    public static string NotBlank(string value)
    {
        return string.IsNullOrWhiteSpace(value) ? throw new System.ArgumentException("blank", nameof(value)) : value;
    }
}
