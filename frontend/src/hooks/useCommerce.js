import { useQuery } from '@tanstack/react-query';
import { commerceApi } from '../api/commerce';
import { ecUrl, placementRows, withSavedItems } from '../domain/shopping';

const cartKey = ['ec-cart', ecUrl];
export function useEcCart() {
    return useQuery({ queryKey: cartKey, queryFn: commerceApi.cart, retry: false,
        staleTime: 10000, refetchOnWindowFocus: true });
}
export function useCommerce(document, assets) {
    // Only the shared header and selected store use the EC cart. Placements never mutate it.
    const cart = useEcCart();
    const products = useQuery({ queryKey: ['ec-products', ecUrl, cart.data?.storeId],
        queryFn: () => commerceApi.products(cart.data.storeId), enabled: !!cart.data,
        retry: false, staleTime: 10000, refetchOnWindowFocus: true });
    // Products added from EC live in EC; merge them with the local, possibly unsaved placements.
    const saved = useQuery({ queryKey: ['ec-saved-items', ecUrl, document?.id],
        queryFn: () => commerceApi.savedItems(document.id), enabled: !!document?.id,
        retry: false, staleTime: 10000, refetchOnWindowFocus: true });
    const rows = document ? withSavedItems(placementRows(document, assets), saved.data?.items) : [];
    return { cart, products, saved, rows };
}
