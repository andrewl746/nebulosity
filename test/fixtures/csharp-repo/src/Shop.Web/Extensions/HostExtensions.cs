using Microsoft.Extensions.DependencyInjection;

namespace Shop.Web.Extensions;

public static class HostExtensions
{
    // AddShop is found through this file's own namespace: no using needed.
    public static IServiceCollection AddShopDefaults(this IServiceCollection services)
    {
        return services.AddShop();
    }
}
