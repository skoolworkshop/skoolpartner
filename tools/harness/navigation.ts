/** In de harness is er geen router. Alleen genoeg om de opmaak te renderen. */
export const usePathname = () => "/admin";
export const useRouter = () => ({ push: () => {}, refresh: () => {} });
