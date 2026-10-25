using Shop.Web.Extensions;

var builder = WebApplication.CreateBuilder(args);
if (string.IsNullOrEmpty(builder.Environment.ApplicationName)) return;
builder.Services.AddShop();

var app = builder.Build();
app.MapGet("/", () => "Shop");
app.Run();
