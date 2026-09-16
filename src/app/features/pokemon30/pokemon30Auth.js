export function buildPokemon30LoginUrl() {
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  // The OAuth state is stored in a host-only cookie. Keeping the current
  // origin avoids a localhost/127.0.0.1 mismatch during local development.
  const url = new URL("/api/auth/renaiss/start", window.location.origin);
  url.searchParams.set("return_to", returnTo);
  url.searchParams.set("prompt", "consent");
  return `${url.pathname}${url.search}`;
}
