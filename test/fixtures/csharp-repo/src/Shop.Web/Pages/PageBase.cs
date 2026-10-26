namespace Shop.Web.Pages;

public abstract class PageBase<TModel>
    where TModel : class
{
    public abstract string Title { get; }

    public TModel? Model { get; set; }
}
