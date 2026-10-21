import { useEffect, useState, type FormEvent } from 'react';
import { Minus, PackageCheck, Pill, Plus, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { authenticatedApiDownload, authenticatedApiRequest } from '../../../lib/auth-api.js';
import './PatientShopPage.css';

interface MarketplaceProduct {
  id: string;
  name: string;
  description: string | null;
  brand: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  unit: string;
  price: string;
  taxRate: string;
  currency: string;
  availableStock: number;
  imageUrl: string | null;
  category: { id: string; name: string } | null;
  store: { id: string; name: string };
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFee: string;
  minimumOrderValue: string;
}

interface ProductResponse {
  items: MarketplaceProduct[];
  total: number;
  page: number;
  totalPages: number;
}

interface CartLine {
  product: MarketplaceProduct;
  quantity: number;
}

interface CreatedOrder {
  orderNumber: string;
  total: string;
  currency: string;
}

type DeliveryMethod = 'PICKUP' | 'DELIVERY';

function restoreCart(): CartLine[] {
  try {
    const stored = window.localStorage.getItem('revaltrix_patient_shop_cart');
    const cart: unknown = stored ? JSON.parse(stored) : [];
    return Array.isArray(cart) ? cart as CartLine[] : [];
  } catch {
    return [];
  }
}

function money(amount: string | number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(Number(amount) || 0);
}

function ProductImage({ product }: { product: MarketplaceProduct }) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!product.imageUrl) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    void authenticatedApiDownload(`/v1/shop/patient/products/${product.id}/image`)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setImage(objectUrl);
      })
      .catch(() => setImage(null));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [product.id, product.imageUrl]);

  return image ? (
    <img className="patient-shop-product-image" src={image} alt={product.name} />
  ) : (
    <div className="patient-shop-product-image patient-shop-product-placeholder" aria-hidden="true">
      <Pill size={34} strokeWidth={1.5} />
    </div>
  );
}

export function PatientShopPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [catalogue, setCatalogue] = useState<ProductResponse | null>(null);
  const [cart, setCart] = useState<CartLine[]>(restoreCart);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [address, setAddress] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('PICKUP');
  const [order, setOrder] = useState<CreatedOrder | null>(null);

  useEffect(() => {
    window.localStorage.setItem('revaltrix_patient_shop_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void authenticatedApiRequest<ProductResponse>(
        `/v1/shop/patient/products?q=${encodeURIComponent(search.trim())}&page=${page}`,
        { signal: controller.signal },
      )
        .then(setCatalogue)
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(requestError instanceof Error ? requestError.message : 'Unable to load products.');
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, search ? 250 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [search, page]);

  const cartStore = cart[0]?.product.store;
  const cartProduct = cart[0]?.product;
  const subtotal = cart.reduce(
    (total, line) => total + Number(line.product.price) * line.quantity,
    0,
  );
  const taxTotal = cart.reduce(
    (total, line) => total + Number(line.product.price) * line.quantity * Number(line.product.taxRate) / 100,
    0,
  );
  const deliveryFee = deliveryMethod === 'DELIVERY' ? Number(cartProduct?.deliveryFee ?? 0) : 0;

  function addToCart(product: MarketplaceProduct): void {
    setError(null);
    setNotice(null);
    if (cartStore && cartStore.id !== product.store.id) {
      setError(`Your cart is from ${cartStore.name}. Place that order or empty your cart before shopping at another pharmacy.`);
      return;
    }
    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) => line.product.id === product.id
          ? { product, quantity: Math.min(line.quantity + 1, product.availableStock) }
          : line);
      }
      return [...current, { product, quantity: 1 }];
    });
    if (!cartStore) setDeliveryMethod(product.pickupEnabled ? 'PICKUP' : 'DELIVERY');
    setOrder(null);
  }

  function updateQuantity(productId: string, quantity: number): void {
    setCart((current) => current
      .map((line) => line.product.id === productId
        ? { ...line, quantity: Math.min(quantity, line.product.availableStock) }
        : line)
      .filter((line) => line.quantity > 0));
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cart.length) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await authenticatedApiRequest<CreatedOrder>('/v1/shop/patient/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail: customerEmail || undefined,
          deliveryMethod,
          ...(deliveryMethod === 'DELIVERY' && {
            deliveryAddress: { address: address.trim() },
          }),
          items: cart.map(({ product, quantity }) => ({ productId: product.id, quantity })),
        }),
      });
      setOrder(created);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setCustomerEmail('');
      setAddress('');
      setNotice('Your order was sent to the pharmacy. They will confirm fulfilment and payment arrangements.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to place your order.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="patient-shop-page" aria-label="Medical shop">
      <header className="patient-shop-heading">
        <div>
          <p className="patient-dashboard-eyebrow">PHARMACY MARKETPLACE</p>
          <h1>Medical shop</h1>
          <p>Shop non-prescription products from participating pharmacies.</p>
        </div>
        <div className="patient-shop-cart-count" aria-live="polite">
          <ShoppingBag size={18} aria-hidden="true" />
          <span>{cart.reduce((count, line) => count + line.quantity, 0)} in cart</span>
        </div>
      </header>

      {error ? <div className="patient-shop-message is-error" role="alert">{error}</div> : null}
      {notice ? <div className="patient-shop-message is-success" role="status">{notice}</div> : null}

      {order ? (
        <section className="patient-shop-order-success" aria-label="Order confirmation">
          <PackageCheck size={30} aria-hidden="true" />
          <div>
            <p className="patient-dashboard-eyebrow">ORDER PLACED</p>
            <h2>{order.orderNumber}</h2>
            <p>Total {money(order.total, order.currency)} · Payment is arranged with the pharmacy.</p>
          </div>
        </section>
      ) : null}

      <div className="patient-shop-layout">
        <div className="patient-shop-catalogue">
          <label className="patient-shop-search">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
              placeholder="Search medicines, brands or ingredients"
              aria-label="Search medical products"
            />
          </label>

          {loading ? (
            <div className="patient-shop-empty" role="status">Loading products…</div>
          ) : catalogue?.items.length ? (
            <>
              <div className="patient-shop-product-grid">
                {catalogue.items.map((product) => (
                  <article className="patient-shop-product" key={product.id}>
                    <ProductImage product={product} />
                    <div className="patient-shop-product-copy">
                      <p className="patient-shop-store">{product.store.name}</p>
                      <h2>{product.name}</h2>
                      <p className="patient-shop-product-detail">
                        {[product.brand, product.genericName, product.strength, product.dosageForm, product.packSize]
                          .filter(Boolean).join(' · ') || product.category?.name || 'Medical product'}
                      </p>
                      <p className="patient-shop-stock">{product.availableStock} {product.unit} available</p>
                      <div className="patient-shop-product-buy">
                        <strong>{money(product.price, product.currency)}</strong>
                        <button type="button" onClick={() => addToCart(product)} aria-label={`Add ${product.name} to cart`}>
                          <Plus size={17} aria-hidden="true" /> Add
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              {catalogue.totalPages > 1 ? (
                <nav className="patient-shop-pagination" aria-label="Product pages">
                  <button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
                  <span>Page {page} of {catalogue.totalPages}</span>
                  <button type="button" disabled={page >= catalogue.totalPages} onClick={() => setPage((current) => current + 1)}>Next</button>
                </nav>
              ) : null}
            </>
          ) : (
            <div className="patient-shop-empty">
              <Pill size={27} aria-hidden="true" />
              <h2>{search ? 'No matching products' : 'No products available right now'}</h2>
              <p>{search ? 'Try another medicine name, ingredient or brand.' : 'Participating pharmacies will list their available products here.'}</p>
            </div>
          )}
        </div>

        <aside className="patient-shop-checkout">
          <div className="patient-shop-checkout-heading">
            <div><p className="patient-dashboard-eyebrow">YOUR BASKET</p><h2>{cartStore?.name ?? 'Cart'}</h2></div>
            {cart.length ? (
              <button className="patient-shop-icon-button" type="button" onClick={() => setCart([])} aria-label="Empty cart" title="Empty cart">
                <Trash2 size={17} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {cart.length ? (
            <>
              <div className="patient-shop-cart-lines">
                {cart.map(({ product, quantity }) => (
                  <div className="patient-shop-cart-line" key={product.id}>
                    <div><strong>{product.name}</strong><span>{money(product.price, product.currency)}</span></div>
                    <div className="patient-shop-quantity">
                      <button type="button" onClick={() => updateQuantity(product.id, quantity - 1)} aria-label={`Remove one ${product.name}`}><Minus size={14} /></button>
                      <span>{quantity}</span>
                      <button type="button" disabled={quantity >= product.availableStock} onClick={() => updateQuantity(product.id, quantity + 1)} aria-label={`Add one ${product.name}`}><Plus size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
              <form className="patient-shop-order-form" onSubmit={(event) => void submitOrder(event)}>
                <fieldset>
                  <legend>Fulfilment</legend>
                  <div className="patient-shop-fulfilment-options">
                    {cartProduct?.pickupEnabled ? (
                      <label><input type="radio" name="fulfilment" checked={deliveryMethod === 'PICKUP'} onChange={() => setDeliveryMethod('PICKUP')} /> Pickup</label>
                    ) : null}
                    {cartProduct?.deliveryEnabled ? (
                      <label><input type="radio" name="fulfilment" checked={deliveryMethod === 'DELIVERY'} onChange={() => setDeliveryMethod('DELIVERY')} /> Delivery</label>
                    ) : null}
                  </div>
                </fieldset>
                {deliveryMethod === 'DELIVERY' ? (
                  <label>Delivery address<textarea required maxLength={200} value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Street, area and any useful directions" /></label>
                ) : null}
                <label>Full name<input required maxLength={200} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} /></label>
                <label>Phone number<input required maxLength={50} autoComplete="tel" type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} /></label>
                <label>Email <span>(optional)</span><input maxLength={320} autoComplete="email" type="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} /></label>
                <div className="patient-shop-totals">
                  <div><span>Subtotal</span><strong>{money(subtotal, cartProduct?.currency ?? 'KES')}</strong></div>
                  {taxTotal > 0 ? <div><span>Tax</span><strong>{money(taxTotal, cartProduct?.currency ?? 'KES')}</strong></div> : null}
                  {deliveryMethod === 'DELIVERY' ? <div><span>Delivery</span><strong>{money(deliveryFee, cartProduct?.currency ?? 'KES')}</strong></div> : null}
                  <div className="patient-shop-grand-total"><span>Estimated total</span><strong>{money(subtotal + taxTotal + deliveryFee, cartProduct?.currency ?? 'KES')}</strong></div>
                </div>
                {subtotal < Number(cartProduct?.minimumOrderValue ?? 0) ? (
                  <p className="patient-shop-minimum">Minimum order: {money(cartProduct?.minimumOrderValue ?? 0, cartProduct?.currency ?? 'KES')}</p>
                ) : null}
                <button className="patient-shop-place-order" type="submit" disabled={busy || subtotal < Number(cartProduct?.minimumOrderValue ?? 0)}>
                  {busy ? 'Sending order…' : 'Place order'}
                </button>
                <p className="patient-shop-payment-note">The pharmacy will confirm your order and payment arrangements.</p>
              </form>
            </>
          ) : (
            <div className="patient-shop-cart-empty"><ShoppingBag size={24} aria-hidden="true" /><p>Your cart is empty.</p></div>
          )}
        </aside>
      </div>
    </section>
  );
}