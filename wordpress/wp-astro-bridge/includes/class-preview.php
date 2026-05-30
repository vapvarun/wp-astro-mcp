<?php
/**
 * Preview URL rewriter — redirects WordPress preview to Astro frontend.
 *
 * @package WP_Astro_Bridge
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Class WP_Astro_Bridge_Preview
 *
 * Filters preview_post_link to point to the Astro frontend with
 * a short-lived HMAC token for authentication.
 */
class WP_Astro_Bridge_Preview {

	/**
	 * Plugin options.
	 *
	 * @var array
	 */
	private $options;

	/**
	 * Constructor.
	 *
	 * @param array $options Plugin options from wp_astro_bridge_settings.
	 */
	public function __construct( $options ) {
		$this->options = $options;

		if ( empty( $this->options['astro_url'] ) ) {
			return;
		}

		add_filter( 'preview_post_link', array( $this, 'rewrite_preview_link' ), 10, 2 );
	}

	/**
	 * Rewrite the WordPress preview URL to point to the Astro frontend.
	 *
	 * @param string  $preview_link Default WordPress preview link.
	 * @param WP_Post $post         Post object.
	 * @return string Modified preview link pointing to Astro.
	 */
	public function rewrite_preview_link( $preview_link, $post ) {
		$post_type_obj = get_post_type_object( $post->post_type );
		if ( ! $post_type_obj || ! $post_type_obj->public ) {
			return $preview_link;
		}

		$token     = $this->generate_token( $post->ID );
		$astro_url = rtrim( $this->options['astro_url'], '/' );

		return add_query_arg(
			array(
				'token' => $token,
				'id'    => $post->ID,
			),
			$astro_url . '/preview'
		);
	}

	/**
	 * Transient key prefix for server-side preview nonces.
	 *
	 * @var string
	 */
	const NONCE_TRANSIENT_PREFIX = 'wpab_preview_nonce_';

	/**
	 * Preview token lifetime in seconds (matches transient TTL).
	 *
	 * @var int
	 */
	const TOKEN_TTL = 5 * MINUTE_IN_SECONDS;

	/**
	 * Generate a short-lived, unguessable HMAC token for preview authentication.
	 *
	 * Defense-in-depth design:
	 * - A random server-side secret (32 chars) is stored in a short-lived
	 *   transient keyed by a random nonce id. The secret is part of the signed
	 *   payload but is NEVER sent to the client, so the token is unguessable
	 *   even though post_id/user_id/expiry are predictable.
	 * - The transient gives natural expiry and revocability and ties the token
	 *   to this specific WordPress install.
	 * - The HMAC (signed with wp_salt) is retained as a second factor.
	 *
	 * Token payload (base64): post_id|user_id|expiry|nonce_id|signature
	 * where signature = HMAC( post_id|user_id|expiry|nonce_id|secret ).
	 *
	 * @param int $post_id Post ID to generate token for.
	 * @return string Base64-encoded token (payload + signature).
	 */
	public function generate_token( $post_id ) {
		$user_id = get_current_user_id();
		$expiry  = time() + self::TOKEN_TTL;

		// Random, server-side-only secret + a random id to look it up.
		$secret   = wp_generate_password( 32, false );
		$nonce_id = wp_generate_password( 20, false );

		set_transient( self::NONCE_TRANSIENT_PREFIX . $nonce_id, $secret, self::TOKEN_TTL );

		$payload   = $post_id . '|' . $user_id . '|' . $expiry . '|' . $nonce_id;
		$signature = hash_hmac( 'sha256', $payload . '|' . $secret, wp_salt( 'auth' ) );

		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return base64_encode( $payload . '|' . $signature );
	}

	/**
	 * Verify a preview token (used by the REST endpoint).
	 *
	 * Returns the token's embedded user id on success so the caller can run a
	 * per-post capability re-check before disclosing any content. Verification
	 * checks, in order: format, expiry, post-id match, server-side nonce
	 * (single-use), and finally the HMAC signature (timing-safe).
	 *
	 * @param string $token   Base64-encoded token.
	 * @param int    $post_id Expected post ID.
	 * @return array|WP_Error array( 'user_id' => int ) on success, WP_Error on failure.
	 */
	public static function verify_token( $token, $post_id ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode
		$decoded = base64_decode( $token, true );
		if ( ! $decoded ) {
			return new WP_Error( 'invalid_token', 'Token is malformed.', array( 'status' => 403 ) );
		}

		$parts = explode( '|', $decoded );
		if ( count( $parts ) !== 5 ) {
			return new WP_Error( 'invalid_token', 'Token format is invalid.', array( 'status' => 403 ) );
		}

		list( $token_post_id, $token_user_id, $expiry, $nonce_id, $signature ) = $parts;

		// Check expiry.
		if ( (int) $expiry < time() ) {
			return new WP_Error( 'token_expired', 'Preview token has expired. Click Preview again in WordPress.', array( 'status' => 403 ) );
		}

		// Check post ID matches.
		if ( (int) $token_post_id !== (int) $post_id ) {
			return new WP_Error( 'post_mismatch', 'Token does not match requested post.', array( 'status' => 403 ) );
		}

		// Reject anonymous tokens outright — a preview must belong to a real user.
		if ( (int) $token_user_id <= 0 ) {
			return new WP_Error( 'forbidden', 'Token is not associated with a user.', array( 'status' => 403 ) );
		}

		// Look up the server-side secret. A missing transient means the token
		// is forged, already consumed, or expired/revoked.
		$transient_key = self::NONCE_TRANSIENT_PREFIX . sanitize_key( $nonce_id );
		$secret        = get_transient( $transient_key );
		if ( false === $secret ) {
			return new WP_Error( 'invalid_token', 'Preview token is invalid or already used. Click Preview again in WordPress.', array( 'status' => 403 ) );
		}

		// Verify HMAC signature (timing-safe) using the server-side secret.
		$payload            = $token_post_id . '|' . $token_user_id . '|' . $expiry . '|' . $nonce_id;
		$expected_signature = hash_hmac( 'sha256', $payload . '|' . $secret, wp_salt( 'auth' ) );

		if ( ! hash_equals( $expected_signature, $signature ) ) {
			return new WP_Error( 'invalid_signature', 'Token signature is invalid.', array( 'status' => 403 ) );
		}

		// Single-use: consume the nonce so the token cannot be replayed.
		delete_transient( $transient_key );

		return array( 'user_id' => (int) $token_user_id );
	}
}
