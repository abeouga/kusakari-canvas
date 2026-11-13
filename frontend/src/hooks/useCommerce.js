import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { commerceApi } from '../api/commerce';
import { uniqueProductIds } from '../domain/productAvailability';
import { ecUrl, placementRows, withSavedItems } from '../domain/shopping';

const cartKey = ['ec-cart', ecUrl];
export function useEcCart() {
    return useQuery({ queryKey: cartKey, queryFn: commerceApi.cart, retry: false,
        staleTime: 10000, refetchOnWindowFocus: true });
}
export function useCommerce(document, assets) {
    // Only the shared header uses the EC cart. Placements never mutate it.
    const cart = useEcCart();
    const products = useQuery({ queryKey: ['ec-products', ecUrl], queryFn: commerceApi.products,
        retry: false, staleTime: 10000, refetchOnWindowFocus: true });
    // Products added from EC live in EC; merge them with the local, possibly unsaved placements.
    const saved = useQuery({ queryKey: ['ec-saved-items', ecUrl, document?.id],
        queryFn: () => commerceApi.savedItems(document.id), enabled: !!document?.id,
        retry: false, staleTime: 10000, refetchOnWindowFocus: true });
    const rows = document ? withSavedItems(placementRows(document, assets), saved.data?.items) : [];
    // Store names and availability come from the EC lookup, which also returns products no longer listed.
    const ids = uniqueProductIds(rows.map((row) => row.productId));
    const references = useQuery({ queryKey: ['ec-product-references', ecUrl, ids.join(',')],
        queryFn: () => commerceApi.references(ids), enabled: ids.length > 0, placeholderData: keepPreviousData,
        retry: false, staleTime: 10000, refetchOnWindowFocus: true });
    const referenceMap = new Map((references.data ?? []).map((reference) => [reference.id, reference]));
    return { cart, products, saved, rows, references, referenceMap };
}
