using Microsoft.Extensions.DependencyInjection;
using Shop.Core.Time;

namespace Shop.Web.Extensions;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddShop(this IServiceCollection services)
    {
        services.AddSingleton<IClock, SystemClock>();
        return services;
    }
}
