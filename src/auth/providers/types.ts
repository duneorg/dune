/**
 * OAuth provider abstraction for public site auth.
 */

export interface OAuthProvider {
  /** Provider name, e.g. "github", "google", "discord" */
  name: string;
  /**
   * Build the authorization URL to redirect the user to.
   * @param state - CSRF state token
   * @param redirectUri - Absolute callback URL registered with the provider
   */
  authorizationUrl(state: string, redirectUri: string): string;
  /**
   * Exchange an authorization code for an access token.
   */
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }>;
  /**
   * Fetch the authenticated user's profile using an access token.
   */
  getUser(accessToken: string): Promise<{
    id: string;
    email: string;
    name?: string;
    avatarUrl?: string;
  }>;
}
