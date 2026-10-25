namespace Shop.Core.Catalog
{
    public class Item
    {
        public Item(ProductCode code, Money listPrice)
        {
            Code = code;
            ListPrice = listPrice;
        }

        public ProductCode Code { get; }

        public Money ListPrice { get; }
    }
}
