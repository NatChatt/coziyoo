/**
 * prefetchCatalogs — called once after auth is established (login or app resume).
 * Warms the ingredient and addon template caches so pickers load instantly.
 * All errors are swallowed; this must never block the app.
 */
import type { AuthSession } from "./auth";
import { refreshIngredientLibrary } from "./ingredientsLibrary";
import { refreshAddonLibrary } from "./addonLibrary";

export async function prefetchCatalogs(
  apiUrl: string,
  auth: AuthSession,
): Promise<void> {
  try {
    await Promise.allSettled([
      refreshIngredientLibrary(apiUrl, auth),
      refreshAddonLibrary(apiUrl, auth),
    ]);
  } catch {
    // never block the app
  }
}
