using Shop.Web.Extensions;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddShop();

var app = builder.Build();
app.MapGet("/", () => "Shop");
app.Run();
