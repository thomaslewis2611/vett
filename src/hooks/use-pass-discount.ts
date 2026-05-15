import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { checkPassDiscountEligibility } from "@/lib/pass-discount.functions";

export const PASS_DISCOUNT_PRICE_ID = "price_1TXLgzCfTT0mXB2cJMfAE4DW";

export type PassDiscount = {
  eligible: boolean;
  loading: boolean;
  priceId: string;
};

/**
 * Returns whether the current viewer is eligible for the £20 Buyer Pass
 * upgrade discount (logged-in, has a prior Single Report purchase, no
 * active Buyer Pass). Returns { eligible: false } for signed-out users.
 */
export function usePassDiscount(): PassDiscount {
  const checkFn = useServerFn(checkPassDiscountEligibility);
  const [state, setState] = useState<PassDiscount>({
    eligible: false,
    loading: true,
    priceId: PASS_DISCOUNT_PRICE_ID,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!data.user?.email) {
          if (!cancelled) setState((s) => ({ ...s, loading: false, eligible: false }));
          return;
        }
        const r = await checkFn({ data: undefined as never });
        if (cancelled) return;
        setState({ eligible: r.eligible, loading: false, priceId: r.priceId });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false, eligible: false }));
      }
    })();
    return () => { cancelled = true; };
  }, [checkFn]);

  return state;
}
