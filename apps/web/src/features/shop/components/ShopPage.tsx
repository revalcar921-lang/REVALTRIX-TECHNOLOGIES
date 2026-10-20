import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';
import { authenticatedApiRequest } from '../../../lib/auth-api.js';
import { ProductCataloguePage } from './ProductCataloguePage.js';
import { ShopPurchasesPage } from './ShopPurchasesPage.js';
import { ShopSuppliersPage } from './ShopSuppliersPage.js';
import { ShopOrdersPage } from './ShopOrdersPage.js';
import './ShopPage.css';

interface ShopSettings {
  storeName: string;
  acceptingOrders: boolean;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryFee: string;
  minimumOrderValue: string;
  currency: string;
}

interface PosCatalogProduct {
  id: string;
  name: string;
  brand: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  images: string[];
  sku: string;
  barcode: string | null;
  unit: string;
  price: string;
  taxRate: string;
  stockQuantity: number;
  reservedStock: number;
  prescriptionRequired: boolean;
}

interface ShopCategory {
  id: string;
  name: string;
  slug: string;
}

interface ProductBatch {
  id: string;
  batchNumber: string;
  quantity: number;
  remainingQuantity: number;
  expiryDate: string;
  supplierName: string | null;
  status: string;
}

interface ShopProduct {
  id: string;
  name: string;
  sku: string;
  price: string;
  stockQuantity: number;
  reservedStock: number;
  reorderLevel?: number | null;
  visibility: 'ONLINE' | 'IN_STORE_ONLY' | 'HIDDEN' | 'DISCONTINUED';
  category: ShopCategory | null;
  brand?: string | null;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  packSize?: string | null;
  images?: string[];
  barcode?: string | null;
  unit?: string;
  taxRate?: string;
  prescriptionRequired?: boolean;
}

interface ShopOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: string;
  currency: string;
  deliveryMethod: string;
  customerName: string;
  customerPhone: string;
  items: Array<{ productName: string; quantity: number }>;
}

interface ShopProductsResponse {
  items: ShopProduct[];
  totalPages: number;
}

interface PosBatch {
  id: string;
  batchNumber: string;
  expiryDate: string;
  availableQuantity: number;
}

interface PosProduct {
  id: string;
  name: string;
  brand: string | null;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  packSize: string | null;
  image: string | null;
  sku: string;
  barcode: string | null;
  unit: string;
  price: string;
  taxRate: string;
  prescriptionRequired: boolean;
  availableStock: number;
  nextBatch: PosBatch | null;
}

interface PosCartLine {
  product: PosProduct;
  batch: PosBatch;
  quantity: number;
  discountAmount: string;
}

type PosPaymentMethod = 'CASH' | 'MPESA_STK_PUSH' | 'CARD' | 'BANK_TRANSFER' | 'CREDIT_ACCOUNT';

interface PosSale {
  id: string;
  saleNumber: string;
  status: string;
  paymentStatus: string;
  currency: string;
  total: string;
  amountPaid: string;
  changeDue: string;
  customerName: string | null;
  customerPhone: string | null;
  createdAt: string;
  items: Array<{
    id: string;
    productName: string;
    sku: string;
    batchNumber: string;
    expiryDate: string;
    unit: string;
    quantity: number;
    unitPrice: string;
    discountAmount: string;
    lineTotal: string;
  }>;
}

interface HeldPosSale {
  id: string;
  createdAt: string;
  payload: {
    items: Array<{
      productId: string;
      batchId: string;
      quantity: number;
      unit: string | null;
      discountAmount: number;
    }>;
    customerName: string;
    customerPhone: string;
    discountAmount: number;
  };
}

const SHOP_TABS = [
  'Dashboard',
  'POS',
  'Products',
  'Inventory',
  'Batches & Expiry',
  'Orders',
  'Prescriptions',
  'Suppliers',
  'Purchases',
  'Customers',
  'Reports',
  'Settings',
] as const;

type ShopTab = (typeof SHOP_TABS)[number];

const EMPTY_SETTINGS: ShopSettings = {
  storeName: '',
  acceptingOrders: false,
  deliveryEnabled: false,
  pickupEnabled: true,
  deliveryFee: '0',
  minimumOrderValue: '0',
  currency: 'KES',
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The shop request failed.';
}

function roundMoney(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function ShopPage() {
  const [settings, setSettings] = useState<ShopSettings>(EMPTY_SETTINGS);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [categoryName, setCategoryName] = useState('');
  const [categorySlug, setCategorySlug] = useState('');
  const [product, setProduct] = useState({
    name: '',
    sku: '',
    price: '',
    stockQuantity: '0',
    categoryId: '',
    imageUrl: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);
  const [productBatches, setProductBatches] = useState<Record<string, ProductBatch[]>>({});
  const [loadingBatches, setLoadingBatches] = useState<string | null>(null);
  const [loadingBatchList, setLoadingBatchList] = useState(false);
  const [batchProductId, setBatchProductId] = useState('');
  const [activeTab, setActiveTab] = useState<ShopTab>('Dashboard');
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [inventoryPurchaseId, setInventoryPurchaseId] = useState<string | null>(null);
  const [inventoryPurchaseProductIds, setInventoryPurchaseProductIds] = useState<string[]>([]);
  const [inventoryPurchaseBatchIds, setInventoryPurchaseBatchIds] = useState<string[]>([]);
  const [posProducts, setPosProducts] = useState<PosProduct[]>([]);
  const [posBatches, setPosBatches] = useState<Record<string, PosBatch[]>>({});
  const [posSearch, setPosSearch] = useState('');
  const [posLoading, setPosLoading] = useState(false);
  const [posCart, setPosCart] = useState<PosCartLine[]>([]);
  const [posCustomerName, setPosCustomerName] = useState('');
  const [posCustomerPhone, setPosCustomerPhone] = useState('');
  const [posCustomerChoice, setPosCustomerChoice] = useState('');
  const [posDiscount, setPosDiscount] = useState('0');
  const [posPaymentMethod, setPosPaymentMethod] = useState<PosPaymentMethod>('CASH');
  const [posPaymentAmount, setPosPaymentAmount] = useState('');
  const [posPaymentReference, setPosPaymentReference] = useState('');
  const [posSplitEnabled, setPosSplitEnabled] = useState(false);
  const [posSplitMethod, setPosSplitMethod] = useState<PosPaymentMethod>('MPESA_STK_PUSH');
  const [posSplitAmount, setPosSplitAmount] = useState('0');
  const [posSplitReference, setPosSplitReference] = useState('');
  const [posHeldSales, setPosHeldSales] = useState<HeldPosSale[]>([]);
  const [showHeldSales, setShowHeldSales] = useState(false);
  const [showPrescriptionDialog, setShowPrescriptionDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [showReceiveBatchDialog, setShowReceiveBatchDialog] = useState(false);
  const [receiveProductId, setReceiveProductId] = useState('');
  const [receiveBatchNumber, setReceiveBatchNumber] = useState('');
  const [receiveExpiryDate, setReceiveExpiryDate] = useState('');
  const [receiveQuantity, setReceiveQuantity] = useState('1');
  const [receiveCostPrice, setReceiveCostPrice] = useState('0');
  const [receiveSupplierName, setReceiveSupplierName] = useState('');
  const [posSales, setPosSales] = useState<PosSale[]>([]);
  const [posRefundSaleId, setPosRefundSaleId] = useState('');
  const [posRefundReason, setPosRefundReason] = useState('');
  const [posReturnStock, setPosReturnStock] = useState(false);
  const [posBusy, setPosBusy] = useState(false);
  const [posNotice, setPosNotice] = useState<string | null>(null);
  const [posError, setPosError] = useState<string | null>(null);
  const [lastPosSale, setLastPosSale] = useState<PosSale | null>(null);
  const posSearchRef = useRef<HTMLInputElement>(null);
  const posCustomerRef = useRef<HTMLInputElement>(null);
  const posPaymentRef = useRef<HTMLSelectElement>(null);

  async function viewPurchaseInventory(purchaseId: string) {
    try {
      const purchase = await authenticatedApiRequest<{
        items: Array<{ productId: string }>;
        receipts: Array<{ items: Array<{ batch: { id: string } | null }> }>;
      }>(`/v1/shop/purchases/${purchaseId}`);
      const batchIds = purchase.receipts.flatMap((receipt) =>
        receipt.items.flatMap((item) => (item.batch ? [item.batch.id] : [])),
      );
      setInventoryPurchaseId(purchaseId);
      setInventoryPurchaseProductIds([...new Set(purchase.items.map((item) => item.productId))]);
      setInventoryPurchaseBatchIds(batchIds);
      setActiveTab(batchIds.length > 0 ? 'Batches & Expiry' : 'Inventory');
      if (purchase.items[0]) setBatchProductId(purchase.items[0].productId);
    } catch (requestError) {
      setError(errorText(requestError));
    }
  }

  async function load(): Promise<void> {
    setError(null);
    try {
      const [settingsResult, categoriesResult, productsResult, ordersResult] = await Promise.all([
        authenticatedApiRequest<ShopSettings | null>('/v1/shop/settings'),
        authenticatedApiRequest<ShopCategory[]>('/v1/shop/categories'),
        authenticatedApiRequest<ShopProductsResponse>('/v1/shop/products?page=1&pageSize=100'),
        authenticatedApiRequest<ShopOrder[]>('/v1/shop/orders'),
      ]);
      setSettings(settingsResult ?? EMPTY_SETTINGS);
      setCategories(categoriesResult);
      setProducts(productsResult.items);
      setBatchProductId((current) => current || productsResult.items[0]?.id || '');
      setOrders(ordersResult);
    } catch (requestError) {
      setError(errorText(requestError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (activeTab !== 'POS') {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(
      () => {
        setPosLoading(true);
        void authenticatedApiRequest<PosProduct[]>(
          `/v1/shop/pos/products/search?q=${encodeURIComponent(posSearch.trim())}`,
        )
          .then((results) => {
            if (!cancelled) setPosProducts(results);
          })
          .catch((requestError: unknown) => {
            if (!cancelled) setPosError(errorText(requestError));
          })
          .finally(() => {
            if (!cancelled) setPosLoading(false);
          });
      },
      posSearch ? 200 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeTab, posSearch]);

  useEffect(() => {
    if (activeTab !== 'POS') return;
    let cancelled = false;
    void authenticatedApiRequest<PosSale[]>('/v1/shop/pos/sales')
      .then((sales) => {
        if (!cancelled) setPosSales(sales);
      })
      .catch((requestError: unknown) => {
        if (!cancelled) setPosError(errorText(requestError));
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'POS') return;

    function handlePosShortcut(event: KeyboardEvent) {
      if (event.key === 'F2') {
        event.preventDefault();
        posCustomerRef.current?.focus();
      } else if (event.key === 'F3') {
        event.preventDefault();
        posSearchRef.current?.focus();
      } else if (event.key === 'F4') {
        event.preventDefault();
        setPosPaymentMethod('MPESA_STK_PUSH');
        posPaymentRef.current?.focus();
      } else if (event.key === 'F5') {
        event.preventDefault();
        setPosPaymentMethod('CASH');
        posPaymentRef.current?.focus();
      } else if (event.key === 'F8') {
        event.preventDefault();
        if (lastPosSale) window.print();
      } else if (event.key === 'F9') {
        event.preventDefault();
        void holdPosSale();
      } else if (event.key === 'F10') {
        event.preventDefault();
        void completePosSale();
      }
    }

    window.addEventListener('keydown', handlePosShortcut);
    return () => window.removeEventListener('keydown', handlePosShortcut);
  }, [
    activeTab,
    lastPosSale,
    posCart,
    posCustomerName,
    posCustomerPhone,
    posDiscount,
    posPaymentAmount,
    posPaymentMethod,
    posPaymentReference,
    posSplitAmount,
    posSplitEnabled,
    posSplitMethod,
    posSplitReference,
  ]);

  useEffect(() => {
    if (activeTab !== 'Batches & Expiry') {
      return;
    }

    if (!batchProductId || Object.hasOwn(productBatches, batchProductId)) {
      return;
    }

    let cancelled = false;
    setLoadingBatchList(true);
    void authenticatedApiRequest<ProductBatch[]>(`/v1/shop/products/${batchProductId}/batches`)
      .then((batches) => {
        if (!cancelled) {
          setProductBatches((current) => ({
            ...current,
            [batchProductId]: batches,
          }));
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(errorText(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBatchList(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, batchProductId, productBatches]);

  async function toggleBatches(productId: string) {
    if (expandedProductId === productId) {
      setExpandedProductId(null);
      return;
    }
    setExpandedProductId(productId);
    setLoadingBatches(productId);
    try {
      const batches = await authenticatedApiRequest<ProductBatch[]>(
        `/v1/shop/products/${productId}/batches`,
      );
      setProductBatches((prev) => ({ ...prev, [productId]: batches }));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoadingBatches(null);
    }
  }

  async function addPosProduct(product: PosProduct) {
    setPosError(null);
    try {
      const batches =
        posBatches[product.id] ??
        (await authenticatedApiRequest<PosBatch[]>(`/v1/shop/pos/batches/${product.id}`));
      setPosBatches((current) => ({ ...current, [product.id]: batches }));
      const batch = batches.find((candidate) => candidate.availableQuantity > 0);
      if (!batch) {
        setPosError(`No unexpired batch stock is available for ${product.name}.`);
        return;
      }
      setPosCart((current) => {
        const existing = current.find(
          (line) => line.product.id === product.id && line.batch.id === batch.id,
        );
        if (existing) {
          if (existing.quantity >= batch.availableQuantity) {
            setPosError(
              `Only ${batch.availableQuantity} units of batch ${batch.batchNumber} are available.`,
            );
            return current;
          }
          return current.map((line) =>
            line.product.id === product.id && line.batch.id === batch.id
              ? { ...line, quantity: line.quantity + 1 }
              : line,
          );
        }
        return [...current, { product, batch, quantity: 1, discountAmount: '0' }];
      });
    } catch (requestError) {
      setPosError(errorText(requestError));
    }
  }

  async function scanPosBarcode(code: string) {
    setPosError(null);
    const localMatch = posProducts.find(
      (item) =>
        item.barcode?.toLowerCase() === code.toLowerCase() ||
        item.sku.toLowerCase() === code.toLowerCase(),
    );
    if (localMatch) {
      await addPosProduct(localMatch);
      return;
    }
    try {
      const results = await authenticatedApiRequest<PosProduct[]>(
        `/v1/shop/pos/products/search?q=${encodeURIComponent(code)}`,
      );
      setPosProducts(results);
      const match = results.find(
        (item) =>
          item.barcode?.toLowerCase() === code.toLowerCase() ||
          item.sku.toLowerCase() === code.toLowerCase(),
      );
      if (match) {
        await addPosProduct(match);
      } else {
        setPosSearch(code);
        setPosError(`No exact barcode or SKU match found for "${code}".`);
      }
    } catch (requestError) {
      setPosError(errorText(requestError));
    }
  }

  function updatePosLine(
    productId: string,
    batchId: string,
    update: Partial<Pick<PosCartLine, 'quantity' | 'discountAmount' | 'batch'>>,
  ) {
    setPosCart((current) =>
      current.map((line) =>
        line.product.id === productId && line.batch.id === batchId ? { ...line, ...update } : line,
      ),
    );
  }

  async function changePosBatch(productId: string, currentBatchId: string, nextBatchId: string) {
    if (currentBatchId === nextBatchId) return;
    try {
      const batches =
        posBatches[productId] ??
        (await authenticatedApiRequest<PosBatch[]>(`/v1/shop/pos/batches/${productId}`));
      setPosBatches((current) => ({ ...current, [productId]: batches }));
      const nextBatch = batches.find((batch) => batch.id === nextBatchId);
      if (!nextBatch) {
        setPosError('That batch is expired or no longer available.');
        return;
      }
      const line = posCart.find(
        (item) => item.product.id === productId && item.batch.id === currentBatchId,
      );
      if (!line) return;
      const existingTargetLine = posCart.find(
        (item) => item.product.id === productId && item.batch.id === nextBatchId,
      );
      const combinedQuantity = line.quantity + (existingTargetLine?.quantity ?? 0);
      if (combinedQuantity > nextBatch.availableQuantity) {
        setPosError(`That batch has only ${nextBatch.availableQuantity} units available.`);
        return;
      }
      setPosCart((current) => {
        if (!existingTargetLine) {
          return current.map((item) =>
            item.product.id === productId && item.batch.id === currentBatchId
              ? { ...item, batch: nextBatch }
              : item,
          );
        }
        return current
          .filter((item) => !(item.product.id === productId && item.batch.id === currentBatchId))
          .map((item) =>
            item.product.id === productId && item.batch.id === nextBatchId
              ? { ...item, quantity: combinedQuantity }
              : item,
          );
      });
    } catch (requestError) {
      setPosError(errorText(requestError));
    }
  }

  function resetPos(clearReceipt = false) {
    setPosCart([]);
    setPosCustomerName('');
    setPosCustomerPhone('');
    setPosCustomerChoice('');
    setPosDiscount('0');
    setPosPaymentAmount('');
    setPosPaymentReference('');
    setPosSplitEnabled(false);
    setPosSplitMethod('MPESA_STK_PUSH');
    setPosSplitAmount('0');
    setPosSplitReference('');
    if (clearReceipt) setLastPosSale(null);
  }

  async function holdPosSale() {
    if (posCart.length === 0) {
      setPosError('Add at least one product before holding a sale.');
      return;
    }
    setPosBusy(true);
    setPosError(null);
    setPosNotice(null);
    try {
      await authenticatedApiRequest('/v1/shop/pos/hold', {
        method: 'POST',
        body: JSON.stringify({
          items: posCart.map((line) => ({
            productId: line.product.id,
            batchId: line.batch.id,
            quantity: line.quantity,
            unit: line.product.unit,
            discountAmount: Number(line.discountAmount),
          })),
          customerName: posCustomerName,
          customerPhone: posCustomerPhone,
          discountAmount: Number(posDiscount),
        }),
      });
      resetPos(true);
      setPosNotice('Sale held. It is available in Held Sales for this cashier.');
      if (showHeldSales) await loadHeldSales();
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function loadHeldSales() {
    setPosBusy(true);
    setPosError(null);
    try {
      const held = await authenticatedApiRequest<HeldPosSale[]>('/v1/shop/pos/held');
      setPosHeldSales(held);
      setShowHeldSales(true);
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function resumePosSale(heldSaleId: string) {
    setPosBusy(true);
    setPosError(null);
    try {
      const held = await authenticatedApiRequest<HeldPosSale['payload']>('/v1/shop/pos/resume', {
        method: 'POST',
        body: JSON.stringify({ heldSaleId }),
      });
      const firstPage = await authenticatedApiRequest<ShopProductsResponse>(
        '/v1/shop/products?page=1&pageSize=100',
      );
      const products: ShopProduct[] = [...firstPage.items];
      for (let nextPage = 2; nextPage <= firstPage.totalPages; nextPage += 1) {
        if (held.items.every((heldItem) => products.some(({ id }) => id === heldItem.productId))) {
          break;
        }
        const next = await authenticatedApiRequest<ShopProductsResponse>(
          `/v1/shop/products?page=${nextPage}&pageSize=100`,
        );
        products.push(...next.items);
      }
      const restored: PosCartLine[] = [];
      for (const item of held.items) {
        const catalogProduct = products.find((candidate) => candidate.id === item.productId);
        if (!catalogProduct) {
          throw new Error('A product in this held sale is no longer available.');
        }
        const posProduct: PosCatalogProduct = {
          id: catalogProduct.id,
          name: catalogProduct.name,
          brand: catalogProduct.brand ?? null,
          genericName: catalogProduct.genericName ?? null,
          strength: catalogProduct.strength ?? null,
          dosageForm: catalogProduct.dosageForm ?? null,
          packSize: catalogProduct.packSize ?? null,
          images: catalogProduct.images ?? [],
          sku: catalogProduct.sku,
          barcode: catalogProduct.barcode ?? null,
          unit: catalogProduct.unit ?? 'unit',
          price: catalogProduct.price,
          taxRate: catalogProduct.taxRate ?? '0',
          stockQuantity: catalogProduct.stockQuantity,
          reservedStock: catalogProduct.reservedStock,
          prescriptionRequired: catalogProduct.prescriptionRequired ?? false,
        };
        const batches = await authenticatedApiRequest<PosBatch[]>(
          `/v1/shop/pos/batches/${posProduct.id}`,
        );
        setPosBatches((current) => ({ ...current, [posProduct.id]: batches }));
        const batch =
          batches.find((candidate) => candidate.id === item.batchId) ??
          batches.find((candidate) => candidate.availableQuantity >= item.quantity);
        if (!batch) {
          throw new Error(`No available unexpired batch can fulfill ${posProduct.name}.`);
        }
        restored.push({
          product: {
            id: posProduct.id,
            name: posProduct.name,
            brand: posProduct.brand,
            genericName: posProduct.genericName,
            strength: posProduct.strength,
            dosageForm: posProduct.dosageForm,
            packSize: posProduct.packSize,
            image: posProduct.images[0] ?? null,
            sku: posProduct.sku,
            barcode: posProduct.barcode,
            unit: posProduct.unit,
            price: posProduct.price,
            taxRate: posProduct.taxRate,
            availableStock: posProduct.stockQuantity - posProduct.reservedStock,
            nextBatch: batch,
            prescriptionRequired: posProduct.prescriptionRequired,
          },
          batch,
          quantity: item.quantity,
          discountAmount: String(item.discountAmount),
        });
      }
      await authenticatedApiRequest('/v1/shop/pos/resume', {
        method: 'POST',
        body: JSON.stringify({ heldSaleId, consume: true }),
      });
      setPosCart(restored);
      setPosCustomerName(held.customerName ?? '');
      setPosCustomerPhone(held.customerPhone ?? '');
      setPosDiscount(String(held.discountAmount ?? 0));
      setShowHeldSales(false);
      setPosHeldSales((current) => current.filter((entry) => entry.id !== heldSaleId));
      setPosNotice('Held sale resumed. Review current batch availability before completing it.');
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function completePosSale() {
    if (posCart.length === 0) {
      setPosError('Add at least one product before completing a sale.');
      return;
    }
    for (const line of posCart) {
      if (line.quantity > line.batch.availableQuantity) {
        setPosError(
          `Batch ${line.batch.batchNumber} has only ${line.batch.availableQuantity} units available.`,
        );
        return;
      }
    }
    if (posCart.some((line) => line.product.prescriptionRequired)) {
      setPosError(
        'This cart contains prescription-only medicine. A verified prescription workflow is required before sale.',
      );
      return;
    }

    const subtotal = posCart.reduce(
      (sum, line) => sum + Number(line.product.price) * line.quantity - Number(line.discountAmount),
      0,
    );
    const discount = Number(posDiscount);
    const taxTotal = posCart.reduce(
      (sum, line) =>
        sum +
        roundMoney(
          (Math.max(0, Number(line.product.price) * line.quantity - Number(line.discountAmount)) *
            Number(line.product.taxRate)) /
            100,
        ),
      0,
    );
    const total = roundMoney(Math.max(0, subtotal - discount + taxTotal));
    const firstPayment = Number(posPaymentAmount || total.toFixed(2));
    const payments = posSplitEnabled
      ? [
          {
            method: posPaymentMethod,
            amount: Number(Math.max(0, total - Number(posSplitAmount)).toFixed(2)),
            reference: posPaymentReference || undefined,
          },
          {
            method: posSplitMethod,
            amount: Number(posSplitAmount),
            reference: posSplitReference || undefined,
          },
        ].filter((payment) => payment.amount > 0)
      : [
          {
            method: posPaymentMethod,
            amount: firstPayment,
            reference: posPaymentReference || undefined,
          },
        ];

    setPosBusy(true);
    setPosError(null);
    setPosNotice(null);
    try {
      const sale = await authenticatedApiRequest<PosSale>('/v1/shop/pos/sale', {
        method: 'POST',
        body: JSON.stringify({
          items: posCart.map((line) => ({
            productId: line.product.id,
            batchId: line.batch.id,
            quantity: line.quantity,
            unit: line.product.unit,
            discountAmount: Number(line.discountAmount),
          })),
          payments,
          discountAmount: discount,
          customerName: posCustomerName || undefined,
          customerPhone: posCustomerPhone || undefined,
        }),
      });
      setLastPosSale(sale);
      setPosSales((current) =>
        [sale, ...current.filter((entry) => entry.id !== sale.id)].slice(0, 50),
      );
      resetPos();
      setPosNotice(
        sale.paymentStatus === 'PENDING'
          ? `Sale ${sale.saleNumber} completed. Payment is pending confirmation.`
          : `Sale ${sale.saleNumber} completed.`,
      );
      await load();
      setPosSearch('');
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function openRefundDialog() {
    setPosBusy(true);
    setPosError(null);
    try {
      const sales = await authenticatedApiRequest<PosSale[]>('/v1/shop/pos/sales');
      setPosSales(sales.filter((sale) => sale.status === 'COMPLETED'));
      setPosRefundSaleId('');
      setPosRefundReason('');
      setPosReturnStock(false);
      setShowRefundDialog(true);
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function submitPosRefund(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPosBusy(true);
    setPosError(null);
    try {
      await authenticatedApiRequest('/v1/shop/pos/refund', {
        method: 'POST',
        body: JSON.stringify({
          saleId: posRefundSaleId,
          reason: posRefundReason,
          returnStock: posReturnStock,
        }),
      });
      setShowRefundDialog(false);
      setPosNotice(
        'Refund recorded. Complete the customer payment through the original payment channel.',
      );
      await load();
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  async function submitReceiveBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPosBusy(true);
    setPosError(null);
    try {
      await authenticatedApiRequest('/v1/shop/pos/batches/receive', {
        method: 'POST',
        body: JSON.stringify({
          productId: receiveProductId,
          batchNumber: receiveBatchNumber,
          expiryDate: receiveExpiryDate,
          quantity: Number(receiveQuantity),
          costPrice: Number(receiveCostPrice),
          supplierName: receiveSupplierName || undefined,
        }),
      });
      setPosBatches((current) => {
        const updated = { ...current };
        delete updated[receiveProductId];
        return updated;
      });
      setShowReceiveBatchDialog(false);
      setPosNotice('Batch received. Inventory and the stock movement ledger were updated.');
      await load();
      setPosSearch('');
    } catch (requestError) {
      setPosError(errorText(requestError));
    } finally {
      setPosBusy(false);
    }
  }

  function sendPosReceiptOnWhatsApp(sale: PosSale) {
    const message = [
      `${settings.storeName || 'Pharmacy'} receipt ${sale.saleNumber}`,
      ...sale.items.map(
        (item) => `${item.productName} x${item.quantity}: ${sale.currency} ${item.lineTotal}`,
      ),
      `Total: ${sale.currency} ${sale.total}`,
      `Payment: ${sale.paymentStatus}`,
    ].join('\n');
    const phone = sale.customerPhone?.replace(/\D/g, '');
    window.open(
      `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(message)}`,
      '_blank',
      'noopener,noreferrer',
    );
  }

  async function submit(
    path: string,
    method: 'POST' | 'PATCH',
    body: unknown,
    successMessage: string,
  ): Promise<boolean> {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await authenticatedApiRequest(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setNotice(successMessage);
      await load();
      return true;
    } catch (requestError) {
      setError(errorText(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  }

  const posSubtotal = posCart.reduce(
    (sum, line) => sum + Number(line.product.price) * line.quantity - Number(line.discountAmount),
    0,
  );
  const posTaxTotal = posCart.reduce((sum, line) => {
    const netLine = Math.max(
      0,
      Number(line.product.price) * line.quantity - Number(line.discountAmount),
    );
    return sum + roundMoney((netLine * Number(line.product.taxRate)) / 100);
  }, 0);
  const posDiscountTotal =
    Number(posDiscount) + posCart.reduce((sum, line) => sum + Number(line.discountAmount), 0);
  const posTotal = roundMoney(Math.max(0, posSubtotal - Number(posDiscount) + posTaxTotal));
  const posTendered = posSplitEnabled
    ? Math.max(0, posTotal - Number(posSplitAmount)) + Number(posSplitAmount)
    : Number(posPaymentAmount || posTotal.toFixed(2));
  const posChange =
    posPaymentMethod === 'CASH' && !posSplitEnabled ? Math.max(0, posTendered - posTotal) : 0;

  if (loading) {
    return (
      <div
        className="shop-container"
        style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}
      >
        <p>Loading shop & inventory suite...</p>
      </div>
    );
  }

  return (
    <main className="shop-container">
      <header className="shop-header">
        <div className="shop-title">
          <h1>Shop & Inventory Suite</h1>
          <p>Manage catalogue items, FEFO batch expiry, and customer orders.</p>
        </div>
        <div className="shop-actions">
          <button className="shop-btn secondary" onClick={() => void load()} type="button">
            Refresh
          </button>
          <button
            className="shop-btn"
            style={{ background: settings.acceptingOrders ? '#ef4444' : '#16a34a', color: '#fff' }}
            onClick={() =>
              void submit(
                '/v1/shop/settings',
                'PATCH',
                {
                  storeName: settings.storeName,
                  acceptingOrders: settings.acceptingOrders,
                  deliveryEnabled: settings.deliveryEnabled,
                  pickupEnabled: settings.pickupEnabled,
                  deliveryFee: Number(settings.deliveryFee),
                  minimumOrderValue: Number(settings.minimumOrderValue),
                  currency: settings.currency,
                },
                settings.acceptingOrders ? 'Orders paused.' : 'Store is now accepting orders.',
              )
            }
            type="button"
          >
            {settings.acceptingOrders ? 'Pause Orders' : 'Open Store'}
          </button>
        </div>
      </header>

      <nav aria-label="Shop sections" className="shop-tabs">
        {SHOP_TABS.map((tab) => (
          <button
            aria-current={activeTab === tab ? 'page' : undefined}
            className={`shop-tab${activeTab === tab ? ' is-active' : ''}`}
            key={tab}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tab}
          </button>
        ))}
      </nav>

      {error && <div className="shop-alert is-error">{error}</div>}
      {notice && <div className="shop-alert is-success">{notice}</div>}

      {activeTab === 'Dashboard' && (
        <>
          <section className="shop-dashboard-cards" aria-label="Shop overview">
            <article className="shop-metric">
              <span>Products loaded</span>
              <strong>{products.length}</strong>
            </article>
            <article className="shop-metric">
              <span>Units in loaded products</span>
              <strong>{products.reduce((total, item) => total + item.stockQuantity, 0)}</strong>
            </article>
            <article className="shop-metric">
              <span>Reserved in loaded products</span>
              <strong>{products.reduce((total, item) => total + item.reservedStock, 0)}</strong>
            </article>
            <article className="shop-metric">
              <span>Orders</span>
              <strong>{orders.length}</strong>
            </article>
            <article className="shop-metric">
              <span>Pending orders</span>
              <strong>{orders.filter((order) => order.status === 'PENDING').length}</strong>
            </article>
            <article className="shop-metric">
              <span>Categories</span>
              <strong>{categories.length}</strong>
            </article>
          </section>
          <section className="shop-panel">
            <h2>Quick access</h2>
            <div className="shop-quick-actions">
              {(['Products', 'Inventory', 'Batches & Expiry', 'Orders', 'Settings'] as const).map(
                (tab) => (
                  <button
                    className="shop-btn secondary"
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    type="button"
                  >
                    {tab}
                  </button>
                ),
              )}
            </div>
          </section>
        </>
      )}

      {activeTab === 'Products' && <ProductCataloguePage initialSupplierId={selectedSupplierId} />}
      {activeTab === 'Purchases' && (
        <ShopPurchasesPage
          initialSupplierId={selectedSupplierId}
          onViewInventory={(purchaseId) => void viewPurchaseInventory(purchaseId)}
        />
      )}
      {activeTab === 'Suppliers' && (
        <ShopSuppliersPage
          onCreatePurchase={(supplierId) => {
            setSelectedSupplierId(supplierId);
            setActiveTab('Purchases');
          }}
          onViewProducts={(supplierId) => {
            setSelectedSupplierId(supplierId);
            setActiveTab('Products');
          }}
        />
      )}

      {false && activeTab === 'Products' && (
        <>
          <div className="shop-grid">
            <section className="shop-panel" style={{ marginBottom: 0 }}>
              <h2>
                Categories <span>{categories.length}</span>
              </h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(
                    '/v1/shop/categories',
                    'POST',
                    { name: categoryName, slug: categorySlug },
                    'Category created.',
                  ).then((saved) => {
                    if (saved) {
                      setCategoryName('');
                      setCategorySlug('');
                    }
                  });
                }}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr auto',
                  gap: '10px',
                  marginBottom: '16px',
                }}
              >
                <input
                  className="shop-input"
                  placeholder="Name"
                  required
                  value={categoryName}
                  onChange={(e) => setCategoryName(e.target.value)}
                />
                <input
                  className="shop-input"
                  placeholder="slug"
                  required
                  value={categorySlug}
                  onChange={(e) => setCategorySlug(e.target.value)}
                />
                <button className="shop-btn primary" disabled={saving} type="submit">
                  Add
                </button>
              </form>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  maxHeight: '140px',
                  overflowY: 'auto',
                }}
              >
                {categories.map((cat) => (
                  <li
                    key={cat.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 0',
                      borderBottom: '1px solid #f1f5f9',
                      fontSize: '13px',
                    }}
                  >
                    <span>{cat.name}</span>
                    <code>{cat.slug}</code>
                  </li>
                ))}
              </ul>
            </section>

            <section className="shop-panel" style={{ marginBottom: 0 }}>
              <h2>Add Product</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(
                    '/v1/shop/products',
                    'POST',
                    {
                      name: product.name,
                      sku: product.sku,
                      price: Number(product.price),
                      stockQuantity: Number(product.stockQuantity),
                      categoryId: product.categoryId || undefined,
                      images: product.imageUrl ? [product.imageUrl] : [],
                      visibility: 'ONLINE',
                    },
                    'Product added.',
                  ).then((saved) => {
                    if (saved)
                      setProduct({
                        name: '',
                        sku: '',
                        price: '',
                        stockQuantity: '0',
                        categoryId: '',
                        imageUrl: '',
                      });
                  });
                }}
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}
              >
                <input
                  className="shop-input"
                  placeholder="Product name"
                  required
                  value={product.name}
                  onChange={(e) => setProduct({ ...product, name: e.target.value })}
                />
                <input
                  className="shop-input"
                  placeholder="SKU"
                  required
                  value={product.sku}
                  onChange={(e) => setProduct({ ...product, sku: e.target.value })}
                />
                <input
                  className="shop-input"
                  placeholder="Price"
                  type="number"
                  step="0.01"
                  required
                  value={product.price}
                  onChange={(e) => setProduct({ ...product, price: e.target.value })}
                />
                <input
                  className="shop-input"
                  placeholder="Initial stock"
                  type="number"
                  required
                  value={product.stockQuantity}
                  onChange={(e) => setProduct({ ...product, stockQuantity: e.target.value })}
                />
                <button
                  className="shop-btn success"
                  disabled={saving}
                  type="submit"
                  style={{ gridColumn: 'span 2' }}
                >
                  Save Product
                </button>
              </form>
            </section>
          </div>

          <section className="shop-panel">
            <h2>
              Product Inventory & FEFO Batches <span>{products.length}</span>
            </h2>
            <div className="shop-table-wrap">
              <table className="shop-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th>Price</th>
                    <th>Stock</th>
                    <th>Visibility</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((item) => {
                    const isExpanded = expandedProductId === item.id;
                    const batches = productBatches[item.id] ?? [];
                    return (
                      <Fragment key={item.id}>
                        <tr>
                          <td style={{ fontWeight: 600 }}>{item.name}</td>
                          <td>
                            <code>{item.sku}</code>
                          </td>
                          <td>{item.price}</td>
                          <td>
                            <strong>{item.stockQuantity - item.reservedStock}</strong> /{' '}
                            {item.stockQuantity}
                          </td>
                          <td>{item.visibility}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="shop-btn secondary"
                              style={{ padding: '4px 10px', fontSize: '12px', marginRight: '6px' }}
                              onClick={() => void toggleBatches(item.id)}
                              type="button"
                            >
                              {isExpanded ? 'Hide Batches' : 'Batches'}
                            </button>
                            <button
                              className="shop-btn secondary"
                              style={{ padding: '4px 10px', fontSize: '12px' }}
                              onClick={() =>
                                void submit(
                                  '/v1/shop/products/' + item.id,
                                  'PATCH',
                                  {
                                    visibility: item.visibility === 'ONLINE' ? 'HIDDEN' : 'ONLINE',
                                  },
                                  'Visibility updated.',
                                )
                              }
                              type="button"
                            >
                              {item.visibility === 'ONLINE' ? 'Hide' : 'List'}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr>
                            <td colSpan={6} style={{ background: '#f8fafc', padding: '16px' }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  fontSize: '12px',
                                  marginBottom: '8px',
                                  color: '#334155',
                                }}
                              >
                                FEFO Batch Tracking (First-Expired, First-Out)
                              </div>
                              {loadingBatches === item.id ? (
                                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                                  Loading batches...
                                </p>
                              ) : batches.length === 0 ? (
                                <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
                                  No active batches registered.
                                </p>
                              ) : (
                                <table className="shop-table" style={{ background: '#fff' }}>
                                  <thead>
                                    <tr>
                                      <th>Batch #</th>
                                      <th>Remaining / Initial</th>
                                      <th>Expiry Date</th>
                                      <th>Status</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {batches.map((b) => (
                                      <tr key={b.id}>
                                        <td>
                                          <code>{b.batchNumber}</code>
                                        </td>
                                        <td>
                                          {b.remainingQuantity} / {b.quantity}
                                        </td>
                                        <td>{new Date(b.expiryDate).toLocaleDateString()}</td>
                                        <td>{b.status}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {activeTab === 'Inventory' && (
        <section className="shop-panel">
          <h2>
            Inventory by product{' '}
            <span>
              {inventoryPurchaseId
                ? products.filter((item) => inventoryPurchaseProductIds.includes(item.id)).length
                : products.length}
            </span>
          </h2>
          {inventoryPurchaseId && (
            <p className="shop-helper">
              Showing products received on purchase {inventoryPurchaseId}.{' '}
              <button
                className="shop-btn secondary"
                onClick={() => {
                  setInventoryPurchaseId(null);
                  setInventoryPurchaseProductIds([]);
                }}
                type="button"
              >
                Clear purchase filter
              </button>
            </p>
          )}
          <div className="shop-table-wrap">
            <table className="shop-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th>On hand</th>
                  <th>Reserved</th>
                  <th>Available</th>
                  <th>Reorder level</th>
                </tr>
              </thead>
              <tbody>
                {products
                  .filter(
                    (item) => !inventoryPurchaseId || inventoryPurchaseProductIds.includes(item.id),
                  )
                  .map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>
                        <code>{item.sku}</code>
                      </td>
                      <td>{item.stockQuantity}</td>
                      <td>{item.reservedStock}</td>
                      <td>{item.stockQuantity - item.reservedStock}</td>
                      <td>{item.reorderLevel ?? 'Not set'}</td>
                    </tr>
                  ))}
                {products.filter(
                  (item) => !inventoryPurchaseId || inventoryPurchaseProductIds.includes(item.id),
                ).length === 0 && (
                  <tr>
                    <td className="shop-empty" colSpan={6}>
                      No product inventory is available yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="shop-helper">
            Counts are returned by the live product API. Stock receiving, adjustment, and transfer
            actions are not available in the current backend.
          </p>
        </section>
      )}

      {activeTab === 'Batches & Expiry' && (
        <section className="shop-panel">
          <h2>
            Batches & expiry{' '}
            <span>
              {
                (productBatches[batchProductId] ?? []).filter(
                  (batch) =>
                    inventoryPurchaseBatchIds.length === 0 ||
                    inventoryPurchaseBatchIds.includes(batch.id),
                ).length
              }
            </span>
          </h2>
          {inventoryPurchaseId && inventoryPurchaseBatchIds.length > 0 && (
            <p className="shop-helper">
              Showing stock batches received on purchase {inventoryPurchaseId}.{' '}
              <button
                className="shop-btn secondary"
                onClick={() => {
                  setInventoryPurchaseId(null);
                  setInventoryPurchaseProductIds([]);
                  setInventoryPurchaseBatchIds([]);
                }}
                type="button"
              >
                Clear purchase filter
              </button>
            </p>
          )}
          {products.length > 0 && (
            <div className="shop-batch-controls">
              <label>
                Product
                <select
                  className="shop-input"
                  value={batchProductId}
                  onChange={(event) => setBatchProductId(event.target.value)}
                >
                  {products.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} ({item.sku})
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="shop-btn secondary"
                onClick={() =>
                  setProductBatches((current) => {
                    const updated = { ...current };
                    delete updated[batchProductId];
                    return updated;
                  })
                }
                type="button"
              >
                Refresh batches
              </button>
            </div>
          )}
          {loadingBatchList ? (
            <p>Loading batches from the product batch API...</p>
          ) : (
            <div className="shop-table-wrap">
              <table className="shop-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Batch</th>
                    <th>Expiry date</th>
                    <th>Days remaining</th>
                    <th>Quantity</th>
                    <th>Supplier</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(productBatches[batchProductId] ?? [])
                    .filter(
                      (batch) =>
                        inventoryPurchaseBatchIds.length === 0 ||
                        inventoryPurchaseBatchIds.includes(batch.id),
                    )
                    .map((batch) => {
                      const daysRemaining = Math.ceil(
                        (new Date(batch.expiryDate).getTime() - Date.now()) / 86_400_000,
                      );
                      return (
                        <tr key={batch.id}>
                          <td>
                            {products.find((item) => item.id === batchProductId)?.name ?? '—'}
                          </td>
                          <td>
                            <code>{batch.batchNumber}</code>
                          </td>
                          <td>{new Date(batch.expiryDate).toLocaleDateString()}</td>
                          <td>{daysRemaining}</td>
                          <td>
                            {batch.remainingQuantity} / {batch.quantity}
                          </td>
                          <td>{batch.supplierName ?? '—'}</td>
                          <td>{batch.status}</td>
                        </tr>
                      );
                    })}
                  {!loadingBatchList &&
                    (productBatches[batchProductId] ?? []).filter(
                      (batch) =>
                        inventoryPurchaseBatchIds.length === 0 ||
                        inventoryPurchaseBatchIds.includes(batch.id),
                    ).length === 0 && (
                      <tr>
                        <td className="shop-empty" colSpan={7}>
                          No batches have been recorded for these products.
                        </td>
                      </tr>
                    )}
                </tbody>
              </table>
            </div>
          )}
          <p className="shop-helper">
            Batch records and expiry dates are loaded from the live batch API. Clearance, returns,
            write-off, and alert workflows are not available in the current backend.
          </p>
        </section>
      )}

      {activeTab === 'Orders' && <ShopOrdersPage />}

      {activeTab === 'Settings' && (
        <section className="shop-panel">
          <h2>Store settings</h2>
          <form
            className="shop-settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(
                '/v1/shop/settings',
                'PATCH',
                {
                  storeName: settings.storeName,
                  acceptingOrders: settings.acceptingOrders,
                  deliveryEnabled: settings.deliveryEnabled,
                  pickupEnabled: settings.pickupEnabled,
                  deliveryFee: Number(settings.deliveryFee),
                  minimumOrderValue: Number(settings.minimumOrderValue),
                  currency: settings.currency,
                },
                'Store settings saved.',
              );
            }}
          >
            <label>
              Shop name
              <input
                className="shop-input"
                maxLength={200}
                required
                value={settings.storeName}
                onChange={(event) => setSettings({ ...settings, storeName: event.target.value })}
              />
            </label>
            <label>
              Currency
              <input
                className="shop-input"
                maxLength={3}
                minLength={3}
                required
                value={settings.currency}
                onChange={(event) =>
                  setSettings({ ...settings, currency: event.target.value.toUpperCase() })
                }
              />
            </label>
            <label>
              Delivery fee
              <input
                className="shop-input"
                min="0"
                step="0.01"
                type="number"
                value={settings.deliveryFee}
                onChange={(event) => setSettings({ ...settings, deliveryFee: event.target.value })}
              />
            </label>
            <label>
              Minimum order amount
              <input
                className="shop-input"
                min="0"
                step="0.01"
                type="number"
                value={settings.minimumOrderValue}
                onChange={(event) =>
                  setSettings({ ...settings, minimumOrderValue: event.target.value })
                }
              />
            </label>
            <label className="shop-checkbox">
              <input
                checked={settings.deliveryEnabled}
                type="checkbox"
                onChange={(event) =>
                  setSettings({ ...settings, deliveryEnabled: event.target.checked })
                }
              />
              Accept delivery orders
            </label>
            <label className="shop-checkbox">
              <input
                checked={settings.pickupEnabled}
                type="checkbox"
                onChange={(event) =>
                  setSettings({ ...settings, pickupEnabled: event.target.checked })
                }
              />
              Accept pickup orders
            </label>
            <label className="shop-checkbox">
              <input
                checked={settings.acceptingOrders}
                type="checkbox"
                onChange={(event) =>
                  setSettings({ ...settings, acceptingOrders: event.target.checked })
                }
              />
              Store is accepting orders
            </label>
            <button className="shop-btn primary" disabled={saving} type="submit">
              Save settings
            </button>
          </form>
          <p className="shop-helper">
            These fields are backed by the existing Shop settings API. Printer, payment provider,
            branch, and compliance configuration are not available yet.
          </p>
        </section>
      )}

      {activeTab === 'POS' && (
        <>
          <div className="shop-pos-feedback" aria-live="polite">
            {posError && (
              <div className="shop-alert is-error" role="alert">
                {posError}
              </div>
            )}
            {posNotice && (
              <div className="shop-alert is-success" role="status">
                {posNotice}
              </div>
            )}
          </div>
          <div className="shop-pos-toolbar">
            <div>
              <strong>{settings.storeName || 'Pharmacy POS'}</strong>
              <span> FEFO batch selection · online transaction processing</span>
            </div>
            <div className="shop-pos-toolbar-actions">
              <button
                className="shop-btn secondary"
                disabled={products.length === 0 || posBusy}
                onClick={() => {
                  setReceiveProductId(products[0]?.id ?? '');
                  setReceiveBatchNumber('');
                  setReceiveExpiryDate('');
                  setReceiveQuantity('1');
                  setReceiveCostPrice('0');
                  setReceiveSupplierName('');
                  setShowReceiveBatchDialog(true);
                }}
                type="button"
              >
                Receive Batch
              </button>
              <button
                className="shop-btn secondary"
                disabled={posBusy}
                onClick={() => void loadHeldSales()}
                type="button"
              >
                Held Sales
              </button>
              <button
                className="shop-btn secondary"
                disabled={posBusy || posCart.length === 0}
                onClick={() => {
                  if (window.confirm('Clear all items and customer details from this sale?')) {
                    resetPos(true);
                    setPosError(null);
                    setPosNotice(null);
                  }
                }}
                type="button"
              >
                Clear Cart
              </button>
              <button
                className="shop-btn secondary"
                disabled={posBusy}
                onClick={() => void openRefundDialog()}
                type="button"
              >
                Refund / Return
              </button>
            </div>
          </div>

          <div className="shop-pos-layout">
            <section className="shop-panel shop-pos-search">
              <h2>Find products</h2>
              <label className="shop-pos-field">
                Barcode scanner
                <input
                  className="shop-input shop-barcode-input"
                  placeholder="Scan barcode, then press Enter"
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    const code = event.currentTarget.value.trim();
                    if (!code) return;
                    event.currentTarget.value = '';
                    void scanPosBarcode(code);
                  }}
                />
              </label>
              <label className="shop-pos-field">
                Search name, brand, generic name, SKU, or barcode
                <input
                  className="shop-input"
                  ref={posSearchRef}
                  value={posSearch}
                  onChange={(event) => setPosSearch(event.target.value)}
                  placeholder="Search products..."
                />
              </label>
              {posLoading && <p className="shop-helper">Searching available, unexpired stock...</p>}
              <div className="shop-pos-results">
                {posProducts.map((item) => (
                  <article className="shop-pos-product" key={item.id}>
                    {item.image ? (
                      <img alt="" src={item.image} />
                    ) : (
                      <div className="shop-pos-product-placeholder" aria-hidden="true">
                        Rx
                      </div>
                    )}
                    <div className="shop-pos-product-info">
                      <strong>{item.name}</strong>
                      <span>
                        {[item.brand, item.genericName, item.strength, item.packSize]
                          .filter(Boolean)
                          .join(' · ') ||
                          item.dosageForm ||
                          item.sku}
                      </span>
                      <span>
                        {settings.currency} {item.price} / {item.unit} · {item.availableStock}{' '}
                        available
                      </span>
                      {item.prescriptionRequired && (
                        <span className="shop-pos-rx-warning">
                          Prescription required — dispensing is blocked.
                        </span>
                      )}
                    </div>
                    <button
                      aria-label={`Add ${item.name} to cart`}
                      className="shop-btn primary"
                      disabled={posBusy || item.prescriptionRequired}
                      onClick={() => void addPosProduct(item)}
                      type="button"
                    >
                      Add
                    </button>
                  </article>
                ))}
                {!posLoading && posProducts.length === 0 && (
                  <p className="shop-empty">
                    No products with available, unexpired batches match this search.
                  </p>
                )}
              </div>
            </section>

            <section className="shop-panel shop-pos-checkout">
              <div className="shop-pos-cart-heading">
                <h2>
                  Sale cart{' '}
                  <span>{posCart.reduce((count, line) => count + line.quantity, 0)} units</span>
                </h2>
                <button
                  className="shop-link-button"
                  onClick={() => setShowPrescriptionDialog(true)}
                  type="button"
                >
                  Attach Prescription
                </button>
              </div>
              <div className="shop-pos-cart">
                {posCart.length === 0 ? (
                  <p className="shop-empty">Scan or search for a product to start this sale.</p>
                ) : (
                  posCart.map((line) => {
                    const lineGross = Number(line.product.price) * line.quantity;
                    const lineNet = Math.max(0, lineGross - Number(line.discountAmount));
                    const lineTotal =
                      lineNet + roundMoney((lineNet * Number(line.product.taxRate)) / 100);
                    return (
                      <article
                        className="shop-pos-cart-item"
                        key={`${line.product.id}:${line.batch.id}`}
                      >
                        <div className="shop-pos-line-heading">
                          <strong>{line.product.name}</strong>
                          <button
                            aria-label={`Remove ${line.product.name}`}
                            className="shop-remove-button"
                            onClick={() =>
                              setPosCart((current) => current.filter((item) => item !== line))
                            }
                            type="button"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="shop-pos-line-batch">
                          <label>
                            Batch
                            <select
                              className="shop-input"
                              value={line.batch.id}
                              onChange={(event) =>
                                void changePosBatch(
                                  line.product.id,
                                  line.batch.id,
                                  event.target.value,
                                )
                              }
                            >
                              {(posBatches[line.product.id] ?? [line.batch]).map((batch) => (
                                <option key={batch.id} value={batch.id}>
                                  {batch.batchNumber} · exp{' '}
                                  {new Date(batch.expiryDate).toLocaleDateString()} ·{' '}
                                  {batch.availableQuantity} avail
                                </option>
                              ))}
                            </select>
                          </label>
                          <span>
                            Expiry {new Date(line.batch.expiryDate).toLocaleDateString()} ·{' '}
                            {line.batch.availableQuantity} available
                          </span>
                        </div>
                        <div className="shop-pos-line-controls">
                          <label>
                            Unit
                            <input className="shop-input" readOnly value={line.product.unit} />
                          </label>
                          <label>
                            Quantity
                            <input
                              className="shop-input"
                              type="number"
                              min="1"
                              max={line.batch.availableQuantity}
                              step="1"
                              value={line.quantity}
                              onChange={(event) => {
                                const quantity = Number(event.target.value);
                                if (quantity > line.batch.availableQuantity) {
                                  setPosError(
                                    `Only ${line.batch.availableQuantity} units are available in this batch.`,
                                  );
                                  return;
                                }
                                updatePosLine(line.product.id, line.batch.id, {
                                  quantity: Math.max(1, quantity),
                                });
                              }}
                            />
                          </label>
                          <label>
                            Unit price
                            <input
                              className="shop-input"
                              readOnly
                              value={`${settings.currency} ${line.product.price}`}
                            />
                          </label>
                          <label>
                            Discount
                            <input
                              className="shop-input"
                              min="0"
                              max={lineGross}
                              step="0.01"
                              type="number"
                              value={line.discountAmount}
                              onChange={(event) =>
                                updatePosLine(line.product.id, line.batch.id, {
                                  discountAmount: event.target.value,
                                })
                              }
                            />
                          </label>
                          <strong className="shop-pos-line-total">
                            {settings.currency} {lineTotal.toFixed(2)}
                          </strong>
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              <div className="shop-pos-customer">
                <label>
                  Customer selector
                  <select
                    className="shop-input"
                    value={posCustomerChoice}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPosCustomerChoice(value);
                      if (!value) {
                        setPosCustomerName('');
                        setPosCustomerPhone('');
                        return;
                      }
                      const [name, phone] = JSON.parse(value) as [string, string];
                      setPosCustomerName(name);
                      setPosCustomerPhone(phone);
                    }}
                  >
                    <option value="">Walk-in / enter customer details</option>
                    {Array.from(
                      new Map(
                        posSales
                          .filter((sale) => sale.customerName || sale.customerPhone)
                          .map((sale) => {
                            const name = sale.customerName ?? '';
                            const phone = sale.customerPhone ?? '';
                            return [JSON.stringify([name, phone]), { name, phone }] as const;
                          }),
                      ).entries(),
                    ).map(([value, customer]) => (
                      <option key={value} value={value}>
                        {customer.name || customer.phone}
                        {customer.name && customer.phone ? ` (${customer.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Customer / account name
                  <input
                    className="shop-input"
                    ref={posCustomerRef}
                    maxLength={200}
                    value={posCustomerName}
                    onChange={(event) => {
                      setPosCustomerChoice('');
                      setPosCustomerName(event.target.value);
                    }}
                    placeholder="Walk-in customer"
                  />
                </label>
                <label>
                  Phone
                  <input
                    className="shop-input"
                    maxLength={50}
                    value={posCustomerPhone}
                    onChange={(event) => {
                      setPosCustomerChoice('');
                      setPosCustomerPhone(event.target.value);
                    }}
                    placeholder="For WhatsApp receipt"
                  />
                </label>
              </div>

              <div className="shop-pos-payment">
                <h3>Payment</h3>
                <div className="shop-pos-payment-fields">
                  <label>
                    Payment method
                    <select
                      className="shop-input"
                      ref={posPaymentRef}
                      value={posPaymentMethod}
                      onChange={(event) =>
                        setPosPaymentMethod(event.target.value as PosPaymentMethod)
                      }
                    >
                      <option value="CASH">Cash</option>
                      <option value="MPESA_STK_PUSH">M-Pesa (manual confirmation)</option>
                      <option value="CARD">Card</option>
                      <option value="BANK_TRANSFER">Bank transfer</option>
                      <option value="CREDIT_ACCOUNT">Credit / account</option>
                    </select>
                  </label>
                  <label>
                    {posPaymentMethod === 'CASH' ? 'Cash received' : 'Amount'}
                    <input
                      className="shop-input"
                      min="0"
                      step="0.01"
                      type="number"
                      value={posPaymentAmount}
                      placeholder={posTotal.toFixed(2)}
                      onChange={(event) => setPosPaymentAmount(event.target.value)}
                    />
                  </label>
                </div>
                {(posPaymentMethod === 'MPESA_STK_PUSH' ||
                  posPaymentMethod === 'CARD' ||
                  posPaymentMethod === 'BANK_TRANSFER') && (
                  <label className="shop-pos-field">
                    Transaction reference
                    <input
                      className="shop-input"
                      value={posPaymentReference}
                      onChange={(event) => setPosPaymentReference(event.target.value)}
                      placeholder="Enter verified transaction reference"
                    />
                  </label>
                )}
                {posPaymentMethod === 'MPESA_STK_PUSH' && (
                  <p className="shop-payment-notice">
                    No M-Pesa gateway is configured in this backend. Verify payment in your provider
                    portal and enter the reference; this tender will remain marked pending.
                  </p>
                )}
                {['CARD', 'BANK_TRANSFER'].includes(posPaymentMethod) && (
                  <p className="shop-payment-notice">
                    No payment terminal or bank integration is configured. Verify the transaction
                    externally and record its reference before completing the sale.
                  </p>
                )}
                <label className="shop-checkbox shop-pos-split-toggle">
                  <input
                    checked={posSplitEnabled}
                    onChange={(event) => setPosSplitEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  Split payment
                </label>
                {posSplitEnabled && (
                  <div className="shop-pos-payment-fields">
                    <label>
                      Second payment method
                      <select
                        className="shop-input"
                        value={posSplitMethod}
                        onChange={(event) =>
                          setPosSplitMethod(event.target.value as PosPaymentMethod)
                        }
                      >
                        <option value="CASH">Cash</option>
                        <option value="MPESA_STK_PUSH">M-Pesa (manual confirmation)</option>
                        <option value="CARD">Card</option>
                        <option value="BANK_TRANSFER">Bank transfer</option>
                        <option value="CREDIT_ACCOUNT">Credit / account</option>
                      </select>
                    </label>
                    <label>
                      Second payment amount
                      <input
                        className="shop-input"
                        min="0"
                        step="0.01"
                        type="number"
                        value={posSplitAmount}
                        onChange={(event) => setPosSplitAmount(event.target.value)}
                      />
                    </label>
                    {posSplitMethod === 'MPESA_STK_PUSH' && (
                      <label>
                        M-Pesa reference
                        <input
                          className="shop-input"
                          value={posSplitReference}
                          onChange={(event) => setPosSplitReference(event.target.value)}
                        />
                      </label>
                    )}
                  </div>
                )}
                <div className="shop-pos-totals">
                  <div>
                    <span>Subtotal after line discounts</span>
                    <span>
                      {settings.currency} {posSubtotal.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span>Discounts</span>
                    <span>
                      {settings.currency} {posDiscountTotal.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span>VAT</span>
                    <span>
                      {settings.currency} {posTaxTotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="is-total">
                    <strong>Total</strong>
                    <strong>
                      {settings.currency} {posTotal.toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Payment entered</span>
                    <span>
                      {settings.currency} {posTendered.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span>Change due</span>
                    <span>
                      {settings.currency} {posChange.toFixed(2)}
                    </span>
                  </div>
                </div>
                <label className="shop-pos-field">
                  Sale discount
                  <input
                    className="shop-input"
                    min="0"
                    step="0.01"
                    type="number"
                    value={posDiscount}
                    onChange={(event) => setPosDiscount(event.target.value)}
                  />
                </label>
                <div className="shop-pos-actions">
                  <button
                    className="shop-btn secondary"
                    disabled={posBusy || posCart.length === 0}
                    onClick={() => void holdPosSale()}
                    type="button"
                  >
                    Hold Sale
                  </button>
                  <button
                    className="shop-btn primary shop-pos-complete"
                    disabled={posBusy || posCart.length === 0}
                    onClick={() => void completePosSale()}
                    type="button"
                  >
                    {posBusy ? 'Processing...' : 'Complete Sale'}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <section className="shop-pos-shortcuts" aria-label="Point of sale keyboard shortcuts">
            <span>F2 Customer</span>
            <span>F3 Search</span>
            <span>F4 M-Pesa</span>
            <span>F5 Cash</span>
            <span>F8 Print</span>
            <span>F9 Hold</span>
            <span>F10 Complete</span>
          </section>

          {showHeldSales && (
            <section className="shop-panel shop-held-sales">
              <div className="shop-pos-cart-heading">
                <h2>
                  Held sales <span>{posHeldSales.length}</span>
                </h2>
                <button
                  className="shop-link-button"
                  onClick={() => setShowHeldSales(false)}
                  type="button"
                >
                  Close
                </button>
              </div>
              {posHeldSales.length === 0 ? (
                <p className="shop-empty">This cashier has no held sales.</p>
              ) : (
                posHeldSales.map((held) => (
                  <article className="shop-held-sale" key={held.id}>
                    <span>
                      {held.payload.items.length} lines ·{' '}
                      {new Date(held.createdAt).toLocaleString()} ·{' '}
                      {held.payload.customerName || 'Walk-in'}
                    </span>
                    <button
                      className="shop-btn primary"
                      disabled={posBusy}
                      onClick={() => void resumePosSale(held.id)}
                      type="button"
                    >
                      Resume
                    </button>
                  </article>
                ))
              )}
            </section>
          )}

          {lastPosSale && (
            <section className="shop-panel shop-pos-receipt-actions">
              <div>
                <h2>Sale {lastPosSale.saleNumber}</h2>
                <p>
                  {lastPosSale.paymentStatus === 'PENDING'
                    ? 'Payment pending confirmation'
                    : 'Sale completed'}{' '}
                  · {settings.currency} {lastPosSale.total}
                </p>
              </div>
              <div className="shop-pos-toolbar-actions">
                <button className="shop-btn secondary" onClick={() => window.print()} type="button">
                  Print Receipt
                </button>
                <button
                  className="shop-btn secondary"
                  onClick={() => sendPosReceiptOnWhatsApp(lastPosSale)}
                  type="button"
                >
                  Send Receipt on WhatsApp
                </button>
                <button className="shop-btn primary" onClick={() => resetPos(true)} type="button">
                  New Sale
                </button>
              </div>
            </section>
          )}

          {lastPosSale && (
            <section className="shop-receipt-print">
              <h1>{settings.storeName || 'Pharmacy'}</h1>
              <p>Receipt: {lastPosSale.saleNumber}</p>
              <p>{new Date(lastPosSale.createdAt).toLocaleString()}</p>
              <hr />
              {lastPosSale.items.map((item) => (
                <div className="shop-receipt-line" key={item.id}>
                  <span>
                    {item.productName} ({item.batchNumber}, exp{' '}
                    {new Date(item.expiryDate).toLocaleDateString()}) · {item.quantity} {item.unit}
                  </span>
                  <span>
                    {lastPosSale.currency} {item.lineTotal}
                  </span>
                </div>
              ))}
              <hr />
              <p>
                Total: {lastPosSale.currency} {lastPosSale.total}
              </p>
              <p>Payment status: {lastPosSale.paymentStatus}</p>
              <p>Thank you.</p>
            </section>
          )}
        </>
      )}

      {(['Prescriptions', 'Customers', 'Reports'] as ShopTab[]).includes(activeTab) && (
        <section className="shop-panel shop-unavailable" aria-live="polite">
          <h2>{activeTab}</h2>
          <p>
            This section is not connected because the current Shop backend does not provide the
            required {activeTab.toLowerCase()} data or operations yet. No sample or placeholder
            records are shown.
          </p>
          <button
            className="shop-btn secondary"
            onClick={() => setActiveTab('Dashboard')}
            type="button"
          >
            Back to dashboard
          </button>
        </section>
      )}

      {showPrescriptionDialog && (
        <div
          className="shop-dialog-backdrop"
          role="presentation"
          onClick={() => setShowPrescriptionDialog(false)}
        >
          <section
            aria-labelledby="pos-prescription-title"
            aria-modal="true"
            className="shop-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <h2 id="pos-prescription-title">Attach prescription</h2>
            <p>
              Prescription storage and pharmacist verification are not available in the current
              backend. Prescription-only products are blocked from checkout until that workflow is
              integrated. No document is uploaded or marked verified here.
            </p>
            <button
              className="shop-btn primary"
              onClick={() => setShowPrescriptionDialog(false)}
              type="button"
            >
              Close
            </button>
          </section>
        </div>
      )}

      {showReceiveBatchDialog && (
        <div
          className="shop-dialog-backdrop"
          role="presentation"
          onClick={() => setShowReceiveBatchDialog(false)}
        >
          <form
            className="shop-dialog"
            onSubmit={(event) => void submitReceiveBatch(event)}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Receive stock batch</h2>
            <p>
              Record the actual supplier batch and expiry. Expired batches cannot be received or
              sold.
            </p>
            <label>
              Product
              <select
                className="shop-input"
                required
                value={receiveProductId}
                onChange={(event) => setReceiveProductId(event.target.value)}
              >
                {products.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.sku}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch number
              <input
                className="shop-input"
                required
                maxLength={100}
                value={receiveBatchNumber}
                onChange={(event) => setReceiveBatchNumber(event.target.value)}
              />
            </label>
            <label>
              Expiry date
              <input
                className="shop-input"
                required
                type="date"
                min={new Date().toISOString().slice(0, 10)}
                value={receiveExpiryDate}
                onChange={(event) => setReceiveExpiryDate(event.target.value)}
              />
            </label>
            <div className="shop-dialog-grid">
              <label>
                Quantity received
                <input
                  className="shop-input"
                  required
                  min="1"
                  max="1000000"
                  step="1"
                  type="number"
                  value={receiveQuantity}
                  onChange={(event) => setReceiveQuantity(event.target.value)}
                />
              </label>
              <label>
                Unit cost
                <input
                  className="shop-input"
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={receiveCostPrice}
                  onChange={(event) => setReceiveCostPrice(event.target.value)}
                />
              </label>
            </div>
            <label>
              Supplier (optional)
              <input
                className="shop-input"
                maxLength={200}
                value={receiveSupplierName}
                onChange={(event) => setReceiveSupplierName(event.target.value)}
              />
            </label>
            <div className="shop-dialog-actions">
              <button
                className="shop-btn secondary"
                onClick={() => setShowReceiveBatchDialog(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="shop-btn primary"
                disabled={posBusy || !receiveProductId}
                type="submit"
              >
                {posBusy ? 'Saving...' : 'Receive batch'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showRefundDialog && (
        <div
          className="shop-dialog-backdrop"
          role="presentation"
          onClick={() => setShowRefundDialog(false)}
        >
          <form
            className="shop-dialog"
            onSubmit={(event) => void submitPosRefund(event)}
            onClick={(event) => event.stopPropagation()}
          >
            <h2>Refund / return</h2>
            {posSales.length === 0 ? (
              <p>No completed sales are available to refund.</p>
            ) : (
              <>
                <label>
                  Sale
                  <select
                    className="shop-input"
                    required
                    value={posRefundSaleId}
                    onChange={(event) => setPosRefundSaleId(event.target.value)}
                  >
                    <option value="">Select a completed sale</option>
                    {posSales.map((sale) => (
                      <option key={sale.id} value={sale.id}>
                        {sale.saleNumber} · {sale.customerName || 'Walk-in'} · {sale.currency}{' '}
                        {sale.total} · {new Date(sale.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Reason
                  <textarea
                    className="shop-input"
                    required
                    minLength={3}
                    maxLength={500}
                    value={posRefundReason}
                    onChange={(event) => setPosRefundReason(event.target.value)}
                  />
                </label>
                <label className="shop-checkbox">
                  <input
                    checked={posReturnStock}
                    onChange={(event) => setPosReturnStock(event.target.checked)}
                    type="checkbox"
                  />
                  Return items to stock only if their original batches remain unexpired
                </label>
                <p className="shop-payment-notice">
                  This records a full-sale refund and audit event. It does not send funds to a
                  payment provider; arrange the payout through the original payment channel.
                </p>
              </>
            )}
            <div className="shop-dialog-actions">
              <button
                className="shop-btn secondary"
                onClick={() => setShowRefundDialog(false)}
                type="button"
              >
                Cancel
              </button>
              {posSales.length > 0 && (
                <button
                  className="shop-btn primary"
                  disabled={posBusy || !posRefundSaleId}
                  type="submit"
                >
                  Record full refund
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
